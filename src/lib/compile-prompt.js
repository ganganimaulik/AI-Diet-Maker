/**
 * Shared prompt compilation logic.
 *
 * Used by:
 *   - src/app/page.tsx  (ES import)
 *   - whatsapp-worker.js (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step
 * for the worker.
 *
 * Section order matters: everything above "DAY DATA" is identical for all seven
 * days of one config, so a provider's prefix cache covers it and only the tail
 * is billed as fresh input on days 2-7. Keep day-specific text out of the rules.
 * The one exception is a meal switched off for a day (meal.disabledDays): that
 * day's prompt is compiled as if the meal did not exist, so its prefix differs.
 *
 * verify-plan.js parses this output (the reference table, and every heading and
 * phrase the templates below ask for), so those strings are a contract — change
 * one and change the verifier with it.
 *
 * The reference table itself is data: the ingredient library, stored in the
 * database and edited from the Diet Builder. Callers load it once
 * (ingredient-store.js) and pass it in as `options.library`; this module only
 * decides which of its rows a day needs.
 *
 * Worked examples in the templates must use placeholder names only. An example
 * built from real ingredients gets copied instead of the configuration: a
 * "Table Salt (NaCl)" row in a sample table had both DeepSeek and Kimi renaming
 * the configured "salt" ingredient in 5 of 6 runs, which the verifier reports as
 * one missing and one invented ingredient per meal.
 */

const { referenceEntriesFor, formatReferenceLine } = require('./ingredient-library.js');

const DEFAULT_DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// Bump this whenever the prompt template changes in a way that affects the
// generated plan. It is mixed into the config hash so cached responses
// produced by an older template are invalidated.
const PROMPT_TEMPLATE_VERSION = 15;

/**
 * Safely read a key from a value that might be a plain object or a Mongoose Map.
 */
function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

/**
 * The reference table lines for a set of ingredient names, exactly as printed.
 *
 * A day's prompt carries only the rows that day actually uses: an unused row
 * is a distractor the model can pick by mistake (three near-identical whey
 * rows were the worst offender) and ~40 tokens of nothing. Salt is always
 * carried, because the sodium rules refer to it. A name that matches no
 * library row has no line — the model is told to fall back to USDA values for
 * it, and the Diet Builder flags the ingredient so that does not go unnoticed.
 */
function referenceLinesFor(ingredientNames, library) {
  return referenceEntriesFor(ingredientNames, library).map((entry) => `- ${formatReferenceLine(entry)}`);
}

function requireLibrary(library, caller) {
  if (!Array.isArray(library)) {
    throw new Error(`${caller} needs the ingredient library — load it with loadIngredientLibrary() and pass it in.`);
  }
  return library;
}

/**
 * Whether a meal is part of the given day's plan. A meal is left out when it
 * is inactive altogether (`disabled`) or switched off for that weekday
 * (`disabledDays`, upper-case day names).
 */
function isMealActiveOnDay(meal, day) {
  if (!meal || meal.disabled) return false;
  const dayKey = String(day || '').toUpperCase();
  return !Array.from(meal.disabledDays || []).some(off => String(off).toUpperCase() === dayKey);
}

/** The meals a day's plan is built from, in config order. */
function activeMealsForDay(config, day) {
  return ((config && config.meals) || []).filter(meal => isMealActiveOnDay(meal, day));
}

/**
 * Derive a human-readable variant name from a day's ingredient list.
 */
function getDayVariantName(ingredients, mealsList) {
  const activeMeals = mealsList || [];
  const nonStapleNames = (ingredients || [])
    .filter(ing => {
      if (ing.disabled || ing.personalOnly) return false;
      if (activeMeals.length > 0) {
        const mealId = ing.mealId || 'meal-chicken';
        return activeMeals.some(m => m.id === mealId);
      }
      return true;
    })
    .map(ing => ing.name);
  if (nonStapleNames.length === 0) return 'Staples Only';
  if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
  return nonStapleNames.join(' + ');
}

/**
 * A meal's heading line in the cook's Part 2, e.g. "Vegetable Meal: 4 Meals Per Day".
 * Every meal carries its count, whatever its quantity mode: the cook needs it to
 * make that many portions of a per-meal list, or to divide a daily total into
 * that many. verify-plan.js checks each Part 2 block against this exact line.
 */
function cookMealHeading(meal) {
  const count = meal.mealsPerDay;
  return `${String(meal.name || '').trim()}: ${count} Meal${count > 1 ? 's' : ''} Per Day`;
}

/** The tail every ingredient line carries: split instruction, personal-only flag. */
function ingredientSuffix(ing) {
  return `${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}`;
}

/** "[AUTO]" / "[AUTO, min 60g, max 400g]" / "120g". */
function weightLabel(ing) {
  if (!ing.isAuto) return `${ing.weight}g`;
  const constraints = [];
  if (ing.minGrams) constraints.push(`min ${ing.minGrams}g`);
  if (ing.maxGrams) constraints.push(`max ${ing.maxGrams}g`);
  return constraints.length > 0 ? `[AUTO, ${constraints.join(', ')}]` : '[AUTO]';
}

/**
 * Format a single ingredient line (for daily variable listing).
 */
function formatIngredientEntry(ing, mealsList) {
  const mealId = ing.mealId || 'meal-chicken';
  const meal = mealsList && mealsList.find(m => m.id === mealId);
  const mealLabel = meal ? ` (belongs to ${meal.name})` : '';
  return `${ing.name}: ${weightLabel(ing)}${ingredientSuffix(ing)}${mealLabel}`;
}

/** Active meal ingredients plus that day's variables, for the reference filter. */
function ingredientNamesForDays(c, mealsList, activeDays) {
  const names = [];
  for (const meal of mealsList) {
    for (const ing of (meal.ingredients || [])) {
      if (!ing.disabled) names.push(ing.name);
    }
  }
  for (const day of activeDays) {
    for (const ing of (mapGet(c.dailyVariables, day) || [])) {
      if (ing.disabled) continue;
      const mealId = ing.mealId || 'meal-chicken';
      if (mealsList.some(m => m.id === mealId)) names.push(ing.name);
    }
  }
  return names;
}

/**
 * The reference rows one day's prompt prints, as text. The config hash folds
 * these in, so editing a row stales exactly the days that use it.
 */
function referenceLinesForDay(c, day, library) {
  const mealsList = activeMealsForDay(c, day);
  return referenceLinesFor(ingredientNamesForDays(c, mealsList, [day]), requireLibrary(library, 'referenceLinesForDay'));
}

/**
 * Compile the full LLM prompt from a config object.
 *
 * @param {object} c        – Config object (plain object or Mongoose doc)
 * @param {object} options
 * @param {'single'|'all'} options.mode          – Generate for one day or all 7.
 * @param {string}         [options.selectedDay] – Required when mode === 'single'.
 * @param {string[]}       [options.daysOfWeek]  – Ordered day names, defaults to MON–SUN.
 * @param {import('./ingredient-library.js').LibraryEntry[]} options.library – The ingredient library.
 * @returns {string}
 */
function compilePromptText(c, options) {
  const { mode = 'single', selectedDay = 'MONDAY', daysOfWeek = DEFAULT_DAYS_OF_WEEK } = options || {};
  const library = requireLibrary(options && options.library, 'compilePromptText');
  const isSingle = mode === 'single';
  const idealMin = c?.global?.idealSodiumPotassiumRatioMin === undefined ? 0.70 : c.global.idealSodiumPotassiumRatioMin;
  const idealMax = c?.global?.idealSodiumPotassiumRatioMax === undefined ? 0.80 : c.global.idealSodiumPotassiumRatioMax;
  const idealMinStr = idealMin.toFixed(2);
  const idealMaxStr = idealMax.toFixed(2);
  const activeDays = isSingle ? [selectedDay] : daysOfWeek;

  // One day's prompt drops the meals switched off for that day. A whole-week
  // prompt shares one meal list, so it can only honour the master switch.
  const mealsList = isSingle
    ? activeMealsForDay(c, selectedDay)
    : (c.meals || []).filter(m => !m.disabled);

  const perMealMeals = mealsList.filter(m => (m.cookQuantityMode || 'daily') === 'per-meal');
  const hasPerMealMode = perMealMeals.length > 0;
  const perMealMealNames = perMealMeals.map(m => m.name);

  const mealsTargetText = mealsList
    .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} time${meal.mealsPerDay > 1 ? 's' : ''} per day${(meal.cookQuantityMode || 'daily') === 'per-meal' ? ' [COOK QUANTITIES: PER MEAL]' : ''}`)
    .join('\n');

  const mealsDetailsText = mealsList
    .map((meal, idx) => {
      const activeIngs = meal.ingredients.filter(ing => !ing.disabled);
      return `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (WHOLE-DAY TOTALS per R2)]
${activeIngs.map(ing => `- ${ing.name}: ${weightLabel(ing)}${ingredientSuffix(ing)}`).join('\n')}
${String(meal.prepMethod || '').trim() ? `- prep method: ${meal.prepMethod.trim().split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')}` : ''}
`;
    }).join('\n');

  const referenceLines = referenceLinesFor(ingredientNamesForDays(c, mealsList, activeDays), library).join('\n');

  const dayDataText = activeDays.map(day => {
    const ingredients = (mapGet(c.dailyVariables, day) || []).filter(ing => {
      if (ing.disabled) return false;
      const mealId = ing.mealId || 'meal-chicken';
      return mealsList.some(m => m.id === mealId);
    });
    const variant = getDayVariantName(ingredients, mealsList);
    const itemsText = ingredients.map(ing => formatIngredientEntry(ing, mealsList)).join(', ');
    return `- ${day} (${variant}): ${itemsText}`;
  }).join('\n');

  return `Act as a strict meal prep calculator and format generator. Using the configuration and nutritional reference below:
1. Automatically calculate all calories using raw/uncooked nutritional values, round them to whole numbers, and solve for any \`[AUTO]\` ingredients.
2. Emit ONLY two parts:
   - PART 1: Macro and meal breakdown for myself (using markdown tables).
   - PART 2: Copy-pasteable text plan for my cook (strict daily text blocks, no tables, no calories).
Work through the rules in order, do all arithmetic privately in your reasoning, and emit only the two parts with zero commentary.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS & WEIGHTS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
- Ideal Sodium-to-Potassium (Na:K) band: ${idealMinStr} to ${idealMaxStr}
${mealsTargetText}

${mealsDetailsText}
===================================================================
                        CALCULATION RULES
===================================================================

Every nutritional value comes from the reference table in DAY DATA (per 100g raw/uncooked; bracketed figure is kcal/g). If an ingredient is not listed there, use standard raw USDA FoodData Central values.

R1. FIXED vs [AUTO]. Fixed weights are already decided — copy them exactly. Solve only \`[AUTO]\` weights.

R2. WHOLE-DAY WEIGHTS. Every configured weight is already a WHOLE-DAY total. Never multiply by meals per day. A per-meal weight is that whole-day weight divided by the meal's daily frequency.

R3. OWNERSHIP. Each daily variable ingredient joins the meal named in its "(belongs to [Meal Name])" suffix, in both PART 1 and PART 2.

R4. SOLVING \`[AUTO]\` WEIGHTS.
   a. Remaining budget = Daily Calorie Target − calories of all fixed weights in the day.
   b. Convert budget into grams for \`[AUTO]\` ingredients using their exact kcal/g (non-negative, sum to budget).
   c. Bounds are hard: \`[AUTO, min Xg]\` may never solve below X; \`[AUTO, max Yg]\` may never solve above Y. If a bound is reached, pin it and redistribute across remaining \`[AUTO]\` ingredients.
   d. When multiple \`[AUTO]\` ingredients exist, allocate to steer the whole-day Na:K ratio (R6) into the ideal band.
   e. Reachability. Compute the whole-day ratio at both extremes ONCE, and do not re-derive or re-check them afterwards:
      - LOWEST reachable ratio: spend the budget on the most potassium-dense \`[AUTO]\` ingredients (highest mg K per kcal) that the bounds allow.
      - HIGHEST reachable ratio: spend it on the least potassium-dense ones.
      Then pick the allocation by where the band falls:
      - Band inside [lowest, highest]: solve for a mix that lands in the band.
      - Band entirely ABOVE the highest reachable ratio: use the highest-ratio allocation, i.e. the least potassium-dense mix the bounds allow.
      - Band entirely BELOW the lowest reachable ratio: use the lowest-ratio allocation.
      Always land as close to the band as the ingredients allow. NEVER split the budget evenly — an even split pins the small-max ingredients at their maximums and lands on the potassium-dense extreme, which is the furthest point from the band. Never force or fake a ratio; report the real one.

R5. ROUNDING PROTOCOL:
   a. Solve at full precision, then round every ingredient weight to a whole number of grams.
   b. Nominate one \`[AUTO]\` ingredient with headroom as the residual absorber and shift it by whole grams so the recomputed daily calories sit within 2 kcal of the target.
   c. Recompute every printed calorie, macro, and mineral figure from those FINAL rounded weights. Print calories as whole numbers and macro grams to one decimal. Round half away from zero (2.5 to 3, 0.05 to 0.1); never use banker's rounding.
   d. A "Total" row is the arithmetic sum of the rows printed directly above it. A figure in the Daily Totals block is computed from the exact final weights, NOT by summing rounded meal totals. The two may disagree in the last decimal; that is expected and correct, so do not adjust either to match the other.
   e. TOLERANCES. Printed figures are checked with slack: 1 kcal per ingredient row, 1.5 kcal per meal total, 2 kcal per day, 0.1g per macro row, 0.5g per daily macro, 2mg per mineral, 0.006 on the ratio. Any self-consistent rounding convention passes. Do not deliberate over rounding modes, tie-breaks or .5 cases — apply (c) and move on.

R6. SODIUM & POTASSIUM (whole day).
   - ALL salt in the day counts at the reference table's sodium-per-gram (salt in marinade, subji, cooking water, etc. with zero discard discount).
   - Total Daily Sodium (mg) = sodium from salt + natural sodium from all ingredients.
   - Total Daily Potassium (mg) = natural potassium from all ingredients.
   - Na:K Ratio = Total Daily Sodium ÷ Total Daily Potassium. PRINT it rounded to 2 decimals, but decide Ideal / Below Ideal / Above Ideal from the UNROUNDED value against ${idealMinStr} to ${idealMaxStr}. A ratio of 0.789 prints as "0.79" and is still Below Ideal for a 0.79 to 0.80 band:
     - Below ${idealMinStr}: Additional Na (mg) = (${idealMinStr} × Total Potassium) − Total Sodium; Additional Salt (g) = Additional Na ÷ 388, to 2 decimals.
     - Above ${idealMaxStr}: Additional Potassium to ${idealMaxStr} (mg) = (Total Sodium ÷ ${idealMaxStr}) − Total Potassium; Additional Potassium to ${idealMinStr} (mg) = (Total Sodium ÷ ${idealMinStr}) − Total Potassium, to nearest whole mg.
     - Between ${idealMinStr} and ${idealMaxStr} inclusive: the ratio is ideal.

R7. MACROS. Compute daily Protein, Carbohydrates and Fat in grams from the final weights, and convert at 4 kcal/g (Protein), 4 kcal/g (Carbs), 9 kcal/g (Fat) for the printed macro-kcal figures. These 4/4/9 values are a reporting convention only; whole-food totals naturally differ slightly from reference table combustion densities. Never distort macro grams to force them to match the day's calorie total.

R8. SPLIT INSTRUCTIONS. An ingredient with a split instruction keeps its full weight in calculations. Resolve allocations into exact grams and print them inside the owning meal in both PART 1 and PART 2.

R9. Do all math privately in reasoning. Emit zero step-by-step arithmetic or conversational commentary.

===================================================================
                        OUTPUT FORMAT
===================================================================

PART 1: FOR MYSELF (User Breakdown)
Generate this section first using markdown tables and bullet points.${isSingle ? '' : ' Repeat this whole block once per day, from Monday to Sunday, in order.'}

Open with the Daily Totals (Summary) block below, above the sodium summary and every meal table. Every bullet is a top-level "- " bullet: never indent, never nest sub-bullets, never merge meals onto one line, and add no extra bullets or commentary.
### Daily Totals (Summary) — [DAY NAME]   <- replace [DAY NAME] with the day named in DAY DATA
${mealsList.map(meal => `- ${meal.name}: **[X] kcal** daily${meal.mealsPerDay > 1 ? ` (**[Y] kcal** per meal × ${meal.mealsPerDay})` : ''}`).join('\n')}
- **Total Daily Protein**: **[P]g ([P kcal] kcal)**
- **Total Daily Carbohydrates**: **[C]g ([C kcal] kcal)**
- **Total Daily Fat**: **[F]g ([F kcal] kcal)**
- **Final Aggregated Total Daily Calories**: **[T] kcal** (Target: **${c.global.dailyCalorieTarget} kcal**)

### Daily Sodium & Potassium Summary
For ${isSingle ? 'the target day' : 'each day from Monday to Sunday'}:
- **[Day Name]**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt sums ALL salt across ALL meals at 100%. Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (${idealMinStr} - ${idealMaxStr})." If below ${idealMinStr}: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach ${idealMinStr}." If above ${idealMaxStr}: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach ${idealMaxStr} (or [D] mg to reach ${idealMinStr})."]

Then output each meal in this order with its exact numbered heading (do NOT rephrase or omit this heading, and do NOT replace it with "Meal 1:" or "Meal 1 table:"):
${mealsList.map((meal, idx) => `${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)`).join('\n')}

Under each meal heading, print ONE markdown table with these exact 7 columns in this order:
| Ingredient | Weight Per Meal | Daily Total | Calories (Per Meal) | Protein (Per Meal) | Carbs (Per Meal) | Fat (Per Meal) |

Table Rules & Constraints:
- Every configured ingredient for this meal (including daily variables assigned to it) gets one row, and nothing that is not configured for this day gets a row.
- Copy each ingredient's name EXACTLY as the configuration spells it, character for character. Never swap in a reference-table alias, a fuller name or a tidier spelling, and use that same spelling in Part 1 and Part 2.
- "Calories (Per Meal)" must be a bare whole integer (e.g. 636, NOT 636 kcal).
- "Protein (Per Meal)", "Carbs (Per Meal)", "Fat (Per Meal)" must be formatted as "X.Xg (Y kcal)" with exactly one decimal, zeros included: "0.0g (0 kcal)". Salt and water rows are 0.0g (0 kcal) on all three macros and 0 calories.
- The last row's first cell is exactly "Total". Leave "Weight Per Meal" and "Daily Total" empty.
- CRITICAL: All 4 nutrition columns (Calories, Protein, Carbs, Fat) in EVERY row and in the "Total" row are strictly PER MEAL. For meals eaten multiple times a day (e.g. 3x/day), the "Total" row sums the per-meal columns above it, NOT the daily total.

Example table for a meal eaten 3 times a day — the names below are placeholders, the real ones come from the configuration:

| Ingredient | Weight Per Meal | Daily Total | Calories (Per Meal) | Protein (Per Meal) | Carbs (Per Meal) | Fat (Per Meal) |
|---|---|---|---|---|---|---|
| first ingredient name | 40g | 120g | 146 | 2.8g (11 kcal) | 32.0g (128 kcal) | 0.3g (3 kcal) |
| second ingredient name | 2g | 6g | 18 | 0.0g (0 kcal) | 0.0g (0 kcal) | 2.0g (18 kcal) |
| Total | | | 164 | 2.8g (11 kcal) | 32.0g (128 kcal) | 2.3g (21 kcal) |

---

PART 2: FOR MY COOK (Text Plan)
Separate Part 2 from Part 1 with a horizontal rule (---), then output ${isSingle ? 'the target day only' : 'every day from Monday to Sunday'} using the template below. Map calculated weights directly. Output only the template's own lines: no conversational text, no reasoning, no tables, no calorie mentions.

Part 2 Rules:
- Personal-only ingredients ([PERSONAL ONLY - DO NOT SEND TO COOK]) do not appear at all — not in an ingredient list, not in a split, not in the variant name.
- Split ingredients appear ONLY as their resolved split inside their owning meal's block, never as a separate ingredient line or heading.
- Each meal's block opens with that meal's heading line, copied exactly as written below, in this order. Every heading carries how many times a day the meal is eaten, whatever its quantity mode:
${mealsList.map(cookMealHeading).join('\n')}
- Quantity mode is set per meal in the configuration. Never infer it from how often a meal is eaten:
${hasPerMealMode ? `  * PER-MEAL MEALS — exactly these and no others: ${perMealMealNames.join(', ')}. Show per-meal weights (daily total ÷ mealsPerDay) followed by "(per meal)".
  * EVERY OTHER MEAL: show daily total weights followed by "(daily total)", whatever its meals per day is.` : '  * All meals show daily total weights followed by "(daily total)", whatever their meals per day is.'}

Template for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal in order, print its block: its heading line from the list above, then ingredients in the meal's quantity mode, then any split instructions for that meal, then prep method if configured.]

Example (PER-MEAL mode meal, eaten 3 times a day):
Meal Name: 3 Meals Per Day
first ingredient name 50g (per meal)
second ingredient name 190g (per meal)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

Example (DAILY TOTAL mode meal, eaten 3 times a day):
Meal Name: 3 Meals Per Day
first ingredient name 150g (daily total)
second ingredient name 570g (daily total)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

FINAL SELF-CHECK (silent in reasoning) — check these five points once, then emit. Do NOT re-derive the plan a second time:
- Every "Total" row equals the sum of the rows printed above it.
- Daily macro grams carry one decimal, and day calories sit within 2 kcal of target.
- The Ideal / Below Ideal / Above Ideal verdict matches the UNROUNDED ratio, and the chosen [AUTO] mix is as close to the band as R4e allows.
- No unconfigured ingredients added, none omitted, every name spelled exactly as configured.
- Part 2 omits personal-only items, opens every meal with its listed heading line, and follows per-meal vs daily-total modes accurately.

===================================================================
                 DAY DATA — GENERATE ${isSingle ? selectedDay : 'MONDAY TO SUNDAY'}
===================================================================

STANDARD RAW NUTRITIONAL REFERENCE DATABASE (PER 100g UNCOOKED/RAW):
You MUST use these exact standard nutritional values for all calorie sums, \`[AUTO]\` weight solving, macro breakdowns, and mineral calculations:
${referenceLines}
* If any ingredient is not listed above, use standard raw USDA FoodData Central values.

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* These join the meals named in their "(belongs to ...)" suffix, on top of that meal's own ingredients.
${dayDataText}

Now produce PART 1 and PART 2 for ${isSingle ? selectedDay : 'MONDAY through SUNDAY'}, and nothing else.
`;
}

module.exports = {
  getDayVariantName,
  isMealActiveOnDay,
  activeMealsForDay,
  cookMealHeading,
  referenceLinesForDay,
  compilePromptText,
  PROMPT_TEMPLATE_VERSION
};
