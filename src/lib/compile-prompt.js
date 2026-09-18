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
 *
 * verify-plan.js parses this output (the reference table, and every heading and
 * phrase the templates below ask for), so those strings are a contract — change
 * one and change the verifier with it.
 *
 * Worked examples in the templates must use placeholder names only. An example
 * built from real ingredients gets copied instead of the configuration: a
 * "Table Salt (NaCl)" row in a sample table had both DeepSeek and Kimi renaming
 * the configured "salt" ingredient in 5 of 6 runs, which the verifier reports as
 * one missing and one invented ingredient per meal.
 */

const DEFAULT_DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// Bump this whenever the prompt template changes in a way that affects the
// generated plan. It is mixed into the config hash so cached responses
// produced by an older template are invalidated.
const PROMPT_TEMPLATE_VERSION = 13;

/**
 * The reference nutrition table, one entry per line, exactly as it is printed.
 *
 * Kept as data rather than one blob so a day's prompt can carry only the rows
 * that day actually uses: an unused row is a distractor the model can pick by
 * mistake (three near-identical whey rows were the worst offender) and ~40
 * tokens of nothing.
 *
 * `alwaysInclude` marks rows worth carrying even when no ingredient name
 * matched them — salt is referenced by the sodium rules themselves.
 */
const REFERENCE_TABLE = [
  { alwaysInclude: true, line: 'Table Salt (NaCl) / salt / Table Salt: 0 kcal, 0.0g Protein, 0.0g Carbs, 0.0g Fat, 388mg Sodium per 1g of salt, 0mg Potassium' },
  { line: 'Water / water: 0 kcal (0.00 kcal/g), 0.0g Protein, 0.0g Carbs, 0.0g Fat, 0mg Sodium, 0mg Potassium' },
  { line: 'Whey Protein Isolate - myprotein matcha blueberry: 367 kcal (3.67 kcal/g), 77.0g Protein, 8.71g Carbs, 2.03g Fat, 240mg Sodium, 400mg Potassium' },
  { line: 'Fast & up Whey Protein Isolate: 375 kcal (3.75 kcal/g), 81.0g Protein, 3.50g Carbs, 1.50g Fat, 180mg Sodium, 350mg Potassium' },
  { line: 'Whey Protein Isolate (Generic / Default WPI): 375 kcal (3.75 kcal/g), 83.0g Protein, 3.00g Carbs, 1.20g Fat, 180mg Sodium, 380mg Potassium' },
  { line: 'Instant Oats (Raw) / Oats (Raw) / oats: 379 kcal (3.79 kcal/g), 13.2g Protein, 67.7g Carbs, 6.50g Fat, 6mg Sodium, 350mg Potassium' },
  { line: 'chicken breast / Chicken Breast (Raw): 120 kcal (1.20 kcal/g), 22.5g Protein, 0.0g Carbs, 2.50g Fat, 45mg Sodium, 300mg Potassium' },
  { line: 'Olive oil / olive oil: 884 kcal (8.84 kcal/g), 0.0g Protein, 0.0g Carbs, 100.0g Fat, 2mg Sodium, 1mg Potassium' },
  { line: 'Rice / White Rice: 365 kcal (3.65 kcal/g), 7.1g Protein, 80.0g Carbs, 0.70g Fat, 5mg Sodium, 115mg Potassium' },
  { line: 'Potato (Raw) / potato: 77 kcal (0.77 kcal/g), 2.0g Protein, 17.5g Carbs, 0.10g Fat, 6mg Sodium, 421mg Potassium' },
  { line: 'Sweet Potato: 86 kcal (0.86 kcal/g), 1.6g Protein, 20.1g Carbs, 0.10g Fat, 55mg Sodium, 337mg Potassium' },
  { line: 'Tomato / tomato: 18 kcal (0.18 kcal/g), 0.9g Protein, 3.9g Carbs, 0.20g Fat, 5mg Sodium, 237mg Potassium' },
  { line: 'Spinach: 23 kcal (0.23 kcal/g), 2.9g Protein, 3.6g Carbs, 0.40g Fat, 79mg Sodium, 558mg Potassium' },
  { line: 'Bottle Gourd: 14 kcal (0.14 kcal/g), 0.6g Protein, 3.4g Carbs, 0.02g Fat, 2mg Sodium, 150mg Potassium' },
  { line: 'Cluster Beans: 36 kcal (0.36 kcal/g), 3.2g Protein, 5.0g Carbs, 0.40g Fat, 4mg Sodium, 230mg Potassium' },
  { line: 'Brinjal: 25 kcal (0.25 kcal/g), 1.0g Protein, 5.9g Carbs, 0.20g Fat, 2mg Sodium, 230mg Potassium' },
  { line: 'Besan: 387 kcal (3.87 kcal/g), 22.4g Protein, 57.8g Carbs, 6.70g Fat, 64mg Sodium, 846mg Potassium' },
  { line: 'poha: 353 kcal (3.53 kcal/g), 6.7g Protein, 77.3g Carbs, 1.20g Fat, 8mg Sodium, 130mg Potassium' },
  { line: 'Almonds: 579 kcal (5.79 kcal/g), 21.2g Protein, 21.6g Carbs, 49.9g Fat, 1mg Sodium, 733mg Potassium' },
  { line: 'Cashews: 553 kcal (5.53 kcal/g), 18.2g Protein, 30.2g Carbs, 43.8g Fat, 12mg Sodium, 660mg Potassium' },
  { line: 'Walnuts: 654 kcal (6.54 kcal/g), 15.2g Protein, 13.7g Carbs, 65.2g Fat, 2mg Sodium, 441mg Potassium' },
  { line: 'Banana / banana: 89 kcal (0.89 kcal/g), 1.1g Protein, 22.8g Carbs, 0.30g Fat, 1mg Sodium, 358mg Potassium' },
  { line: 'Raisins: 299 kcal (2.99 kcal/g), 3.1g Protein, 79.2g Carbs, 0.50g Fat, 20mg Sodium, 749mg Potassium' },
  { line: 'Kimia Dates: 277 kcal (2.77 kcal/g), 1.8g Protein, 75.0g Carbs, 0.20g Fat, 2mg Sodium, 696mg Potassium' },
  { line: 'Eggs / egg / eggs: 143 kcal (1.43 kcal/g), 12.6g Protein, 0.7g Carbs, 9.50g Fat, 142mg Sodium, 138mg Potassium' },
  { line: 'aamchur powder: 300 kcal (3.00 kcal/g), 3.0g Protein, 68.0g Carbs, 1.50g Fat, 30mg Sodium, 250mg Potassium' },
  // Everest Chaat Masala, read off the per-100g panel on the box: 1414 kJ = 338 kcal,
  // 5.0g protein, 71.7g carbs, 3.5g fat, 20010mg sodium (the blend is ~50% salt, so a
  // 2g sprinkle carries ~400mg sodium — about 1g of table salt).
  // Potassium is NOT on the label (it only says "not a significant source", i.e. under
  // ~1880mg/100g); 500mg is a deliberately conservative estimate for the spice half of
  // the blend (amchur, cumin, coriander, dried ginger, black pepper).
  { line: 'Chaat Masala / chat masala / Everest Chaat Masala: 338 kcal (3.38 kcal/g), 5.0g Protein, 71.7g Carbs, 3.50g Fat, 20010mg Sodium, 500mg Potassium' }
];

/**
 * Safely read a key from a value that might be a plain object or a Mongoose Map.
 */
function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

/** Same normalisation verify-plan.js uses, so both sides resolve a name alike. */
function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "Potato (Raw)" -> "potato": the un-parenthesised fallback form. */
function baseName(normalized) {
  return normalized.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every spelling of a reference row that an ingredient name may arrive as. */
function aliasesOf(entry) {
  const names = entry.line.slice(0, entry.line.indexOf(': '));
  const aliases = new Set();
  for (const alias of names.split(' / ')) {
    const normalized = normalizeName(alias);
    aliases.add(normalized);
    aliases.add(baseName(normalized));
  }
  return aliases;
}

/**
 * The reference rows the given ingredient names need, in table order.
 * A name that matches nothing simply has no row — the model is told to fall
 * back to USDA values for those, exactly as before.
 */
function referenceLinesFor(ingredientNames) {
  const wanted = new Set();
  for (const name of ingredientNames) {
    const normalized = normalizeName(name);
    wanted.add(normalized);
    wanted.add(baseName(normalized));
    if (/\bsalt\b/.test(normalized)) wanted.add('salt');
  }

  return REFERENCE_TABLE
    .filter((entry) => {
      if (entry.alwaysInclude) return true;
      const aliases = aliasesOf(entry);
      for (const name of wanted) if (aliases.has(name)) return true;
      return false;
    })
    .map((entry) => `- ${entry.line}`);
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
 * Compile the full LLM prompt from a config object.
 *
 * @param {object} c        – Config object (plain object or Mongoose doc)
 * @param {object} options
 * @param {'single'|'all'} options.mode          – Generate for one day or all 7.
 * @param {string}         [options.selectedDay] – Required when mode === 'single'.
 * @param {string[]}       [options.daysOfWeek]  – Ordered day names, defaults to MON–SUN.
 * @returns {string}
 */
function compilePromptText(c, options) {
  const { mode = 'single', selectedDay = 'MONDAY', daysOfWeek = DEFAULT_DAYS_OF_WEEK } = options || {};
  const isSingle = mode === 'single';
  const idealMin = c?.global?.idealSodiumPotassiumRatioMin === undefined ? 0.70 : c.global.idealSodiumPotassiumRatioMin;
  const idealMax = c?.global?.idealSodiumPotassiumRatioMax === undefined ? 0.80 : c.global.idealSodiumPotassiumRatioMax;
  const idealMinStr = idealMin.toFixed(2);
  const idealMaxStr = idealMax.toFixed(2);
  const activeDays = isSingle ? [selectedDay] : daysOfWeek;

  const mealsList = (c.meals || []).filter(m => !m.disabled);

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

  const referenceLines = referenceLinesFor(ingredientNamesForDays(c, mealsList, activeDays)).join('\n');

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
   e. Reachability check:
      - Compute extreme ratios: once with budget pushed toward the most potassium-dense AUTO ingredients, once toward the least.
      - If the ideal band is unreachable, or profiles are too similar, split the budget evenly and report the real ratio truthfully. Never force or fake a ratio.

R5. ROUNDING PROTOCOL:
   a. Solve at full precision, then round every ingredient weight to a whole number of grams.
   b. Nominate one \`[AUTO]\` ingredient with headroom as the residual absorber and shift it by whole grams so the recomputed daily calories sit within 1 kcal of the target.
   c. Recompute every printed calorie, macro, and mineral figure from those FINAL rounded weights. Print calories as whole numbers and macro grams to one decimal.
   d. Every printed total must equal the exact sum of the rows you printed.

R6. SODIUM & POTASSIUM (whole day).
   - ALL salt in the day counts at the reference table's sodium-per-gram (salt in marinade, subji, cooking water, etc. with zero discard discount).
   - Total Daily Sodium (mg) = sodium from salt + natural sodium from all ingredients.
   - Total Daily Potassium (mg) = natural potassium from all ingredients.
   - Na:K Ratio = Total Daily Sodium ÷ Total Daily Potassium, rounded to 2 decimals, judged against ${idealMinStr} to ${idealMaxStr}:
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
- "Protein (Per Meal)", "Carbs (Per Meal)", "Fat (Per Meal)" must be formatted as "Xg (Y kcal)". Salt and water rows are 0g (0 kcal) on all macros and 0 calories.
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
- Quantity mode is set per meal in the configuration. Never infer it from how often a meal is eaten:
${hasPerMealMode ? `  * PER-MEAL MEALS — exactly these and no others: ${perMealMealNames.join(', ')}. Show per-meal weights (daily total ÷ mealsPerDay) followed by "(per meal)", and the heading carries the frequency, e.g. "Meal Name (x[N] daily):".
  * EVERY OTHER MEAL: show daily total weights followed by "(daily total)", and the heading carries NO frequency suffix, whatever its meals-per-day is.` : '  * All meals show daily total weights followed by "(daily total)", and headings carry NO frequency suffix.'}

Template for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal in order, print its block: ingredients in the meal's quantity mode, then any split instructions for that meal, then prep method if configured.]

Example (PER-MEAL mode meal):
Meal Name (x3 daily):
first ingredient name 50g (per meal)
second ingredient name 190g (per meal)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

Example (DAILY TOTAL mode meal):
Meal Name:
first ingredient name 150g (daily total)
second ingredient name 190g (daily total)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

FINAL SELF-CHECK (silent in reasoning):
- All calories/macros/minerals recomputed from final rounded weights; totals match row sums.
- Day calories sit within 1 kcal of target from reference densities.
- No unconfigured ingredients added, no configured ingredients omitted.
- Part 2 omits personal-only items and follows per-meal vs daily-total modes accurately.

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

module.exports = { getDayVariantName, compilePromptText, PROMPT_TEMPLATE_VERSION };
