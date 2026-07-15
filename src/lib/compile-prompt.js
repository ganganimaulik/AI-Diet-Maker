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
  const { mode = 'all', selectedDay = 'MONDAY', daysOfWeek = DEFAULT_DAYS_OF_WEEK } = options || {};
  const isSingle = mode === 'single';
  const idealMin = c.global.idealSodiumPotassiumRatioMin === undefined ? 0.70 : c.global.idealSodiumPotassiumRatioMin;
  const idealMax = c.global.idealSodiumPotassiumRatioMax === undefined ? 0.80 : c.global.idealSodiumPotassiumRatioMax;
  const idealMinStr = idealMin.toFixed(2);
  const idealMaxStr = idealMax.toFixed(2);
  const activeDays = isSingle ? [selectedDay] : daysOfWeek;
  const dayRefLabel = isSingle ? 'the day' : 'each day';

  const mealsList = (c.meals || []).filter(m => !m.disabled);
  let splitsList = c.customSplits || [];
  if (splitsList.length === 0) {
    if (c.splits) {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: c.splits.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: c.splits.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
      ];
    } else {
      splitsList = [
        { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
      ];
    }
  }

  const getSplitsForDayText = (day, prefix = '') => {
    const dayOverrides = mapGet(c.dailySplits, day) || [];
    const daySplits = splitsList.map(globalSplit => {
      const override = dayOverrides.find(o => o.id === globalSplit.id);
      return {
        name: globalSplit.name,
        value: override ? override.value : globalSplit.value
      };
    });

    const dynamicIngredientSplits = [];
    mealsList.forEach(meal => {
      (meal.ingredients || []).forEach(ing => {
        if (!ing.disabled && ing.split && ing.split.trim()) {
          dynamicIngredientSplits.push(`${meal.name} Ingredient Split: ${ing.name} total daily split instruction is "${ing.split.trim()}"`);
        }
      });
    });

    const dayVars = (mapGet(c.dailyVariables, day) || []);
    dayVars.forEach(ing => {
      const mealId = ing.mealId || 'meal-chicken';
      const meal = mealsList.find(m => m.id === mealId);
      if (meal && !ing.disabled && ing.split && ing.split.trim()) {
        dynamicIngredientSplits.push(`Daily Variable Split: ${ing.name} split instruction is "${ing.split.trim()}"`);
      }
    });

    const allSplits = [
      ...dynamicIngredientSplits,
      ...daySplits.map(s => `${s.name}: ${s.value}`)
    ];

    return allSplits.map(s => `${prefix}- ${s}`).join('\n');
  };

  let splitsText = '';
  if (isSingle) {
    splitsText = getSplitsForDayText(selectedDay);
  } else {
    splitsText = activeDays.map(day => {
      return `- ${day}:\n${getSplitsForDayText(day, '  ')}`;
    }).join('\n');
  }

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
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod.split('\n').map((line, i) => i === 0 ? line : `  ${line}`).join('\n')}` : ''}
`;
    }).join('\n');

  return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

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

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For ${isSingle ? `the selected day (${selectedDay})` : 'each day'}, sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum of calories of all ingredient weights listed under each meal (these weights are already WHOLE DAY TOTALS, do NOT multiply by meals per day)
   - Daily variables calories = sum of calories of all variables for that day
3. Subtract that total (meals + variables) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. Each daily variable ingredient is marked with a "(belongs to [Meal Name])" suffix specifying which meal it belongs to. When constructing the meal breakdowns in PART 1 and copy-pasteable meal plans in PART 2, you MUST add each daily variable ingredient to its designated meal. Do NOT add any daily variable ingredient under any meal other than the one specified in its belongs-to suffix.
6. If a day contains multiple \`[AUTO]\` ingredients:
   - If there are 2 or more \`[AUTO]\` ingredients, dynamically adjust the calorie split (e.g. 60-40, 70-30, 80-20, etc.) among them to steer the resulting daily Sodium-to-Potassium Ratio (Na:K Ratio) into the ideal range of ${idealMinStr} to ${idealMaxStr}.
   - Leverage the differing natural sodium and potassium densities of the \`[AUTO]\` ingredients. For example, if the ratio is above ${idealMaxStr}, allocate more calories to high-potassium ingredients (like Potato) and fewer to low-potassium ones (like Rice) to lower the ratio. Conversely, if the ratio is below ${idealMinStr}, allocate more to low-potassium/high-calorie density ingredients to raise the ratio.
   - If the ratio is already in the ideal range of ${idealMinStr} to ${idealMaxStr} with a 50-50 split, or if it is mathematically impossible to reach the ideal range by adjusting the split (or if the ingredients have very similar nutritional profiles), default to distributing the remaining calorie deficit equally.
   - **MIN/MAX GRAM CONSTRAINTS**: If any \`[AUTO]\` ingredient has a \`min\` gram constraint (e.g. \`[AUTO, min Xg]\`), its calculated weight MUST NOT be less than X grams. If it has a \`max\` gram constraint (e.g. \`[AUTO, max Yg]\`), its calculated weight MUST NOT exceed Y grams. If the initial calculation violates any constraint, enforce the boundary value (e.g. set the weight to exactly X or Y grams) and redistribute the remaining calorie deficit to the other \`[AUTO]\` ingredients. If the configuration becomes mathematically impossible or causes all ingredients to hit their boundaries while falling short or exceeding the target, flag it as impossible.
   - Ensure all resulting weights are non-negative, and that their combined calories sum exactly to the remaining calorie deficit.
   - Perform any calorie split or math calculations privately in your thinking process. Do NOT include any step-by-step math, solved weights strategies, or calculation details in the final output text of Part 1 or Part 2.
7. For each meal, divide its daily baseline weights and any daily variable weights that belong to this meal (as specified in the belongs-to suffix) by the meal's daily frequency to find the per-meal weight.
8. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.
9. Calculate the total daily Sodium (Na) and Potassium (K) in milligrams (mg), and their ratio (Na:K ratio) for ${dayRefLabel}:
   - Table salt (NaCl) contains approximately 388 mg of sodium per 1 g of salt.
   - Look at the "Salt Seasoning Split" split value config under cooking splits. Identify the portion that is boiled with water where chicken is boiled and then the water is thrown away (e.g., "7g in chicken with 1 liter water"). For this portion, assume that only 10% of the salt/sodium is absorbed and retained by the chicken (meaning only 0.7g of salt is consumed, while the other 90% is discarded with the water). All other salt split allocations (e.g. in subji, in marinate paste) are assumed to be 100% consumed.
   - Estimate natural sodium per 100g of raw ingredients: Raw Chicken Breast ≈ 70mg, White Rice ≈ 5mg, Potato (Raw) ≈ 6mg, Tomato ≈ 5mg, Bottle Gourd ≈ 2mg, Cluster Beans ≈ 2mg, Brinjal ≈ 2mg, Olive Oil ≈ 2mg, Eggs ≈ 140mg, Oats ≈ 2mg, Whey Protein ≈ 160mg, Nuts ≈ 1mg, Banana ≈ 1mg.
   - Estimate natural potassium per 100g of raw ingredients: Raw Chicken Breast ≈ 256mg, White Rice ≈ 115mg, Potato (Raw) ≈ 400mg, Tomato ≈ 237mg, Bottle Gourd ≈ 150mg, Cluster Beans ≈ 230mg, Brinjal ≈ 230mg, Olive Oil ≈ 1mg, Eggs ≈ 130mg, Oats ≈ 429mg, Whey Protein ≈ 350mg, Almonds/Cashews/Walnuts ≈ 600mg, Banana ≈ 358mg.
   - Compute Total Daily Sodium (mg) = Sodium from consumed salt + Natural sodium from all daily ingredients.
   - Compute Total Daily Potassium (mg) = Natural potassium from all daily ingredients.
   - Compute the Sodium-to-Potassium Ratio (Na:K Ratio) = Total Daily Sodium (mg) / Total Daily Potassium (mg) (rounded to 2 decimal places).
   - Evaluate the Na:K Ratio against the ideal range of ${idealMinStr} to ${idealMaxStr}:
     - If the ratio is below ${idealMinStr}, calculate the additional Sodium required to reach a ratio of ${idealMinStr}: Additional Na (mg) = (${idealMinStr} * Total Daily Potassium) - Total Daily Sodium. Also convert this to equivalent additional salt grams: Additional Salt (g) = Additional Na (mg) / 388 (rounded to 2 decimal places).
     - If the ratio is above ${idealMaxStr}, calculate the additional Potassium required to reach a ratio of ${idealMaxStr}: Additional Potassium to ${idealMaxStr} (mg) = (Total Daily Sodium / ${idealMaxStr}) - Total Daily Potassium (rounded to the nearest whole number). Also calculate the additional Potassium required to reach a ratio of ${idealMinStr}: Additional Potassium to ${idealMinStr} (mg) = (Total Daily Sodium / ${idealMinStr}) - Total Daily Potassium (rounded to the nearest whole number).
     - If the ratio is between ${idealMinStr} and ${idealMaxStr} (inclusive), the ratio is ideal.
10. For ${isSingle ? `the selected day (${selectedDay})` : 'each day'}, calculate the total daily Protein (g), Carbohydrates (g), and Fat (g) by estimating the macronutrient densities of all daily ingredients (including solved [AUTO] weights and variables) using standard USDA nutritional values. Convert these macronutrient grams to calories (assuming Protein = 4 kcal/g, Carbohydrates = 4 kcal/g, Fat = 9 kcal/g) and sum their calories up to verify it matches the total daily calories target.
11. If any ingredient has a split instruction (e.g. '50% in subji, remaining in chicken' or '3g in subji, remaining in marinate'), you MUST calculate the exact weights in grams for each split part (based on the total daily resolved weight of that ingredient, resolving any percentages or math allocations) and display the resulting splits clearly in the final splits section of Part 1 and Part 2. Ensure the sum of split weights matches the total ingredient weight exactly.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels for each day generated. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For ${isSingle ? `the day (${selectedDay})` : 'each day from Monday to Sunday'}:
- **[Day Name] (e.g. MONDAY)**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt includes 100% of [non-water-boiled splits] and only 10% of [water-boiled splits] (water discarded). Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (${idealMinStr} - ${idealMaxStr})." If below ${idealMinStr}: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach ${idealMinStr}." If above ${idealMaxStr}: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach ${idealMaxStr} (or [D] mg to reach ${idealMinStr})."]

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include both the static ingredients configured under this meal and any daily variable ingredients that belong to this meal. Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal), Protein (Per Meal), Carbs (Per Meal), Fat (Per Meal). For Protein, Carbs, and Fat, estimate their values from the raw ingredient weights using standard USDA values and print them as "Xg (Y kcal)". At the bottom of the table, include a "Total" row summing the total calculated calories, protein, carbs, and fat for the meal (e.g. Total calories, and macro sums formatted as "Total_grams g (Total_kcal kcal)").
`).join('\n')}

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals to prove it hits your configured target. For each day, you MUST also show the total daily macros (Protein in grams & calories, Carbs in grams & calories, Fat in grams & calories) and the final aggregated Total Daily Calories.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output ${isSingle ? `only the day ${selectedDay}` : 'every day from Monday to Sunday'} using the exact line-by-line template below. Map your calculated weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

${hasPerMealMode ? `CRITICAL QUANTITY MODE — PER-MEAL MEALS: The following meals are configured to show **per-meal weights** (daily total ÷ mealsPerDay) in Part 2, NOT the whole-day total. For these meal headings, also note how many times they are eaten per day (e.g. "Chicken Meal (x3 daily):"). The cook needs to know the quantity for a single serving/preparation.
Per-meal quantity meals: ${perMealMealNames.join(', ')}
All other meals should show their daily total weights followed by "(daily total)".

` : 'All meals should show their daily total weights followed by "(daily total)".\n\n'}CRITICAL: You MUST exclude any daily variable ingredients marked with [PERSONAL ONLY - DO NOT SEND TO COOK] from PART 2 entirely. They must not appear under any day's ingredient list, meal preparation, splits, or variant names in PART 2.

CRITICAL: Under PART 2 (FOR MY COOK), you MUST completely exclude any ingredient that has a split instruction (e.g. Olive oil, or any other ingredient with split details) and its total weight from the meal ingredient lists (do not print their names or total weights under any meal name in Part 2). This is to prevent the cook from adding them multiple times. Instead, the cook should only see their split details in the splits/cooking instructions section.

Exact Output Template to Follow for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal, list its static ingredients and any daily variable ingredients that belong to this meal. If a meal is marked [COOK QUANTITIES: PER MEAL] above, show its ingredients (including daily variable ingredients) with per-meal weights (daily total ÷ mealsPerDay) followed by "(per meal)". Otherwise, show the ingredients with daily total weights followed by "(daily total)". Then, if and only if a liquid configuration is explicitly defined in that meal's weights configuration section, list it. Do not infer or invent liquids from other sections like seasoning/salt splits. List prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name${hasPerMealMode ? ' (x3 daily)' : ''}:
ingredient1 name ${hasPerMealMode ? '50g (per meal)' : '150g (daily total)'}
ingredient2 name ${hasPerMealMode ? '33g (per meal)' : '100g (daily total)'}
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
}

module.exports = { getDayVariantName, compilePromptText };

