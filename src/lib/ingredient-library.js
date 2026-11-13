/**
 * The ingredient library: per-100g raw nutrition for every ingredient a plan
 * can be priced from.
 *
 * The rows live in the IngredientEntry collection (see ingredient-store.js)
 * and are edited from the Diet Builder's Ingredient Library tab. This module
 * is the part every side shares — name matching, the line each row prints as
 * in the prompt, validation, and the rows a fresh database is seeded with.
 *
 * Used by:
 *   - src/lib/compile-prompt.js  (which rows a day's prompt carries)
 *   - src/lib/verify-plan.js     (resolving a printed name to a row)
 *   - the Diet Builder           (warning on an ingredient with no row)
 *   - whatsapp-worker.js         (CommonJS require)
 *
 * Keep this file as plain JS with no server-only imports, so it works in the
 * browser, in API routes and in the worker without a build step.
 *
 * @typedef {object} LibraryEntry
 * @property {string} [id]          Database id; absent on built-in and seed rows.
 * @property {string} name          The primary spelling.
 * @property {string[]} [aliases]   Other spellings that resolve to this row.
 * @property {number} kcal          Per 100g raw, like every figure below.
 * @property {number} protein       Grams.
 * @property {number} carbs         Grams.
 * @property {number} fat           Grams.
 * @property {number} sodium        Milligrams.
 * @property {number} potassium     Milligrams.
 * @property {string} [note]        Where the figures came from.
 * @property {boolean} [builtIn]    Part of the calculation rules; not editable.
 */

/** Sodium delivered by 1 g of table salt. The prompt's R6 divides by this too. */
const SODIUM_MG_PER_G_SALT = 388;

/**
 * Table salt is not a library row. The sodium rules and the verifier both
 * work in "mg of sodium per gram of salt", so its figure is part of the
 * calculation contract rather than something to edit, and its prompt line has
 * its own wording. It always leads the reference table.
 */
const SALT_ENTRY = Object.freeze({
  name: 'Table Salt (NaCl)',
  aliases: Object.freeze(['salt', 'Table Salt', 'NaCl']),
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  sodium: SODIUM_MG_PER_G_SALT * 100,
  potassium: 0,
  note: `Built in: the sodium rules count every gram of salt at ${SODIUM_MG_PER_G_SALT} mg sodium. Any ingredient whose name contains the word "salt" is priced as this.`,
  builtIn: true
});

const SALT_REFERENCE_LINE =
  `Table Salt (NaCl) / salt / Table Salt: 0 kcal, 0.0g Protein, 0.0g Carbs, 0.0g Fat, ${SODIUM_MG_PER_G_SALT}mg Sodium per 1g of salt, 0mg Potassium`;

const USDA = 'USDA FoodData Central (SR Legacy)';

/**
 * What a database with no library yet is seeded with.
 *
 * These started as the table that used to be hardcoded in compile-prompt.js.
 * Every row with a USDA record was then checked against it (2026-11-13) and
 * the five that differed beyond rounding were corrected — see LEGACY_FIGURES.
 * Each row's note says where its figures come from, and says so plainly when
 * they could not be checked.
 *
 * @type {LibraryEntry[]}
 */
const DEFAULT_INGREDIENT_LIBRARY = [
  { name: 'Water', aliases: ['water'], kcal: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, potassium: 0 },
  {
    name: 'Whey Protein Isolate - myprotein matcha blueberry', aliases: [],
    kcal: 367, protein: 77, carbs: 8.71, fat: 2.03, sodium: 240, potassium: 400,
    note: 'Not checked against the tub. Myprotein panels for other Impact Whey Isolate flavours list about 86g protein per 100g, so compare this with your label; potassium is rarely printed and is an estimate.'
  },
  {
    name: 'Fast & up Whey Protein Isolate', aliases: [],
    kcal: 375, protein: 81, carbs: 3.5, fat: 1.5, sodium: 180, potassium: 350,
    note: 'Not checked against the tub — compare with your label. Potassium is rarely printed and is an estimate.'
  },
  {
    name: 'Whey Protein Isolate (Generic)', aliases: ['Default WPI'],
    kcal: 375, protein: 83, carbs: 3, fat: 1.2, sodium: 180, potassium: 380,
    note: 'Typical figures for an unflavoured isolate, not a specific product.'
  },
  { name: 'Instant Oats (Raw)', aliases: ['Oats (Raw)', 'oats'], kcal: 379, protein: 13.2, carbs: 67.7, fat: 6.5, sodium: 6, potassium: 362, note: `${USDA}: Cereals, oats, regular and quick, not fortified, dry.` },
  { name: 'chicken breast', aliases: ['Chicken Breast (Raw)'], kcal: 120, protein: 22.5, carbs: 0, fat: 2.6, sodium: 45, potassium: 334, note: `${USDA}: Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw.` },
  { name: 'Olive oil', aliases: ['olive oil'], kcal: 884, protein: 0, carbs: 0, fat: 100, sodium: 2, potassium: 1, note: `${USDA}: Oil, olive, salad or cooking.` },
  { name: 'Rice', aliases: ['White Rice'], kcal: 365, protein: 7.1, carbs: 80, fat: 0.7, sodium: 5, potassium: 115, note: `${USDA}: Rice, white, long-grain, regular, raw, unenriched.` },
  { name: 'Potato (Raw)', aliases: ['potato'], kcal: 77, protein: 2, carbs: 17.5, fat: 0.1, sodium: 6, potassium: 425, note: `${USDA}: Potatoes, flesh and skin, raw.` },
  { name: 'Sweet Potato', aliases: [], kcal: 86, protein: 1.6, carbs: 20.1, fat: 0.1, sodium: 55, potassium: 337, note: `${USDA}: Sweet potato, raw, unprepared.` },
  { name: 'Tomato', aliases: ['tomato'], kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, sodium: 5, potassium: 237, note: `${USDA}: Tomatoes, red, ripe, raw, year round average.` },
  { name: 'Spinach', aliases: [], kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, sodium: 79, potassium: 558, note: `${USDA}: Spinach, raw.` },
  { name: 'Bottle Gourd', aliases: [], kcal: 14, protein: 0.6, carbs: 3.4, fat: 0.02, sodium: 2, potassium: 150, note: `${USDA}: Gourd, white-flowered (calabash), raw.` },
  {
    name: 'Cluster Beans', aliases: [],
    kcal: 36, protein: 3.2, carbs: 5, fat: 0.4, sodium: 4, potassium: 230,
    note: 'Not in USDA. Calories and macros agree with figures attributed to the Indian Food Composition Tables (2017); potassium is quoted anywhere from 230 to 370mg and sodium could not be confirmed.'
  },
  { name: 'Brinjal', aliases: [], kcal: 25, protein: 1, carbs: 5.9, fat: 0.2, sodium: 2, potassium: 229, note: `${USDA}: Eggplant, raw.` },
  { name: 'Besan', aliases: [], kcal: 387, protein: 22.4, carbs: 57.8, fat: 6.7, sodium: 64, potassium: 846, note: `${USDA}: Chickpea flour (besan).` },
  {
    name: 'poha', aliases: [],
    kcal: 353, protein: 6.7, carbs: 77.3, fat: 1.2, sodium: 8, potassium: 130,
    note: 'Not in USDA. Macros match Indian food-table figures for rice flakes (which give 346 kcal); sodium and potassium could not be confirmed.'
  },
  { name: 'Almonds', aliases: [], kcal: 579, protein: 21.2, carbs: 21.6, fat: 49.9, sodium: 1, potassium: 733, note: `${USDA}: Nuts, almonds.` },
  { name: 'Cashews', aliases: [], kcal: 553, protein: 18.2, carbs: 30.2, fat: 43.8, sodium: 12, potassium: 660, note: `${USDA}: Nuts, cashew nuts, raw.` },
  { name: 'Walnuts', aliases: [], kcal: 654, protein: 15.2, carbs: 13.7, fat: 65.2, sodium: 2, potassium: 441, note: `${USDA}: Nuts, walnuts, english.` },
  { name: 'Banana', aliases: ['banana'], kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3, sodium: 1, potassium: 358, note: `${USDA}: Bananas, raw.` },
  { name: 'Raisins', aliases: [], kcal: 299, protein: 3.3, carbs: 79.3, fat: 0.25, sodium: 26, potassium: 744, note: `${USDA}: Raisins, dark, seedless.` },
  {
    name: 'Kimia Dates', aliases: [],
    kcal: 277, protein: 1.8, carbs: 75, fat: 0.2, sodium: 2, potassium: 696,
    note: 'Kimia (Mazafati) dates are not in USDA; these are its Medjool figures, the closest soft date.'
  },
  { name: 'Eggs', aliases: ['egg', 'eggs'], kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, sodium: 142, potassium: 138, note: `${USDA}: Egg, whole, raw, fresh.` },
  {
    name: 'aamchur powder', aliases: [],
    kcal: 300, protein: 3, carbs: 68, fat: 1.5, sodium: 30, potassium: 250,
    note: 'An estimate for dried mango powder; no reference source. Used by the gram, so it barely moves a day\'s totals.'
  },
  {
    name: 'Chaat Masala',
    aliases: ['chat masala', 'Everest Chaat Masala'],
    kcal: 338,
    protein: 5,
    carbs: 71.7,
    fat: 3.5,
    sodium: 20010,
    potassium: 500,
    note: 'Everest Chaat Masala, read off the per-100g panel on the box (1414 kJ). The blend is about half salt, so a 2g sprinkle carries ~400mg sodium. Potassium is not on the label ("not a significant source"); 500mg is a deliberately conservative estimate for the spice half of the blend.'
  }
];

/**
 * The figures the hardcoded table carried for the rows corrected above.
 *
 * Kept because cached plans were priced from them. The config hash compares a
 * day's rows against the table as it was (LEGACY_REFERENCE_LIBRARY), not as it
 * is seeded now, so a plan generated before the correction is marked out of
 * date on exactly the days that use a corrected row, and nowhere else.
 */
const LEGACY_FIGURES = {
  'Instant Oats (Raw)': { potassium: 350 },
  'chicken breast': { fat: 2.5, potassium: 300 },
  'Potato (Raw)': { potassium: 421 },
  'Brinjal': { potassium: 230 },
  'Raisins': { protein: 3.1, carbs: 79.2, fat: 0.5, sodium: 20, potassium: 749 }
};

/**
 * The reference table exactly as it was while hardcoded: the yardstick that
 * keeps a config hash unchanged for days whose rows have not moved since.
 *
 * @type {LibraryEntry[]}
 */
const LEGACY_REFERENCE_LIBRARY = DEFAULT_INGREDIENT_LIBRARY.map((entry) =>
  (LEGACY_FIGURES[entry.name] ? { ...entry, ...LEGACY_FIGURES[entry.name] } : entry)
);

const NAME_MAX_LENGTH = 120;
const NOTE_MAX_LENGTH = 600;
const MAX_ALIASES = 12;

/** The normalisation every side uses, so a name resolves alike everywhere. */
function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "potato (raw)" -> "potato": the un-parenthesised fallback form. */
function baseName(normalized) {
  return normalized.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Trim and collapse whitespace, keeping the user's capitalisation. */
function tidyName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

/** Every spelling of a row, primary name first. */
function entryNames(entry) {
  return [entry.name, ...(entry.aliases || [])];
}

/** Salt first, then the library in its own order. */
function withBuiltIns(library) {
  return [SALT_ENTRY, ...(library || [])];
}

/**
 * Build the one name resolver the prompt compiler, the verifier and the
 * builder all share. The first rule that matches wins; within a rule, the
 * earlier row wins:
 *   1. the name as written (case and spacing aside)
 *   2. the name without a bracketed qualifier:  "Potato (boiled)" -> "potato"
 *   3. a row spelling without its own qualifier: "oats" -> "Oats (Raw)"
 *   4. anything containing the word "salt" is table salt
 *
 * `rows` may be any objects; `namesOf` says how to read a row's spellings.
 * Rows are expected to already include the salt row when rule 4 should apply.
 *
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string[]} [namesOf]
 * @returns {(name: string) => T | null}
 */
function createLibraryLookup(rows, namesOf = entryNames) {
  const exact = new Map();
  const unqualified = new Map();

  for (const row of rows || []) {
    for (const spelling of namesOf(row)) {
      const normalized = normalizeName(spelling);
      if (!normalized) continue;
      if (!exact.has(normalized)) exact.set(normalized, row);
      const base = baseName(normalized);
      if (base && !unqualified.has(base)) unqualified.set(base, row);
    }
  }

  return function lookup(name) {
    const normalized = normalizeName(name);
    if (!normalized) return null;
    const base = baseName(normalized);
    return exact.get(normalized)
      || exact.get(base)
      || unqualified.get(normalized)
      || unqualified.get(base)
      || (/\bsalt\b/.test(normalized) ? exact.get('salt') : null)
      || null;
  };
}

/**
 * The library row (or the built-in salt row) an ingredient name is priced
 * from, or null when nothing matches and the model would have to guess.
 *
 * @param {string} name
 * @param {LibraryEntry[]} library
 * @returns {LibraryEntry | null}
 */
function findLibraryEntry(name, library) {
  return createLibraryLookup(withBuiltIns(library))(name);
}

/**
 * The rows a set of ingredient names needs, salt first and the rest in
 * library order. Salt is always carried: the sodium rules refer to it whether
 * or not the day lists any. A name that matches nothing simply has no row.
 *
 * @param {string[]} ingredientNames
 * @param {LibraryEntry[]} library
 * @returns {LibraryEntry[]}
 */
function referenceEntriesFor(ingredientNames, library) {
  const lookup = createLibraryLookup(withBuiltIns(library));
  const needed = new Set([SALT_ENTRY]);
  for (const name of ingredientNames || []) {
    const entry = lookup(name);
    if (entry) needed.add(entry);
  }
  return withBuiltIns(library).filter((entry) => needed.has(entry));
}

/** A figure with at least `minDecimals` and at most `maxDecimals` places. */
function formatFigure(value, minDecimals, maxDecimals) {
  const [whole, fraction = ''] = (Number(value) || 0).toFixed(maxDecimals).split('.');
  let kept = fraction;
  while (kept.length > minDecimals && kept.endsWith('0')) kept = kept.slice(0, -1);
  return kept ? `${whole}.${kept}` : whole;
}

/**
 * One row exactly as the prompt prints it. verify-plan.js parses this text
 * back, so the wording is a contract — change it and change the parser.
 *
 * @param {LibraryEntry} entry
 * @returns {string}
 */
function formatReferenceLine(entry) {
  if (entry === SALT_ENTRY) return SALT_REFERENCE_LINE;
  const kcal = Number(entry.kcal) || 0;
  return `${entryNames(entry).join(' / ')}: ${formatFigure(kcal, 0, 1)} kcal (${formatFigure(kcal / 100, 2, 4)} kcal/g), `
    + `${formatFigure(entry.protein, 1, 2)}g Protein, ${formatFigure(entry.carbs, 1, 2)}g Carbs, ${formatFigure(entry.fat, 1, 2)}g Fat, `
    + `${formatFigure(entry.sodium, 0, 1)}mg Sodium, ${formatFigure(entry.potassium, 0, 1)}mg Potassium`;
}

const NUMERIC_FIELDS = [
  { key: 'kcal', label: 'Calories', max: 1000, unit: 'kcal' },
  { key: 'protein', label: 'Protein', max: 100, unit: 'g' },
  { key: 'carbs', label: 'Carbs', max: 100, unit: 'g' },
  { key: 'fat', label: 'Fat', max: 100, unit: 'g' },
  { key: 'sodium', label: 'Sodium', max: 100000, unit: 'mg' },
  { key: 'potassium', label: 'Potassium', max: 100000, unit: 'mg' }
];

function parseAliases(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(/[,\n]/);
  return [];
}

function nameProblem(spelling) {
  if (spelling.length > NAME_MAX_LENGTH) return `"${spelling.slice(0, 40)}…" is longer than ${NAME_MAX_LENGTH} characters.`;
  // The prompt prints a row as "Name / Alias: figures" and the verifier splits
  // it back on those two marks.
  if (/[/:]/.test(spelling)) return `"${spelling}" contains "/" or ":", which the reference table uses as separators.`;
  return '';
}

/**
 * Check and tidy one library row before it is stored.
 *
 * @param {object} raw                     What the form sent.
 * @param {LibraryEntry[]} otherEntries    Every other row, to keep spellings unique.
 * @returns {{ ok: true, entry: LibraryEntry } | { ok: false, error: string }}
 */
function validateLibraryEntry(raw, otherEntries) {
  const fail = (error) => ({ ok: false, error });
  const input = raw && typeof raw === 'object' ? raw : {};

  const name = tidyName(input.name);
  if (!name) return fail('Give the ingredient a name.');

  const aliases = [];
  for (const candidate of parseAliases(input.aliases)) {
    const alias = tidyName(candidate);
    if (alias && alias !== name && !aliases.includes(alias)) aliases.push(alias);
  }
  if (aliases.length > MAX_ALIASES) return fail(`An ingredient can have at most ${MAX_ALIASES} other names.`);

  for (const spelling of [name, ...aliases]) {
    const problem = nameProblem(spelling);
    if (problem) return fail(problem);
  }

  const saltNames = new Set(entryNames(SALT_ENTRY).map(normalizeName));
  const taken = new Map();
  for (const other of otherEntries || []) {
    for (const spelling of entryNames(other)) taken.set(normalizeName(spelling), other.name);
  }
  for (const spelling of [name, ...aliases]) {
    const normalized = normalizeName(spelling);
    if (saltNames.has(normalized)) return fail(`"${spelling}" is the built-in table salt row.`);
    if (taken.has(normalized)) return fail(`"${spelling}" is already listed under "${taken.get(normalized)}".`);
  }

  const figures = {};
  for (const field of NUMERIC_FIELDS) {
    const value = input[field.key];
    if (value === '' || value === null || value === undefined) return fail(`${field.label} is required (enter 0 if there is none).`);
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number) || number < 0) return fail(`${field.label} must be a number, 0 or more.`);
    if (number > field.max) return fail(`${field.label} cannot exceed ${field.max}${field.unit} per 100g.`);
    figures[field.key] = number;
  }
  if (figures.protein + figures.carbs + figures.fat > 100.5) {
    return fail('Protein, carbs and fat add up to more than 100g per 100g. Enter per-100g figures, not per serving.');
  }

  const note = String(input.note || '').trim();
  if (note.length > NOTE_MAX_LENGTH) return fail(`Keep the note under ${NOTE_MAX_LENGTH} characters.`);

  return { ok: true, entry: { name, aliases, ...figures, note } };
}

function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/**
 * Every ingredient the builder would send to the model, with where it is used.
 * Mirrors the prompt compiler's own filters: an inactive meal, a disabled
 * ingredient, and a daily variable whose meal is gone or inactive are all left
 * out, since none of them reaches a prompt.
 *
 * @param {object} config
 * @returns {{ name: string, where: string }[]}
 */
function listBuilderIngredients(config) {
  const meals = ((config && config.meals) || []).filter((meal) => !meal.disabled);
  const uses = [];

  for (const meal of meals) {
    for (const ing of meal.ingredients || []) {
      if (!ing.disabled && tidyName(ing.name)) uses.push({ name: ing.name, where: meal.name });
    }
  }
  for (const day of DAYS_OF_WEEK) {
    for (const ing of mapGet(config && config.dailyVariables, day) || []) {
      if (ing.disabled || !tidyName(ing.name)) continue;
      if (!meals.some((meal) => meal.id === (ing.mealId || 'meal-chicken'))) continue;
      uses.push({ name: ing.name, where: day.charAt(0) + day.slice(1).toLowerCase() });
    }
  }
  return uses;
}

/**
 * Builder ingredients with no library row, one item per distinct spelling.
 *
 * @param {object} config
 * @param {LibraryEntry[]} library
 * @returns {{ name: string, where: string[] }[]}
 */
function findUnlistedIngredients(config, library) {
  const lookup = createLibraryLookup(withBuiltIns(library));
  const missing = new Map();

  for (const use of listBuilderIngredients(config)) {
    if (lookup(use.name)) continue;
    const key = normalizeName(use.name);
    if (!missing.has(key)) missing.set(key, { name: tidyName(use.name), where: [] });
    const item = missing.get(key);
    if (!item.where.includes(use.where)) item.where.push(use.where);
  }
  return Array.from(missing.values());
}

module.exports = {
  SODIUM_MG_PER_G_SALT,
  SALT_ENTRY,
  DEFAULT_INGREDIENT_LIBRARY,
  LEGACY_REFERENCE_LIBRARY,
  normalizeName,
  baseName,
  entryNames,
  withBuiltIns,
  createLibraryLookup,
  findLibraryEntry,
  referenceEntriesFor,
  formatReferenceLine,
  validateLibraryEntry,
  listBuilderIngredients,
  findUnlistedIngredients
};
