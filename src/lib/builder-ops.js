/**
 * Diet Builder edits as data.
 *
 * The chat assistant never edits the builder itself. It drafts a list of
 * operations, the user is shown exactly what they would change, and only the
 * user's Apply click runs them. Both halves go through this module — the
 * server checks a draft against the builder before showing it, and the
 * browser runs the same code to apply it — so the change the user approved is
 * the change they get.
 *
 * applyBuilderOperations never mutates its input. It returns the edited
 * builder, the operations in canonical form (meals by id, values parsed), and
 * one entry per changed value, worded for the confirmation card. A draft that
 * does not fit the builder throws with a message naming the problem: the
 * model reads it and corrects the draft, and the user reads it when an older
 * draft no longer applies.
 *
 * Used by:
 *   - src/lib/agent-proposals.js  (CommonJS require, drafting a change)
 *   - src/lib/agent.ts            (CommonJS require, for the chat route)
 *   - src/hooks/useAssistant.ts   (ES import, checking a draft before Apply)
 *   - src/app/page.tsx            (ES import, applying it to the builder)
 *
 * Keep this file as plain JS so it matches the other shared lib modules.
 *
 * @typedef {Pick<import('./types').Config, 'global' | 'meals' | 'dailyVariables'>} Builder
 * @typedef {import('./types').BuilderOperation} BuilderOperation
 * @typedef {import('./types').BuilderChange} BuilderChange
 */

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** Daily ingredients saved before they named their meal belong to this one. */
const LEGACY_MEAL_ID = 'meal-chicken';

const INGREDIENT_FIELDS = ['name', 'weight', 'isAuto', 'minGrams', 'maxGrams', 'disabled', 'personalOnly', 'split'];

/** Fields each action takes besides `action`. add_meal's `id` is filled in when drafting. */
const ACTION_FIELDS = {
  update_targets: ['dailyCalorieTarget', 'idealSodiumPotassiumRatioMin', 'idealSodiumPotassiumRatioMax'],
  update_meal: ['meal', 'name', 'mealsPerDay', 'disabled', 'cookQuantityMode', 'prepMethod'],
  add_meal: ['name', 'mealsPerDay', 'disabled', 'cookQuantityMode', 'prepMethod', 'id'],
  remove_meal: ['meal'],
  add_ingredient: ['meal', 'day', ...INGREDIENT_FIELDS],
  update_ingredient: ['meal', 'day', 'ingredient', ...INGREDIENT_FIELDS],
  remove_ingredient: ['meal', 'day', 'ingredient']
};

const ACTIONS = Object.keys(ACTION_FIELDS);

const COOK_QUANTITY_LABELS = { daily: 'Whole day total', 'per-meal': 'Per meal' };

const MAX_OPERATIONS = 20;
const MAX_GRAMS = 5000;
const MAX_NAME_CHARS = 100;
const MAX_SPLIT_CHARS = 300;
const MAX_PREP_CHARS = 2000;

// -------------------------------------------------------------
// READING VALUES
// -------------------------------------------------------------

/** Models send absent optional fields as null as often as they leave them out. */
const isGiven = (value) => value !== undefined && value !== null;

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const displayName = (value) => String(value || '').trim();

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** Grams are stored as text, the way the builder's inputs hold them. */
const formatGrams = (grams) => String(round(grams, 2));

function readText(value, field, maxLength, { required = false } = {}) {
  if (!isGiven(value)) {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (required && !text) throw new Error(`${field} cannot be empty.`);
  if (text.length > maxLength) throw new Error(`${field} is too long (${text.length} characters, limit ${maxLength}).`);
  return text;
}

/** Accepts numeric strings too, since that is how weights are stored. */
function readNumber(value, field, { min, max, integer = false }) {
  if (!isGiven(value) || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number, got ${JSON.stringify(value)}.`);
  if (integer && !Number.isInteger(number)) throw new Error(`${field} must be a whole number, got ${number}.`);
  if (number < min || number > max) throw new Error(`${field} must be between ${min} and ${max}, got ${number}.`);
  return number;
}

function readBoolean(value, field) {
  if (!isGiven(value)) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false.`);
  return value;
}

function readDay(value) {
  if (!isGiven(value) || value === '') return undefined;
  const day = String(value).trim().toUpperCase();
  if (!DAYS.includes(day)) throw new Error(`Unknown day "${value}". Use one of: ${DAYS.join(', ')}.`);
  return day;
}

/** Drops the fields a canonical operation leaves unset. */
function compact(operation) {
  return Object.fromEntries(Object.entries(operation).filter(([, value]) => value !== undefined));
}

// -------------------------------------------------------------
// WORDING
// -------------------------------------------------------------

const dayLabel = (day) => day.charAt(0) + day.slice(1).toLowerCase();

function describeAmount(ingredient) {
  if (ingredient.isAuto) {
    const { minGrams: min, maxGrams: max } = ingredient;
    if (min && max) return `AUTO ${min}–${max} g`;
    if (min) return `AUTO, min ${min} g`;
    if (max) return `AUTO, max ${max} g`;
    return 'AUTO';
  }
  return ingredient.weight ? `${ingredient.weight} g` : 'no amount';
}

function describeIngredient(ingredient) {
  const parts = [displayName(ingredient.name), describeAmount(ingredient)];
  if (ingredient.disabled) parts.push('inactive');
  if (ingredient.personalOnly) parts.push('personal only');
  return parts.join(' · ');
}

const describeStatus = (disabled) => (disabled ? 'Inactive' : 'Active');

const describeCookQuantity = (mode) => COOK_QUANTITY_LABELS[mode || 'daily'] || String(mode);

/** One line per change, for the model and for replaying a conversation. */
function formatChange(change) {
  if (change.kind === 'add') return `${change.where}: add ${change.after}`;
  if (change.kind === 'remove') return `${change.where}: remove ${change.before}`;
  return `${change.where}: ${change.field} ${change.before} → ${change.after}`;
}

function pushChange(changes, where, field, before, after) {
  if (before === after) return;
  changes.push({ kind: 'change', where, field, before: before === '' ? '—' : before, after: after === '' ? '—' : after });
}

function ingredientChanges(where, before, after) {
  const changes = [];
  pushChange(changes, where, 'Name', displayName(before.name), displayName(after.name));
  pushChange(changes, where, 'Amount', describeAmount(before), describeAmount(after));
  pushChange(changes, where, 'Status', describeStatus(before.disabled), describeStatus(after.disabled));
  pushChange(changes, where, 'Personal only', before.personalOnly ? 'Yes' : 'No', after.personalOnly ? 'Yes' : 'No');
  pushChange(changes, where, 'Split', before.split || '', after.split || '');
  return changes;
}

// -------------------------------------------------------------
// FINDING THINGS
// -------------------------------------------------------------

const ownerOf = (ingredient) => ingredient.mealId || LEGACY_MEAL_ID;

const listMeals = (builder) => builder.meals.map((meal) => `${meal.id} (${displayName(meal.name)})`).join(', ');

/** A meal by id, or by its exact name when that is unambiguous. */
function findMeal(builder, reference) {
  const key = typeof reference === 'string' ? reference.trim() : '';
  if (!key) throw new Error('meal is required: pass the meal id from get_diet_config.');
  const byId = builder.meals.find((meal) => meal.id === key);
  if (byId) return byId;
  const byName = builder.meals.filter((meal) => sameName(meal.name, key));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`More than one meal is named "${key}". Meals: ${listMeals(builder)}.`);
  throw new Error(`No meal matches "${key}". Meals: ${listMeals(builder)}.`);
}

function mealName(builder, mealId) {
  const meal = builder.meals.find((entry) => entry.id === mealId);
  return meal ? displayName(meal.name) : 'a removed meal';
}

/** The list an ingredient action edits, and how the card names it. */
function ingredientList(builder, day, meal) {
  if (!day) return { list: meal.ingredients, where: displayName(meal.name) };
  if (!builder.dailyVariables[day]) builder.dailyVariables[day] = [];
  return { list: builder.dailyVariables[day], where: `${dayLabel(day)} · ${displayName(meal.name)}` };
}

/**
 * The one ingredient an update or remove targets. Daily lists can hold the
 * same name for two meals, so `meal` narrows a day's list when given.
 */
function findIngredient(builder, day, meal, name) {
  if (!day) {
    const matches = meal.ingredients.filter((ingredient) => sameName(ingredient.name, name));
    if (matches.length === 0) {
      const names = meal.ingredients.map((ingredient) => displayName(ingredient.name)).join(', ') || 'none';
      throw new Error(`"${displayName(meal.name)}" has no ingredient named "${name}". Its ingredients: ${names}.`);
    }
    if (matches.length > 1) throw new Error(`"${displayName(meal.name)}" lists "${name}" more than once, so it cannot be picked by name.`);
    return { list: meal.ingredients, index: meal.ingredients.indexOf(matches[0]) };
  }

  const list = builder.dailyVariables[day] || [];
  const matches = list.filter((ingredient) => sameName(ingredient.name, name) && (!meal || ownerOf(ingredient) === meal.id));
  if (matches.length === 0) {
    const names = list.map((ingredient) => `${displayName(ingredient.name)} (${mealName(builder, ownerOf(ingredient))})`).join(', ') || 'none';
    const scope = meal ? ` for "${displayName(meal.name)}"` : '';
    throw new Error(`${dayLabel(day)} has no daily ingredient named "${name}"${scope}. ${dayLabel(day)}'s ingredients: ${names}.`);
  }
  if (matches.length > 1) {
    throw new Error(meal
      ? `${dayLabel(day)} lists "${name}" for "${displayName(meal.name)}" more than once, so it cannot be picked by name.`
      : `${dayLabel(day)} has "${name}" for more than one meal; name the meal it belongs to.`);
  }
  return { list, index: list.indexOf(matches[0]) };
}

/** Whether another ingredient in the same list (and, on a day, the same meal) already has this name. */
function hasNamesake(list, name, mealId, day, except) {
  return list.some((ingredient) => ingredient !== except
    && sameName(ingredient.name, name)
    && (!day || ownerOf(ingredient) === mealId));
}

// -------------------------------------------------------------
// INGREDIENT FIELDS
// -------------------------------------------------------------

/**
 * Apply an operation's ingredient fields to a copy of `current`. A fixed
 * weight and AUTO exclude each other the way they do in the builder: setting
 * one clears the other, and the AUTO range only exists on AUTO ingredients.
 */
function applyIngredientFields(current, operation) {
  const next = { ...current };

  const name = readText(operation.name, 'name', MAX_NAME_CHARS);
  if (name !== undefined) {
    if (!name) throw new Error('name cannot be empty.');
    next.name = name;
  }

  const weight = readNumber(operation.weight, 'weight', { min: 0, max: MAX_GRAMS });
  const isAuto = readBoolean(operation.isAuto, 'isAuto');
  const minGrams = readNumber(operation.minGrams, 'minGrams', { min: 0, max: MAX_GRAMS });
  const maxGrams = readNumber(operation.maxGrams, 'maxGrams', { min: 0, max: MAX_GRAMS });

  if (weight !== undefined && weight > 0) {
    if (isAuto === true) throw new Error('Give either a fixed weight or isAuto: true, not both.');
    if ((minGrams || 0) > 0 || (maxGrams || 0) > 0) {
      throw new Error('minGrams and maxGrams only apply to AUTO ingredients; a fixed weight clears them.');
    }
    next.weight = formatGrams(weight);
    next.isAuto = false;
    next.minGrams = '';
    next.maxGrams = '';
  } else if (weight === 0 && isAuto !== true) {
    throw new Error('weight must be more than 0 g. To leave the ingredient out, set disabled: true or remove it.');
  }

  if (isAuto === true) {
    next.isAuto = true;
    next.weight = '';
  } else if (isAuto === false && !(weight > 0) && (current.isAuto || !current.weight)) {
    throw new Error('isAuto: false needs a fixed weight in grams as well.');
  }

  if (minGrams !== undefined || maxGrams !== undefined) {
    if (!next.isAuto) throw new Error('minGrams and maxGrams only apply to AUTO ingredients; set isAuto: true as well.');
    if (minGrams !== undefined) next.minGrams = minGrams > 0 ? formatGrams(minGrams) : '';
    if (maxGrams !== undefined) next.maxGrams = maxGrams > 0 ? formatGrams(maxGrams) : '';
  }
  if (next.isAuto && next.minGrams && next.maxGrams && Number(next.minGrams) > Number(next.maxGrams)) {
    throw new Error(`The AUTO range would run backwards (min ${next.minGrams} g, max ${next.maxGrams} g).`);
  }

  const disabled = readBoolean(operation.disabled, 'disabled');
  if (disabled !== undefined) next.disabled = disabled;
  const personalOnly = readBoolean(operation.personalOnly, 'personalOnly');
  if (personalOnly !== undefined) next.personalOnly = personalOnly;
  const split = readText(operation.split, 'split', MAX_SPLIT_CHARS);
  if (split !== undefined) next.split = split;

  return next;
}

/** The ingredient fields an operation set, parsed, for its canonical form. */
function canonicalIngredientFields(operation) {
  return {
    name: readText(operation.name, 'name', MAX_NAME_CHARS),
    weight: readNumber(operation.weight, 'weight', { min: 0, max: MAX_GRAMS }),
    isAuto: readBoolean(operation.isAuto, 'isAuto'),
    minGrams: readNumber(operation.minGrams, 'minGrams', { min: 0, max: MAX_GRAMS }),
    maxGrams: readNumber(operation.maxGrams, 'maxGrams', { min: 0, max: MAX_GRAMS }),
    disabled: readBoolean(operation.disabled, 'disabled'),
    personalOnly: readBoolean(operation.personalOnly, 'personalOnly'),
    split: readText(operation.split, 'split', MAX_SPLIT_CHARS)
  };
}

// -------------------------------------------------------------
// ACTIONS
// Each one edits the working copy in place and returns its canonical
// operation plus the changes it made.
// -------------------------------------------------------------

function updateTargets(builder, operation) {
  const calories = readNumber(operation.dailyCalorieTarget, 'dailyCalorieTarget', { min: 500, max: 10000 });
  const ratioMin = readNumber(operation.idealSodiumPotassiumRatioMin, 'idealSodiumPotassiumRatioMin', { min: 0.01, max: 5 });
  const ratioMax = readNumber(operation.idealSodiumPotassiumRatioMax, 'idealSodiumPotassiumRatioMax', { min: 0.01, max: 5 });
  if (calories === undefined && ratioMin === undefined && ratioMax === undefined) {
    throw new Error('update_targets needs dailyCalorieTarget, idealSodiumPotassiumRatioMin or idealSodiumPotassiumRatioMax.');
  }

  const before = builder.global;
  const after = { ...before };
  if (calories !== undefined) after.dailyCalorieTarget = Math.round(calories);
  if (ratioMin !== undefined) after.idealSodiumPotassiumRatioMin = round(ratioMin, 3);
  if (ratioMax !== undefined) after.idealSodiumPotassiumRatioMax = round(ratioMax, 3);

  const low = after.idealSodiumPotassiumRatioMin;
  const high = after.idealSodiumPotassiumRatioMax;
  if (typeof low === 'number' && typeof high === 'number' && low > high) {
    throw new Error(`The Na:K range would run backwards (min ${low}, max ${high}).`);
  }

  const changes = [];
  const show = (value, unit = '') => (typeof value === 'number' ? `${value}${unit}` : '');
  pushChange(changes, 'Targets', 'Calorie target', show(before.dailyCalorieTarget, ' kcal'), show(after.dailyCalorieTarget, ' kcal'));
  pushChange(changes, 'Targets', 'Min Na:K ratio', show(before.idealSodiumPotassiumRatioMin), show(after.idealSodiumPotassiumRatioMin));
  pushChange(changes, 'Targets', 'Max Na:K ratio', show(before.idealSodiumPotassiumRatioMax), show(after.idealSodiumPotassiumRatioMax));
  if (changes.length === 0) throw new Error('Nothing to change: the targets already have those values.');

  builder.global = after;
  return {
    operation: compact({
      action: 'update_targets',
      dailyCalorieTarget: calories === undefined ? undefined : after.dailyCalorieTarget,
      idealSodiumPotassiumRatioMin: ratioMin === undefined ? undefined : after.idealSodiumPotassiumRatioMin,
      idealSodiumPotassiumRatioMax: ratioMax === undefined ? undefined : after.idealSodiumPotassiumRatioMax
    }),
    changes
  };
}

/** Meal fields shared by update_meal and add_meal, parsed. */
function readMealFields(operation) {
  const cookQuantityMode = isGiven(operation.cookQuantityMode) && operation.cookQuantityMode !== ''
    ? String(operation.cookQuantityMode).trim()
    : undefined;
  if (cookQuantityMode !== undefined && !COOK_QUANTITY_LABELS[cookQuantityMode]) {
    throw new Error(`cookQuantityMode must be "daily" or "per-meal", got "${operation.cookQuantityMode}".`);
  }
  return {
    name: readText(operation.name, 'name', MAX_NAME_CHARS),
    mealsPerDay: readNumber(operation.mealsPerDay, 'mealsPerDay', { min: 1, max: 12, integer: true }),
    disabled: readBoolean(operation.disabled, 'disabled'),
    cookQuantityMode,
    prepMethod: readText(operation.prepMethod, 'prepMethod', MAX_PREP_CHARS)
  };
}

function assertUniqueMealName(builder, name, except) {
  const namesake = builder.meals.find((meal) => meal !== except && sameName(meal.name, name));
  if (namesake) throw new Error(`Another meal is already named "${displayName(namesake.name)}" (${namesake.id}).`);
}

function updateMeal(builder, operation) {
  const meal = findMeal(builder, operation.meal);
  const fields = readMealFields(operation);
  if (fields.name === '') throw new Error('name cannot be empty.');
  if (fields.name !== undefined) assertUniqueMealName(builder, fields.name, meal);

  const after = { ...meal, ...compact(fields) };
  const where = displayName(meal.name);
  const changes = [];
  pushChange(changes, where, 'Name', displayName(meal.name), displayName(after.name));
  pushChange(changes, where, 'Meals per day', String(meal.mealsPerDay ?? 1), String(after.mealsPerDay ?? 1));
  pushChange(changes, where, 'Status', describeStatus(meal.disabled), describeStatus(after.disabled));
  pushChange(changes, where, 'Cook quantity', describeCookQuantity(meal.cookQuantityMode), describeCookQuantity(after.cookQuantityMode));
  pushChange(changes, where, 'Prep method', displayName(meal.prepMethod), displayName(after.prepMethod));
  if (changes.length === 0) throw new Error(`Nothing to change: "${where}" already has those values.`);

  builder.meals[builder.meals.indexOf(meal)] = after;
  return { operation: compact({ action: 'update_meal', meal: meal.id, ...fields }), changes };
}

function addMeal(builder, operation) {
  const fields = readMealFields(operation);
  const name = readText(operation.name, 'name', MAX_NAME_CHARS, { required: true });
  assertUniqueMealName(builder, name);

  // The id is fixed when the change is drafted so applying it later creates
  // the same meal the card showed. A taken id means the draft is out of date —
  // never fall back to a fresh one, or later operations would land on
  // whichever meal already owns it.
  let id = operation.id;
  if (isGiven(id)) {
    if (typeof id !== 'string' || !/^meal-[A-Za-z0-9-]{1,40}$/.test(id)) throw new Error('add_meal takes no id.');
    if (builder.meals.some((meal) => meal.id === id)) throw new Error(`A meal with id ${id} already exists.`);
  } else {
    let stamp = Date.now();
    while (builder.meals.some((meal) => meal.id === `meal-${stamp}`)) stamp++;
    id = `meal-${stamp}`;
  }

  const meal = {
    id,
    name,
    mealsPerDay: fields.mealsPerDay ?? 1,
    cookQuantityMode: fields.cookQuantityMode ?? 'daily',
    ingredients: [],
    prepMethod: fields.prepMethod ?? '',
    disabled: fields.disabled ?? false
  };
  builder.meals.push(meal);

  const details = [`${meal.mealsPerDay}× a day`, describeCookQuantity(meal.cookQuantityMode).toLowerCase()];
  if (meal.disabled) details.push('inactive');
  return {
    operation: compact({ action: 'add_meal', ...fields, name, id }),
    changes: [{ kind: 'add', where: name, field: 'Meal', before: '', after: `New meal · ${details.join(' · ')}` }]
  };
}

function removeMeal(builder, operation) {
  const meal = findMeal(builder, operation.meal);
  if (builder.meals.length <= 1) throw new Error('The Diet Builder needs at least one meal, so the last one cannot be removed.');

  const where = displayName(meal.name);
  const count = meal.ingredients.length;
  const changes = [{
    kind: 'remove',
    where,
    field: 'Meal',
    before: `${where} and its ${count} ingredient${count === 1 ? '' : 's'}`,
    after: ''
  }];
  builder.meals = builder.meals.filter((entry) => entry !== meal);

  // Its daily ingredients go with it, as when the meal is deleted in the
  // builder: left behind they would show there but never reach the prompt.
  const days = Object.keys(builder.dailyVariables).sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  for (const day of days) {
    const list = builder.dailyVariables[day] || [];
    const removed = list.filter((ingredient) => ownerOf(ingredient) === meal.id);
    if (removed.length === 0) continue;
    builder.dailyVariables[day] = list.filter((ingredient) => ownerOf(ingredient) !== meal.id);
    const dayWhere = DAYS.includes(day) ? `${dayLabel(day)} · ${where}` : `${day} · ${where}`;
    for (const ingredient of removed) {
      changes.push({ kind: 'remove', where: dayWhere, field: 'Ingredient', before: describeIngredient(ingredient), after: '' });
    }
  }

  return { operation: { action: 'remove_meal', meal: meal.id }, changes };
}

function addIngredient(builder, operation) {
  const day = readDay(operation.day);
  const meal = findMeal(builder, operation.meal);
  const name = readText(operation.name, 'name', MAX_NAME_CHARS, { required: true });
  const { list, where } = ingredientList(builder, day, meal);
  if (hasNamesake(list, name, meal.id, day)) {
    throw new Error(`${where} already has an ingredient named "${name}"; change that one instead of adding another.`);
  }

  // Same defaults as the builder's own "+ Add Ingredient" buttons.
  const blank = day
    ? { name, weight: '', isAuto: false, personalOnly: false, mealId: meal.id }
    : { name, weight: '', isAuto: false };
  const ingredient = applyIngredientFields(blank, operation);
  if (!ingredient.isAuto && !ingredient.weight) throw new Error('A new ingredient needs a fixed weight or isAuto: true.');
  list.push(ingredient);

  return {
    operation: compact({ action: 'add_ingredient', meal: meal.id, day, ...canonicalIngredientFields(operation), name }),
    changes: [{ kind: 'add', where, field: 'Ingredient', before: '', after: describeIngredient(ingredient) }]
  };
}

/** The ingredient an update or remove names, with the meal that owns it. */
function locateIngredient(builder, operation, action) {
  const day = readDay(operation.day);
  const meal = isGiven(operation.meal) && operation.meal !== '' ? findMeal(builder, operation.meal) : null;
  if (!day && !meal) throw new Error(`${action} needs meal, plus day for a daily ingredient.`);
  const name = readText(operation.ingredient, 'ingredient', MAX_NAME_CHARS, { required: true });
  const { list, index } = findIngredient(builder, day, meal, name);
  const ingredient = list[index];
  // Pin a daily ingredient to its meal, so applying the draft later cannot
  // land on a same-named ingredient another meal gained in the meantime.
  const ownerId = day ? ownerOf(ingredient) : meal.id;
  const owner = builder.meals.find((entry) => entry.id === ownerId) || null;
  return { day, list, index, ingredient, owner, ownerName: owner ? displayName(owner.name) : mealName(builder, ownerId) };
}

function updateIngredient(builder, operation) {
  const { day, list, index, ingredient, owner, ownerName } = locateIngredient(builder, operation, 'update_ingredient');
  const where = day
    ? `${dayLabel(day)} · ${ownerName} · ${displayName(ingredient.name)}`
    : `${ownerName} · ${displayName(ingredient.name)}`;

  const next = applyIngredientFields(ingredient, operation);
  if (!sameName(next.name, ingredient.name) && hasNamesake(list, next.name, ownerOf(ingredient), day, ingredient)) {
    throw new Error(`${day ? `${dayLabel(day)} · ${ownerName}` : ownerName} already has an ingredient named "${next.name}".`);
  }

  const changes = ingredientChanges(where, ingredient, next);
  if (changes.length === 0) throw new Error(`Nothing to change: ${where} already has those values.`);

  list[index] = next;
  return {
    operation: compact({
      action: 'update_ingredient',
      meal: owner ? owner.id : undefined,
      day,
      ingredient: displayName(ingredient.name),
      ...canonicalIngredientFields(operation)
    }),
    changes
  };
}

function removeIngredient(builder, operation) {
  const { day, list, index, ingredient, owner, ownerName } = locateIngredient(builder, operation, 'remove_ingredient');
  if (!day && list.length === 1) {
    throw new Error(`That would leave "${ownerName}" with no ingredients; remove the meal instead.`);
  }

  list.splice(index, 1);
  return {
    operation: compact({ action: 'remove_ingredient', meal: owner ? owner.id : undefined, day, ingredient: displayName(ingredient.name) }),
    changes: [{
      kind: 'remove',
      where: day ? `${dayLabel(day)} · ${ownerName}` : ownerName,
      field: 'Ingredient',
      before: describeIngredient(ingredient),
      after: ''
    }]
  };
}

const HANDLERS = {
  update_targets: updateTargets,
  update_meal: updateMeal,
  add_meal: addMeal,
  remove_meal: removeMeal,
  add_ingredient: addIngredient,
  update_ingredient: updateIngredient,
  remove_ingredient: removeIngredient
};

// -------------------------------------------------------------
// ENTRY POINTS
// -------------------------------------------------------------

function applyOperation(builder, operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error('Each operation must be an object with an action.');
  }
  const action = typeof operation.action === 'string' ? operation.action.trim() : '';
  if (!HANDLERS[action]) throw new Error(`Unknown action "${operation.action}". Use one of: ${ACTIONS.join(', ')}.`);

  // A field the action ignores is almost always a mistake in the draft (a
  // weight on a meal, a day on a target); saying so beats silently dropping it.
  const accepted = ACTION_FIELDS[action];
  const foreign = Object.keys(operation)
    .filter((key) => key !== 'action' && !accepted.includes(key) && isGiven(operation[key]) && operation[key] !== '');
  if (foreign.length > 0) {
    const listed = accepted.filter((key) => key !== 'id').join(', ');
    throw new Error(`${foreign.join(', ')} ${foreign.length === 1 ? 'does' : 'do'} not apply to ${action}, which takes: ${listed}.`);
  }

  return HANDLERS[action](builder, { ...operation, action });
}

/**
 * Apply drafted operations to a copy of the builder, in order, all or nothing.
 *
 * @param {Builder} builder
 * @param {unknown} operations
 * @returns {{ builder: Builder, operations: BuilderOperation[], changes: BuilderChange[] }}
 */
function applyBuilderOperations(builder, operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new Error('A change needs at least one operation.');
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(`A change can hold at most ${MAX_OPERATIONS} operations (got ${operations.length}); split it up.`);
  }

  const working = JSON.parse(JSON.stringify({
    global: builder.global || {},
    meals: builder.meals || [],
    dailyVariables: builder.dailyVariables || {}
  }));
  const canonical = [];
  const changes = [];

  operations.forEach((operation, index) => {
    try {
      const result = applyOperation(working, operation);
      canonical.push(result.operation);
      changes.push(...result.changes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const action = operation && typeof operation.action === 'string' ? ` (${operation.action})` : '';
      throw new Error(operations.length > 1 ? `Operation ${index + 1}${action}: ${message}` : message);
    }
  });

  for (const operation of canonical) {
    if (operation.action !== 'add_meal') continue;
    const meal = working.meals.find((entry) => entry.id === operation.id);
    if (meal && meal.ingredients.length === 0) {
      throw new Error(`The new meal "${meal.name}" has no ingredients; add them with add_ingredient in the same change.`);
    }
  }

  return { builder: working, operations: canonical, changes };
}

/**
 * Whether a value has the builder's shape, for builder state arriving over
 * the network. Mirrors the check builder-history.ts runs on stored steps.
 */
function isBuilderSnapshot(value) {
  const isIngredientList = (list) => Array.isArray(list) && list.every((entry) => entry && typeof entry.name === 'string');
  return !!value && typeof value === 'object'
    && !!value.global && typeof value.global === 'object'
    && Array.isArray(value.meals)
    && value.meals.every((meal) => meal && typeof meal.id === 'string' && isIngredientList(meal.ingredients))
    && !!value.dailyVariables && typeof value.dailyVariables === 'object' && !Array.isArray(value.dailyVariables)
    && Object.values(value.dailyVariables).every(isIngredientList);
}

module.exports = {
  ACTIONS,
  DAYS,
  applyBuilderOperations,
  formatChange,
  isBuilderSnapshot
};
