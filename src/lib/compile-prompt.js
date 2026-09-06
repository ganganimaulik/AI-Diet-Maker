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
 */

const DEFAULT_DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// Bump this whenever the prompt template changes in a way that affects the
// generated plan. It is mixed into the config hash so cached responses
// produced by an older template are invalidated.
const PROMPT_TEMPLATE_VERSION = 9;

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
  { alwaysInclude: true, line: 'Table Salt (NaCl) / salt / Table Salt: 0 kcal, 0.0g Protein, 0.0g Carbs, 0.0g Fat, 388mg Sodium per 1g of salt (38,800mg/100g), 0mg Potassium' },
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
  { line: 'aamchur powder: 300 kcal (3.00 kcal/g), 3.0g Protein, 68.0g Carbs, 1.50g Fat, 30mg Sodium, 250mg Potassium' }
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
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (WHOLE DAY TOTAL — divide by ${meal.mealsPerDay} for per-meal weight)]
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

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions.

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories).
- PART 2 must be a raw, copy-pasteable text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

Work through the rules in order, do the arithmetic privately, and emit only the two parts.

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

Every nutritional value you use comes from the reference table in the DAY DATA section at the end of this brief. Those figures are per 100g of the RAW/UNCOOKED ingredient, and the bracketed figure is its calorie density in kcal per 1g. If an ingredient is not listed there, use standard raw USDA FoodData Central values.

R1. FIXED vs [AUTO]. Every configured weight is either a fixed number of grams or \`[AUTO]\`. A fixed weight is a decision already made — copy it exactly and never adjust it to close a gap. \`[AUTO]\` weights are the only ones you solve.

R2. WHOLE-DAY WEIGHTS. Every weight in the configuration — meal ingredients and daily variables alike — is already a WHOLE-DAY total. Never multiply by meals per day. A per-meal weight is that whole-day weight divided by the meal's daily frequency.

R3. OWNERSHIP. Each daily variable ingredient carries a "(belongs to [Meal Name])" suffix naming the meal it joins. Add it to that meal and to no other, in both PART 1 and PART 2.

R4. SOLVING \`[AUTO]\` WEIGHTS.
   a. Remaining budget = Daily Calorie Target − the calories of every fixed weight in the day (all meals plus all daily variables).
   b. Convert that budget into grams for the \`[AUTO]\` ingredients using their exact kcal/g. Their calories must sum to the budget, and every weight must be non-negative.
   c. Bounds are hard. \`[AUTO, min Xg]\` may never solve below X; \`[AUTO, max Yg]\` may never solve above Y. If a value would breach a bound, pin it to that bound and redistribute the rest across the \`[AUTO]\` ingredients that still have room. If every one is pinned and the budget still cannot be met, say so explicitly rather than breaking a bound.
   d. When two or more \`[AUTO]\` ingredients exist, the split between them is free calories-wise, so use it to steer the day's Na:K ratio (R6) into the ideal band — more of the budget to high-potassium ingredients lowers the ratio, more to low-potassium ones raises it.
   e. Check reachability BEFORE searching for a split. The day's ratio is bounded by its two extreme allocations: work out the ratio once with the budget pushed as far as the bounds allow toward the \`[AUTO]\` ingredients carrying the most potassium per kcal, and once toward those carrying the least. The ideal band is reachable only if it falls between those two ratios. If it does not — or if the \`[AUTO]\` profiles are too similar to move the ratio, or a 50-50 split already lands in the band — do NOT search: split the budget evenly and report the real ratio with an honest verdict. A ratio outside the band that is stated truthfully is correct output; a ratio bent to look ideal is not.

R5. ROUNDING PROTOCOL, in this order:
   a. Solve at full precision.
   b. Round every ingredient weight to a whole number of grams.
   c. Rounding moves the day's calories, so nominate one \`[AUTO]\` ingredient that still has room inside its bounds as the residual absorber and shift it by whole grams until the day's calories — recomputed from the rounded weights — sit within 1 kcal of the Daily Calorie Target.
   d. Recompute every calorie, macro and mineral figure you print from those FINAL rounded weights. Print calories as whole numbers and macro grams to one decimal.
   e. Every total is the sum of the numbers you actually printed. Never write a total your own rows do not produce, and never nudge one to make the target appear met.

R6. SODIUM & POTASSIUM (whole day).
   - Table salt (NaCl) delivers exactly 388 mg of sodium per 1g of salt, and ALL salt in the day counts in full: salt in the marinade, in the subji, boiled in water, or added while cooking. There is no discount for cooking water that gets discarded.
   - Scan every meal and every daily variable for salt, and use the natural sodium and potassium values from the reference table for all other ingredients.
   - Total Daily Sodium (mg) = sodium from salt + natural sodium from all daily ingredients.
   - Total Daily Potassium (mg) = natural potassium from all daily ingredients.
   - Na:K Ratio = Total Daily Sodium ÷ Total Daily Potassium, rounded to 2 decimals, judged against the ideal band ${idealMinStr} to ${idealMaxStr}:
     - Below ${idealMinStr}: Additional Na (mg) = (${idealMinStr} × Total Daily Potassium) − Total Daily Sodium, and Additional Salt (g) = Additional Na ÷ 388, to 2 decimals.
     - Above ${idealMaxStr}: Additional Potassium to ${idealMaxStr} (mg) = (Total Daily Sodium ÷ ${idealMaxStr}) − Total Daily Potassium, and Additional Potassium to ${idealMinStr} (mg) = (Total Daily Sodium ÷ ${idealMinStr}) − Total Daily Potassium, both to the nearest whole mg.
     - Between ${idealMinStr} and ${idealMaxStr} inclusive: the ratio is ideal.

R7. MACROS. Compute daily Protein, Carbohydrates and Fat in grams from the final weights, convert them at Protein 4 kcal/g, Carbohydrates 4 kcal/g, Fat 9 kcal/g, and confirm privately that they sum to the day's calorie total.

R8. SPLIT INSTRUCTIONS. An ingredient carrying a split instruction (e.g. '50% in subji, remaining in chicken', '3g in subji, remaining in marinate') keeps its full daily weight in the calculations. Resolve the percentages or allocations into exact grams that sum to that weight, and print the resulting split — in PART 1 inside its meal's table row, and in PART 2 inside its owning meal's block.

R9. Do every calculation privately in your reasoning. The final output contains no step-by-step math, no solving strategy, no commentary on your own process — just the two parts below.

===================================================================
                        OUTPUT FORMAT
===================================================================

PART 1: FOR MYSELF (User Breakdown)
Generate this section first, using markdown tables and bullet points, based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels for each day generated. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For ${isSingle ? 'the target day' : 'each day from Monday to Sunday'}:
- **[Day Name] (e.g. MONDAY)**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt sums ALL salt across ALL meals at 100%. Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (${idealMinStr} - ${idealMaxStr})." If below ${idealMinStr}: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach ${idealMinStr}." If above ${idealMaxStr}: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach ${idealMaxStr} (or [D] mg to reach ${idealMinStr})."]

Then one numbered section per meal, in this order and with these exact headings:
${mealsList.map((meal, idx) => `${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)`).join('\n')}

Each section holds one markdown table with exactly these columns, in this order: Ingredient, Weight Per Meal, Daily Total, Calories (Per Meal), Protein (Per Meal), Carbs (Per Meal), Fat (Per Meal).
- One row per ingredient: the meal's own ingredients plus the daily variables that belong to it (R3). List every configured ingredient and nothing else — no ingredient that is not in the configuration for this day.
- Protein, Carbs and Fat print as "Xg (Y kcal)". Water and Table Salt (NaCl) are 0g (0 kcal) on every macro and on calories.
- The last row's first cell is exactly "Total", summing the four PER-MEAL columns above it.

End Part 1 with a Daily Totals (Summary) section aggregating the calculated daily sum total across all meals to prove it hits your configured target. Format it EXACTLY as the template below — same heading, same bullets, in this same order. Every bullet is a top-level "- " bullet: never indent a bullet, never nest sub-bullets under the day, never merge several meals onto one line, and add no extra bullets, notes, ticks or commentary of your own.${isSingle ? '' : ' Repeat this whole block once per day, from Monday to Sunday, in order.'}
### Daily Totals (Summary) — [DAY NAME]   <- replace [DAY NAME] with the day named in DAY DATA
${mealsList.map(meal => `- ${meal.name}: **[X] kcal** daily${meal.mealsPerDay > 1 ? ` (**[Y] kcal** per meal × ${meal.mealsPerDay})` : ''}`).join('\n')}
- **Total Daily Protein**: **[P]g ([P kcal] kcal)**
- **Total Daily Carbohydrates**: **[C]g ([C kcal] kcal)**
- **Total Daily Fat**: **[F]g ([F kcal] kcal)**
- **Final Aggregated Total Daily Calories**: **[T] kcal** (Target: **${c.global.dailyCalorieTarget} kcal**)

---

PART 2: FOR MY COOK (Text Plan)
Separate this from Part 1 with a horizontal rule (---), then output ${isSingle ? 'the target day only' : 'every day from Monday to Sunday'} using the exact line-by-line template below. Map your calculated weights (including solved \`[AUTO]\` weights) directly. Absolutely no conversational text, tables, or calorie mentions in this section.

Three exclusions apply to Part 2 only, and the checker enforces all three:
- Ingredients marked [PERSONAL ONLY - DO NOT SEND TO COOK] do not appear at all — not in an ingredient list, not in a split, not in a variant name.
- An ingredient carrying a split instruction does not get an ingredient line of its own; it appears only as its computed split, inside its owning meal's block. This is what stops the cook adding it twice.
- Splits never get their own section or heading. Each one sits inside the block of the meal that owns it.

${hasPerMealMode ? `CRITICAL QUANTITY MODE — PER-MEAL MEALS: the meals below are configured to show **per-meal weights** (daily total ÷ mealsPerDay) in Part 2, NOT the whole-day total, because the cook needs the quantity for a single preparation. Their headings also carry the frequency, e.g. "Meal Name (x3 daily):".
Per-meal quantity meals: ${perMealMealNames.join(', ')}
Every other meal shows daily total weights followed by "(daily total)", and its heading carries NO frequency suffix.` : 'Every meal shows daily total weights followed by "(daily total)", and no meal heading carries a frequency suffix.'}

Exact Output Template to Follow for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal, in configuration order, print its block: the meal's own ingredients and the daily variables that belong to it, one per line, in the meal's quantity mode.
After the ingredient lines, print any split instructions belonging to that meal as their computed exact gram amounts (R8).
Then, if and only if a prep method is configured for that meal, print "prep method: [prepMethod]".]

Example for a PER-MEAL mode meal:
Meal Name (x3 daily):
first ingredient name 50g (per meal)
second ingredient name 190g (per meal)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

Example for a DAILY TOTAL mode meal:
Meal Name:
first ingredient name 150g (daily total)
second ingredient name 190g (daily total)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

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
