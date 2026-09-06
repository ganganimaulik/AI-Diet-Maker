/**
 * Shared prompt compilation logic.
 *
 * Used by:
 *   - src/app/page.tsx  (ES import)
 *   - whatsapp-worker.js (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step
 * for the worker.
 */

const DEFAULT_DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// Bump this whenever the prompt template changes in a way that affects the
// generated plan. It is mixed into the config hash so cached responses
// produced by an older template are invalidated.
const PROMPT_TEMPLATE_VERSION = 8;

/**
 * Safely read a key from a value that might be a plain object or a Mongoose Map.
 */
function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
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
 * Format a single ingredient line (for daily variable listing).
 */
function formatIngredientEntry(ing, mealsList) {
  const mealId = ing.mealId || 'meal-chicken';
  const meal = mealsList && mealsList.find(m => m.id === mealId);
  const mealLabel = meal ? ` (belongs to ${meal.name})` : '';

  if (!ing.isAuto) return `${ing.name}: ${ing.weight}g${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}${mealLabel}`;
  const constraints = [];
  if (ing.minGrams) constraints.push(`min ${ing.minGrams}g`);
  if (ing.maxGrams) constraints.push(`max ${ing.maxGrams}g`);
  const autoLabel = constraints.length > 0 ? `[AUTO, ${constraints.join(', ')}]` : '[AUTO]';
  return `${ing.name}: ${autoLabel}${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}${mealLabel}`;
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
  const dayRefLabel = isSingle ? 'the day' : 'each day';

  const mealsList = (c.meals || []).filter(m => !m.disabled);

  const perMealMeals = mealsList.filter(m => (m.cookQuantityMode || 'daily') === 'per-meal');
  const hasPerMealMode = perMealMeals.length > 0;
  const perMealMealNames = perMealMeals.map(m => m.name);

  const mealsTargetText = mealsList
    .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day${(meal.cookQuantityMode || 'daily') === 'per-meal' ? ' [COOK QUANTITIES: PER MEAL]' : ''}`)
    .join('\n');

  const mealsDetailsText = mealsList
    .map((meal, idx) => {
      const activeIngs = meal.ingredients.filter(ing => !ing.disabled);
      return `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (WHOLE DAY TOTAL — divide by ${meal.mealsPerDay} for per-meal weight)]
${activeIngs.map(ing => {
  if (!ing.isAuto) return `- ${ing.name}: ${ing.weight}g${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}`;
  const constraints = [];
  if (ing.minGrams) constraints.push(`min ${ing.minGrams}g`);
  if (ing.maxGrams) constraints.push(`max ${ing.maxGrams}g`);
  const autoLabel = constraints.length > 0 ? `[AUTO, ${constraints.join(', ')}]` : '[AUTO]';
  return `- ${ing.name}: ${autoLabel}${ing.split ? ` (split instruction: ${ing.split})` : ''}${ing.personalOnly ? ' [PERSONAL ONLY - DO NOT SEND TO COOK]' : ''}`;
}).join('\n')}
${meal.prepMethod ? `- prep method: ${meal.prepMethod.split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')}` : ''}
`;
    }).join('\n');

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS & WEIGHTS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
${mealsTargetText}

${mealsDetailsText}
[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${activeDays.map(day => {
  const ingredients = (mapGet(c.dailyVariables, day) || []).filter(ing => {
    if (ing.disabled) return false;
    const mealId = ing.mealId || 'meal-chicken';
    return mealsList.some(m => m.id === mealId);
  });
  const variant = getDayVariantName(ingredients, mealsList);
  const itemsText = ingredients.map(ing => formatIngredientEntry(ing, mealsList)).join(', ');
  return `- ${day} (${variant}): ${itemsText}`;
}).join('\n')}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

STANDARD RAW NUTRITIONAL REFERENCE DATABASE (PER 100g UNCOOKED/RAW):
You MUST use these exact standard nutritional values for all calorie sums, [AUTO] weight solving, macro breakdowns, and mineral calculations:
- Water / water: 0 kcal (0.00 kcal/g), 0.0g Protein, 0.0g Carbs, 0.0g Fat, 0mg Sodium, 0mg Potassium
- Table Salt (NaCl) / salt / Table Salt: 0 kcal, 0.0g Protein, 0.0g Carbs, 0.0g Fat, 388mg Sodium per 1g of salt (38,800mg/100g), 0mg Potassium
- Whey Protein Isolate - myprotein matcha blueberry: 367 kcal (3.67 kcal/g), 77.0g Protein, 8.71g Carbs, 2.03g Fat, 240mg Sodium, 400mg Potassium
- Fast & up Whey Protein Isolate: 375 kcal (3.75 kcal/g), 81.0g Protein, 3.50g Carbs, 1.50g Fat, 180mg Sodium, 350mg Potassium
- Whey Protein Isolate (Generic / Default WPI): 375 kcal (3.75 kcal/g), 83.0g Protein, 3.00g Carbs, 1.20g Fat, 180mg Sodium, 380mg Potassium
- Instant Oats (Raw) / Oats (Raw) / oats: 379 kcal (3.79 kcal/g), 13.2g Protein, 67.7g Carbs, 6.50g Fat, 6mg Sodium, 350mg Potassium
- chicken breast / Chicken Breast (Raw): 120 kcal (1.20 kcal/g), 22.5g Protein, 0.0g Carbs, 2.50g Fat, 45mg Sodium, 300mg Potassium
- Olive oil / olive oil: 884 kcal (8.84 kcal/g), 0.0g Protein, 0.0g Carbs, 100.0g Fat, 2mg Sodium, 1mg Potassium
- Rice / White Rice: 365 kcal (3.65 kcal/g), 7.1g Protein, 80.0g Carbs, 0.70g Fat, 5mg Sodium, 115mg Potassium
- Potato (Raw) / potato: 77 kcal (0.77 kcal/g), 2.0g Protein, 17.5g Carbs, 0.10g Fat, 6mg Sodium, 421mg Potassium
- Sweet Potato: 86 kcal (0.86 kcal/g), 1.6g Protein, 20.1g Carbs, 0.10g Fat, 55mg Sodium, 337mg Potassium
- Tomato / tomato: 18 kcal (0.18 kcal/g), 0.9g Protein, 3.9g Carbs, 0.20g Fat, 5mg Sodium, 237mg Potassium
- Spinach: 23 kcal (0.23 kcal/g), 2.9g Protein, 3.6g Carbs, 0.40g Fat, 79mg Sodium, 558mg Potassium
- Bottle Gourd: 14 kcal (0.14 kcal/g), 0.6g Protein, 3.4g Carbs, 0.02g Fat, 2mg Sodium, 150mg Potassium
- Cluster Beans: 36 kcal (0.36 kcal/g), 3.2g Protein, 5.0g Carbs, 0.40g Fat, 4mg Sodium, 230mg Potassium
- Brinjal: 25 kcal (0.25 kcal/g), 1.0g Protein, 5.9g Carbs, 0.20g Fat, 2mg Sodium, 230mg Potassium
- Besan: 387 kcal (3.87 kcal/g), 22.4g Protein, 57.8g Carbs, 6.70g Fat, 64mg Sodium, 846mg Potassium
- poha: 353 kcal (3.53 kcal/g), 6.7g Protein, 77.3g Carbs, 1.20g Fat, 8mg Sodium, 130mg Potassium
- Almonds: 579 kcal (5.79 kcal/g), 21.2g Protein, 21.6g Carbs, 49.9g Fat, 1mg Sodium, 733mg Potassium
- Cashews: 553 kcal (5.53 kcal/g), 18.2g Protein, 30.2g Carbs, 43.8g Fat, 12mg Sodium, 660mg Potassium
- Walnuts: 654 kcal (6.54 kcal/g), 15.2g Protein, 13.7g Carbs, 65.2g Fat, 2mg Sodium, 441mg Potassium
- Banana / banana: 89 kcal (0.89 kcal/g), 1.1g Protein, 22.8g Carbs, 0.30g Fat, 1mg Sodium, 358mg Potassium
- Raisins: 299 kcal (2.99 kcal/g), 3.1g Protein, 79.2g Carbs, 0.50g Fat, 20mg Sodium, 749mg Potassium
- Kimia Dates: 277 kcal (2.77 kcal/g), 1.8g Protein, 75.0g Carbs, 0.20g Fat, 2mg Sodium, 696mg Potassium
- Eggs / egg / eggs: 143 kcal (1.43 kcal/g), 12.6g Protein, 0.7g Carbs, 9.50g Fat, 142mg Sodium, 138mg Potassium
- aamchur powder: 300 kcal (3.00 kcal/g), 3.0g Protein, 68.0g Carbs, 1.50g Fat, 30mg Sodium, 250mg Potassium
* If any ingredient is not listed above, use standard raw USDA FoodData Central values.

INSTRUCTIONS FOR THE CALCULATOR:
1. Use the exact raw/uncooked calorie densities (kcal per 1g) and nutritional values from the STANDARD RAW NUTRITIONAL REFERENCE DATABASE above for all calculations.
2. For ${isSingle ? `the selected day (${selectedDay})` : 'each day'}, sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum of calories of all ingredient weights listed under each meal (these weights are already WHOLE DAY TOTALS, do NOT multiply by meals per day)
   - Daily variables calories = sum of calories of all variables for that day
3. Subtract that total (meals + variables) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` by dividing the deficit calories by their exact calorie density from the reference table.
5. Each daily variable ingredient is marked with a "(belongs to [Meal Name])" suffix specifying which meal it belongs to. When constructing the meal breakdowns in PART 1 and copy-pasteable meal plans in PART 2, you MUST add each daily variable ingredient to its designated meal. Do NOT add any daily variable ingredient under any meal other than the one specified in its belongs-to suffix.
6. If a day contains multiple \`[AUTO]\` ingredients:
   - If there are 2 or more \`[AUTO]\` ingredients, dynamically adjust the calorie split (e.g. 60-40, 70-30, 80-20, etc.) among them to steer the resulting daily Sodium-to-Potassium Ratio (Na:K Ratio) into the ideal range of ${idealMinStr} to ${idealMaxStr}.
   - Leverage the differing natural sodium and potassium densities of the \`[AUTO]\` ingredients from the reference table (e.g., Potato = 421mg K / 100g, Sweet Potato = 337mg K / 100g, Rice = 115mg K / 100g). For example, if the ratio is above ${idealMaxStr}, allocate more calories to high-potassium ingredients (like Potato) and fewer to low-potassium ones (like Rice) to lower the ratio. Conversely, if the ratio is below ${idealMinStr}, allocate more to low-potassium/high-calorie density ingredients to raise the ratio.
   - If the ratio is already in the ideal range of ${idealMinStr} to ${idealMaxStr} with a 50-50 split, or if it is mathematically impossible to reach the ideal range by adjusting the split (or if the ingredients have very similar nutritional profiles), default to distributing the remaining calorie deficit equally.
   - **MIN/MAX GRAM CONSTRAINTS**: If any \`[AUTO]\` ingredient has a \`min\` gram constraint (e.g. \`[AUTO, min Xg]\`), its calculated weight MUST NOT be less than X grams. If it has a \`max\` gram constraint (e.g. \`[AUTO, max Yg]\`), its calculated weight MUST NOT exceed Y grams. If the initial calculation violates any constraint, enforce the boundary value (e.g. set the weight to exactly X or Y grams) and redistribute the remaining calorie deficit to the other \`[AUTO]\` ingredients. If the configuration becomes mathematically impossible or causes all ingredients to hit their boundaries while falling short or exceeding the target, flag it as impossible.
   - Ensure all resulting weights are non-negative, and that their combined calories sum exactly to the remaining calorie deficit.
   - Perform any calorie split or math calculations privately in your thinking process. Do NOT include any step-by-step math, solved weights strategies, or calculation details in the final output text of Part 1 or Part 2.
7. For each meal, divide its daily baseline weights and any daily variable weights that belong to this meal (as specified in the belongs-to suffix) by the meal's daily frequency to find the per-meal weight.
8. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.
9. Calculate the total daily Sodium (Na) and Potassium (K) in milligrams (mg), and their ratio (Na:K ratio) for ${dayRefLabel}:
   - Table salt (NaCl) contains exactly 388 mg of sodium per 1 g of salt.
   - Scan all ingredients across ALL meals and daily variables for Table Salt (NaCl) / salt.
   - For any salt portion that is boiled in water which is then thrown away (as specified in an ingredient's split instruction), assume only 10% of that salt/sodium is absorbed and retained by the food (meaning only 0.7g of a 7g salt portion is consumed, while the other 90% is discarded with the water). All other salt allocations (in food, in subji, in marinate paste, salt added directly while cooking a meal) are assumed to be 100% consumed.
   - Use the natural sodium and potassium per 100g values strictly from the STANDARD RAW NUTRITIONAL REFERENCE DATABASE above for all ingredients.
   - Compute Total Daily Sodium (mg) = Sodium from consumed salt + Natural sodium from all daily ingredients.
   - Compute Total Daily Potassium (mg) = Natural potassium from all daily ingredients.
   - Compute the Sodium-to-Potassium Ratio (Na:K Ratio) = Total Daily Sodium (mg) / Total Daily Potassium (mg) (rounded to 2 decimal places).
   - Evaluate the Na:K Ratio against the ideal range of ${idealMinStr} to ${idealMaxStr}:
     - If the ratio is below ${idealMinStr}, calculate the additional Sodium required to reach a ratio of ${idealMinStr}: Additional Na (mg) = (${idealMinStr} * Total Daily Potassium) - Total Daily Sodium. Also convert this to equivalent additional salt grams: Additional Salt (g) = Additional Na (mg) / 388 (rounded to 2 decimal places).
     - If the ratio is above ${idealMaxStr}, calculate the additional Potassium required to reach a ratio of ${idealMaxStr}: Additional Potassium to ${idealMaxStr} (mg) = (Total Daily Sodium / ${idealMaxStr}) - Total Daily Potassium (rounded to the nearest whole number). Also calculate the additional Potassium required to reach a ratio of ${idealMinStr}: Additional Potassium to ${idealMinStr} (mg) = (Total Daily Sodium / ${idealMinStr}) - Total Daily Potassium (rounded to the nearest whole number).
     - If the ratio is between ${idealMinStr} and ${idealMaxStr} (inclusive), the ratio is ideal.
10. For ${isSingle ? `the selected day (${selectedDay})` : 'each day'}, calculate the total daily Protein (g), Carbohydrates (g), and Fat (g) using the exact macronutrient densities from the STANDARD RAW NUTRITIONAL REFERENCE DATABASE above for all ingredients (including solved [AUTO] weights and variables). Convert these macronutrient grams to calories (assuming Protein = 4 kcal/g, Carbohydrates = 4 kcal/g, Fat = 9 kcal/g) and sum their calories up to verify it matches the total daily calories target.
11. If any ingredient has a split instruction (e.g. '50% in subji, remaining in chicken' or '3g in subji, remaining in marinate'), you MUST calculate the exact weights in grams for each split part (based on the total daily resolved weight of that ingredient, resolving any percentages or math allocations) and display the resulting splits clearly in the ingredient's meal table in Part 1, and in Part 2 inside the owning meal's block. Ensure the sum of split weights matches the total ingredient weight exactly.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels for each day generated. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For ${isSingle ? `the day (${selectedDay})` : 'each day from Monday to Sunday'}:
- **[Day Name] (e.g. MONDAY)**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt sums ALL salt across ALL meals: 100% of [non-water-boiled portions] and only 10% of [water-boiled portions] (water discarded). Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (${idealMinStr} - ${idealMaxStr})." If below ${idealMinStr}: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach ${idealMinStr}." If above ${idealMaxStr}: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach ${idealMaxStr} (or [D] mg to reach ${idealMinStr})."]

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include both the static ingredients configured under this meal and any daily variable ingredients that belong to this meal. Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal), Protein (Per Meal), Carbs (Per Meal), Fat (Per Meal). For Protein, Carbs, and Fat, estimate their values from the raw ingredient weights using standard USDA values and print them as "Xg (Y kcal)". For Water and Table Salt (NaCl), calories and macros are 0g (0 kcal). At the bottom of the table, include a "Total" row summing the total calculated calories, protein, carbs, and fat for the meal (e.g. Total calories, and macro sums formatted as "Total_grams g (Total_kcal kcal)").
`).join('\n')}

End Part 1 with a Daily Totals (Summary) section aggregating the calculated daily sum total across all meals to prove it hits your configured target. Format it EXACTLY as the template below — same heading, same bullets, in this same order. Every bullet is a top-level "- " bullet: never indent a bullet, never nest sub-bullets under the day, never merge several meals onto one line, and add no extra bullets, notes, ticks or commentary of your own.${isSingle ? '' : ' Repeat this whole block once per day, from Monday to Sunday, in order.'}
### Daily Totals (Summary) — ${isSingle ? selectedDay : '[DAY NAME]'}
${mealsList.map(meal => `- ${meal.name}: **[X] kcal** daily${meal.mealsPerDay > 1 ? ` (**[Y] kcal** per meal \u00d7 ${meal.mealsPerDay})` : ''}`).join('\n')}
- **Total Daily Protein**: **[P]g ([P kcal] kcal)**
- **Total Daily Carbohydrates**: **[C]g ([C kcal] kcal)**
- **Total Daily Fat**: **[F]g ([F kcal] kcal)**
- **Final Aggregated Total Daily Calories**: **[T] kcal** (Target: **${c.global.dailyCalorieTarget} kcal**)

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output ${isSingle ? `only the day ${selectedDay}` : 'every day from Monday to Sunday'} using the exact line-by-line template below. Map your calculated weights (including solved \`[AUTO]\` weights) directly. Absolutely no conversational text, tables, or calorie mentions in this section.

${hasPerMealMode ? `CRITICAL QUANTITY MODE — PER-MEAL MEALS: The following meals are configured to show **per-meal weights** (daily total ÷ mealsPerDay) in Part 2, NOT the whole-day total. For these meal headings, also note how many times they are eaten per day (e.g. "Meal Name (x3 daily):"). The cook needs to know the quantity for a single serving/preparation.
Per-meal quantity meals: ${perMealMealNames.join(', ')}
All other meals should show their daily total weights followed by "(daily total)".

` : 'All meals should show their daily total weights followed by "(daily total)".\n\n'}CRITICAL: You MUST exclude any daily variable ingredients marked with [PERSONAL ONLY - DO NOT SEND TO COOK] from PART 2 entirely. They must not appear under any day's ingredient list, meal preparation, splits, or variant names in PART 2.

CRITICAL: Under PART 2 (FOR MY COOK), you MUST completely exclude any ingredient that has a split instruction (e.g. Olive oil, or any other ingredient with split details) and its total weight from the meal ingredient lists (do not print their names or total weights under any meal name in Part 2). This is to prevent the cook from adding them multiple times. Instead, the cook should only see their split details printed under their owning meal's block.

Exact Output Template to Follow for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal, list its static ingredients and any daily variable ingredients that belong to this meal. Ensure you use the correct quantity mode (per meal vs daily total) as specified below.
- If a meal is marked [COOK QUANTITIES: PER MEAL] above, show its ingredients with per-meal weights (daily total ÷ mealsPerDay) followed by "(per meal)", and add the frequency suffix to the meal heading (e.g. "Meal Name (x3 daily):").
- Otherwise (if NOT marked as [COOK QUANTITIES: PER MEAL]), show its ingredients with daily total weights followed by "(daily total)" and DO NOT add any frequency suffix to the meal heading (e.g. "Meal Name:").

After the meal's ingredient lines, print any ingredient split instructions as their computed exact gram amounts (per calculator instruction 11).

Then, if and only if a prep method is configured for that meal, list it as "prep method: [prepMethod]".

Example for a PER-MEAL mode meal:
Meal Name (x3 daily):
ingredient1 name 50g (per meal)
Water 190g (per meal)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min

Example for a DAILY TOTAL mode meal:
Meal Name:
ingredient1 name 150g (daily total)
Water 190g (daily total)
[split instructions belonging to this meal, if any]
prep method: airfryer 200c, 10min
`;
}

module.exports = { getDayVariantName, compilePromptText, PROMPT_TEMPLATE_VERSION };

