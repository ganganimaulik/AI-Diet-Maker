/**
 * Deterministic diet-plan verifier.
 *
 * Re-derives every number in a generated plan from the same reference
 * nutrition table the model was given, then compares it against what the plan
 * claims. The model is the thing under test, so nothing here asks a model
 * anything — it is pure arithmetic against the compiled prompt.
 *
 * Used by:
 *   - src/app/api/verify/route.ts (ES import via verify-plan.ts)
 *   - whatsapp-worker.js          (CommonJS require, if the scheduler ever gates on it)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const { compilePromptText, getDayVariantName } = require('./compile-prompt.js');

// A plan is judged against the weights it prints, so every tolerance below is
// about display rounding, not about how close the diet may drift from target.
const TOL = {
  kcalRow: 1.01,      // one ingredient row, rounded to whole kcal
  kcalMealTotal: 1.51,
  kcalDay: 2.01,
  macroRow: 0.101,    // grams, printed to one decimal
  macroRowHard: 0.3,  // beyond this a row mismatch is a real error, not rounding
  macroMealTotal: 0.151,
  macroMealTotalHard: 0.4,
  macroDay: 0.51,
  mineralMg: 2.01,
  ratio: 0.006,
  grams: 0.01
};

const SEV = { ERROR: 'error', WARNING: 'warning' };

/** Sodium delivered by 1 g of table salt, per the prompt's reference table. */
const SODIUM_MG_PER_G_SALT = 388;

// An AUTO ingredient with no max still has to stop somewhere for the
// feasibility LP; no real ingredient reaches this weight in a day.
const UNBOUNDED_MAX_G = 5000;

const num = (value) => {
  const match = String(value).replace(/,/g, '').match(/-?[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
};

const clean = (value) => String(value).replace(/\*\*/g, '').replace(/[✓✅❗⚠️🔴🟢]/g, '').trim();

/** Decimal places the plan printed for the first number in a cell. */
function decimalsOf(cellText) {
  const match = String(cellText).replace(/,/g, '').match(/-?\d+\.(\d+)/);
  return match ? match[1].length : 0;
}

/**
 * Half of the last printed digit: a figure rounded to whole grams may sit up to
 * 0.5 g from its exact value and still be correctly rounded. Judging a plan
 * against more precision than it printed is how a checker manufactures noise.
 */
function roundingSlack(decimals, floor) {
  return Math.max(floor, 0.5 * Math.pow(10, -decimals) + 1e-9);
}

const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');

// -------------------------------------------------------------
// REFERENCE NUTRITION TABLE
// -------------------------------------------------------------

/**
 * Parse the STANDARD RAW NUTRITIONAL REFERENCE DATABASE straight out of the
 * compiled prompt, so the verifier can never drift from what the model was
 * told. Returns a lookup keyed by every alias the prompt lists.
 */
function buildReferenceDb(config, day) {
  const prompt = compilePromptText(config, { mode: 'single', selectedDay: day });
  const start = prompt.indexOf('STANDARD RAW NUTRITIONAL REFERENCE DATABASE');
  const end = prompt.indexOf('* If any ingredient is not listed above');
  if (start === -1 || end === -1) return new Map();

  const db = new Map();
  for (const line of prompt.slice(start, end).split('\n')) {
    if (!line.startsWith('- ')) continue;
    const body = line.slice(2);

    if (body.startsWith('Water')) {
      const water = { key: 'Water', kcalPerG: 0, p: 0, c: 0, f: 0, na: 0, k: 0 };
      for (const alias of ['water']) db.set(alias, water);
      continue;
    }

    if (body.startsWith('Table Salt')) {
      const salt = { key: 'Table Salt (NaCl)', kcalPerG: 0, p: 0, c: 0, f: 0, na: SODIUM_MG_PER_G_SALT * 100, k: 0, isSalt: true };
      for (const alias of ['table salt', 'table salt (nacl)', 'salt', 'nacl']) db.set(alias, salt);
      continue;
    }

    const split = body.indexOf(': ');
    if (split === -1) continue;
    const names = body.slice(0, split);
    const parsed = body.slice(split + 2).match(
      /^([\d.]+) kcal \(([\d.]+) kcal\/g\), ([\d.]+)g Protein, ([\d.]+)g Carbs, ([\d.]+)g Fat, ([\d.]+)mg Sodium, ([\d.]+)mg Potassium/
    );
    if (!parsed) continue;

    const entry = {
      key: names,
      kcalPerG: parseFloat(parsed[2]),
      p: parseFloat(parsed[3]),
      c: parseFloat(parsed[4]),
      f: parseFloat(parsed[5]),
      na: parseFloat(parsed[6]),
      k: parseFloat(parsed[7])
    };
    for (const alias of names.split(' / ')) db.set(alias.trim().toLowerCase(), entry);
  }
  return db;
}

/**
 * Resolve an ingredient name the plan printed to a reference entry. Plans
 * rename things slightly ("Potato" for "Potato (Raw)", "Table Salt (split)"),
 * so fall back to the un-parenthesised base name before giving up.
 */
function makeLookup(db) {
  return function lookup(name) {
    const normalized = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    if (db.has(normalized)) return db.get(normalized);

    const base = normalized.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (db.has(base)) return db.get(base);
    if (/\bsalt\b/.test(normalized)) return db.get('salt') || null;
    return null;
  };
}

// -------------------------------------------------------------
// PLAN PARSING
// Models vary the markdown between runs (heading levels, bold, table label
// wording), so every pattern here is deliberately loose.
// -------------------------------------------------------------

const MEAL_HEADING = /^#{0,6}\s*\*{0,2}\s*(\d+)\.\s+(.+?)\s*\*{0,2}\s*\((\d+)\s+Meals?\s+Per\s+Day\)\s*\*{0,2}\s*$/i;

function parsePlan(text, day) {
  const lines = String(text).split('\n');

  // Part 2 opens with the cook template's "### DAY: variant" heading. Splitting
  // there beats splitting on the first '---', which some runs put mid-Part-1.
  const dayHeading = new RegExp(`^#{0,6}\\s*\\*{0,2}${day}\\s*:`, 'i');
  let splitAt = lines.findIndex((line) => dayHeading.test(line.trim()) && !/sodium|potassium/i.test(line));
  if (splitAt === -1) splitAt = lines.length;

  const part1Lines = lines.slice(0, splitAt);
  const part2Lines = lines.slice(splitAt);
  const part1 = part1Lines.join('\n');
  const part2 = part2Lines.join('\n');

  return {
    part1,
    part2,
    nak: parseSodiumSummary(part1),
    meals: parseMealTables(part1Lines),
    totals: parseDailyTotals(part1),
    cook: parseCookPlan(part2Lines, day)
  };
}

function parseSodiumSummary(part1) {
  const nak = { adjustment: '' };

  const headline = part1.match(
    /Total Sodium:\s*\*{0,2}([\d,.]+)\s*mg\*{0,2}\s*\|\s*Total Potassium:\s*\*{0,2}([\d,.]+)\s*mg\*{0,2}\s*\|\s*Na:K Ratio:\s*\*{0,2}([\d.]+)\*{0,2}\s*(?:\(([^)]+)\))?/i
  );
  if (headline) {
    nak.sodium = num(headline[1]);
    nak.potassium = num(headline[2]);
    nak.ratio = parseFloat(headline[3]);
    nak.verdict = headline[4] ? clean(headline[4]) : '';
  }

  const breakdown = part1.match(
    /Includes\s*\*{0,2}\s*([\d,.]+)\s*mg\*{0,2}\s*sodium from consumed salt[^.]*?and\s*\*{0,2}\s*([\d,.]+)\s*mg\*{0,2}\s*natural sodium/i
  );
  if (breakdown) {
    nak.saltSodium = num(breakdown[1]);
    nak.naturalSodium = num(breakdown[2]);
  }

  const adjustment = part1.match(/Ratio Adjustment Info\*{0,2}\s*:?\*{0,2}\s*(.+)/i);
  if (adjustment) nak.adjustment = adjustment[1].trim();

  return nak;
}

function parseMealTables(part1Lines) {
  const meals = [];

  for (let i = 0; i < part1Lines.length; i++) {
    const heading = part1Lines[i].trim().match(MEAL_HEADING);
    if (!heading) continue;

    const meal = { name: clean(heading[2]), perDay: parseInt(heading[3], 10), rows: [], total: null, totalLabel: '' };

    let j = i + 1;
    while (j < part1Lines.length && !part1Lines[j].trim().startsWith('|')) {
      if (MEAL_HEADING.test(part1Lines[j].trim())) break;
      j++;
    }
    if (j >= part1Lines.length || !part1Lines[j].trim().startsWith('|')) {
      meals.push(meal);
      continue;
    }

    j += 2; // skip the header row and its |---| separator
    for (; j < part1Lines.length && part1Lines[j].trim().startsWith('|'); j++) {
      const cells = part1Lines[j].split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 7) continue;

      const name = clean(cells[0]);
      const macro = (index) => ({
        grams: num(cells[index]),
        kcal: num((cells[index].match(/\(([^)]*)\)/) || [])[1]),
        decimals: decimalsOf(cells[index])
      });
      const row = {
        name,
        perMealGrams: num(cells[1]),
        dailyGrams: num(cells[2]),
        kcal: num(cells[3]),
        protein: macro(4).grams,
        proteinKcal: macro(4).kcal,
        proteinDecimals: macro(4).decimals,
        carbs: macro(5).grams,
        carbsKcal: macro(5).kcal,
        carbsDecimals: macro(5).decimals,
        fat: macro(6).grams,
        fatKcal: macro(6).kcal,
        fatDecimals: macro(6).decimals
      };

      if (/^total\b/i.test(name)) {
        meal.total = row;
        meal.totalLabel = name;
      } else {
        meal.rows.push(row);
      }
    }

    meals.push(meal);
    i = j - 1;
  }

  return meals;
}

function parseDailyTotals(part1) {
  const totals = { perMeal: {} };

  // One bullet per meal under the summary heading: "- Meal Name: **1234 kcal**
  // daily (**411 kcal** per meal x 3)". Anchored to that heading so a
  // similarly shaped line earlier in Part 1 cannot be read as a summary entry.
  // Plans generated before the template switched to per-meal bullets put every
  // meal on one pipe-separated "meal calories" line, so both shapes are read.
  const summaryStart = part1.search(/^#{0,6}\s*\*{0,2}\s*Daily Totals/im);
  if (summaryStart !== -1) {
    const addEntry = (rawName, rawKcal) => {
      const name = clean(rawName).replace(/daily total/i, '').replace(/:$/, '').trim();
      if (!name || /^(total|final)\b/i.test(name)) return;
      totals.perMeal[name] = num(rawKcal);
    };

    for (const line of part1.slice(summaryStart).split('\n').slice(1)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#{1,6}\s/.test(trimmed) || trimmed === '---') break;
      if (!trimmed.startsWith('-')) continue;

      const legacy = trimmed.match(/meal calories\*{0,2}\s*:\s*(.+)/i);
      if (legacy) {
        for (const segment of legacy[1].split('|')) {
          const entry = segment.match(/(.+?):\s*\*{0,2}([\d,]+)\s*kcal/i);
          if (entry) addEntry(entry[1], entry[2]);
        }
        continue;
      }

      const entry = trimmed.match(/^-\s*\*{0,2}(.+?)\*{0,2}\s*:\s*\*{0,2}\s*([\d,]+)\s*kcal/i);
      if (entry) addEntry(entry[1], entry[2]);
    }
  }

  const calories = part1.match(/(?:Final Aggregated |Final |)Total Daily Calories\*{0,2}\s*:?\*{0,2}\s*\*{0,2}([\d,]+)\s*kcal/i);
  totals.calories = calories ? num(calories[1]) : NaN;

  const macro = (primary, fallback) => {
    const match = part1.match(primary) || (fallback ? part1.match(fallback) : null);
    return match ? { grams: parseFloat(match[1]), kcal: num(match[2]) } : null;
  };
  const protein = macro(
    /Total (?:Daily )?Protein\*{0,2}\s*:?\*{0,2}\s*\*{0,2}([\d.]+)\s*g\s*\(([\d,]+)\s*kcal\)/i,
    /Protein:\s*([\d.]+)g\s*\(([\d,]+)\s*kcal\)/i
  );
  const carbs = macro(
    /Total (?:Daily )?Carb(?:ohydrate)?s?\*{0,2}\s*:?\*{0,2}\s*\*{0,2}([\d.]+)\s*g\s*\(([\d,]+)\s*kcal\)/i,
    /Carbs:\s*([\d.]+)g\s*\(([\d,]+)\s*kcal\)/i
  );
  const fat = macro(
    /Total (?:Daily )?Fat\*{0,2}\s*:?\*{0,2}\s*\*{0,2}([\d.]+)\s*g\s*\(([\d,]+)\s*kcal\)/i,
    /Fat:\s*([\d.]+)g\s*\(([\d,]+)\s*kcal\)/i
  );

  totals.protein = protein ? protein.grams : NaN;
  totals.proteinKcal = protein ? protein.kcal : NaN;
  totals.carbs = carbs ? carbs.grams : NaN;
  totals.carbsKcal = carbs ? carbs.kcal : NaN;
  totals.fat = fat ? fat.grams : NaN;
  totals.fatKcal = fat ? fat.kcal : NaN;

  const crossCheck = part1.match(
    /Macro [Cc]alorie (?:check|cross-check|verification)\*{0,2}\s*:?\*{0,2}\s*([\d,]+)\s*\+\s*([\d,]+)\s*\+\s*([\d,]+)\s*[=≈]\s*\*{0,2}([\d,]+)/i
  );
  totals.crossCheck = crossCheck
    ? { protein: num(crossCheck[1]), carbs: num(crossCheck[2]), fat: num(crossCheck[3]), sum: num(crossCheck[4]) }
    : null;

  return totals;
}

function parseCookPlan(part2Lines, day) {
  const cook = { heading: '', blocks: [] };
  let current = null;

  for (const raw of part2Lines) {
    const line = clean(raw);
    if (!line || line === '---') continue;

    const dayHeading = line.match(/^#{0,6}\s*([A-Z]+)\s*:\s*(.*)$/);
    if (dayHeading && dayHeading[1] === day) {
      cook.heading = dayHeading[2].trim();
      continue;
    }
    if (/^#{1,6}\s/.test(raw.trim())) continue; // section headings the template never asked for

    const blockHeading = line.match(/^(.+?)\s*(?:\(x(\d+)\s*daily\))?\s*:\s*$/);
    if (blockHeading && !/^(liquids|prep method)/i.test(line)) {
      current = { name: blockHeading[1].trim(), frequency: blockHeading[2] ? parseInt(blockHeading[2], 10) : null, lines: [] };
      cook.blocks.push(current);
      continue;
    }

    if (current) current.lines.push(line);
  }

  return cook;
}

// -------------------------------------------------------------
// EXPECTED CONFIGURATION FOR ONE DAY
// -------------------------------------------------------------

function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

/**
 * Copy the fields this module reads off an ingredient.
 *
 * Spreading is not an option: config arrives as a Mongoose document in the API
 * route, and `{ ...subdoc }` copies Mongoose internals rather than the data.
 */
function normalizeIngredient(ing, source) {
  return {
    name: ing.name,
    weight: ing.weight,
    isAuto: !!ing.isAuto,
    minGrams: ing.minGrams,
    maxGrams: ing.maxGrams,
    split: ing.split,
    personalOnly: !!ing.personalOnly,
    mealId: ing.mealId,
    source
  };
}

/** Active meals for a day, each with its own ingredients plus that day's variables. */
function expectedMeals(config, day) {
  const active = (config.meals || []).filter((meal) => !meal.disabled);
  const variables = (mapGet(config.dailyVariables, day) || []).filter((ing) => !ing.disabled);

  return active.map((meal) => ({
    meal,
    ingredients: [
      ...(meal.ingredients || []).filter((ing) => !ing.disabled).map((ing) => normalizeIngredient(ing, 'meal')),
      ...variables
        .filter((ing) => (ing.mealId || 'meal-chicken') === meal.id)
        .map((ing) => normalizeIngredient(ing, 'variable'))
    ]
  }));
}

// -------------------------------------------------------------
// FEASIBILITY: is the configured Na:K range reachable at all?
// -------------------------------------------------------------

/**
 * Minimise a linear objective over the AUTO weights subject to hitting the
 * calorie target exactly, within each ingredient's min/max. One equality
 * constraint plus box bounds makes the greedy fractional-knapsack solution
 * exact, so no LP library is needed.
 */
function solveWithCalorieBudget(vars, weights, budget) {
  const x = vars.map((v) => v.lo);
  let remaining = budget - vars.reduce((sum, v, i) => sum + v.kcalPerG * x[i], 0);
  if (remaining < -1e-6) return null; // even every AUTO at its minimum overshoots

  const order = vars
    .map((v, i) => ({ i, rate: v.kcalPerG > 0 ? weights[i] / v.kcalPerG : Infinity }))
    .filter((entry) => vars[entry.i].kcalPerG > 0)
    .sort((a, b) => a.rate - b.rate);

  for (const entry of order) {
    if (remaining <= 1e-9) break;
    const headroomKcal = (vars[entry.i].hi - x[entry.i]) * vars[entry.i].kcalPerG;
    const take = Math.min(headroomKcal, remaining);
    x[entry.i] += take / vars[entry.i].kcalPerG;
    remaining -= take;
  }

  if (remaining > 1e-6) return null; // the AUTO ceilings cannot reach the target
  return x;
}

/**
 * Lowest Na:K ratio any plan could reach for this day while hitting the calorie
 * target — the yardstick that separates "the model did badly" from "these
 * targets cannot both be met".
 */
function computeFeasibility(config, day) {
  const db = buildReferenceDb(config, day);
  const lookup = makeLookup(db);
  const target = Number(config.global?.dailyCalorieTarget) || 0;
  const ratioMax = config.global?.idealSodiumPotassiumRatioMax ?? 0.8;

  let fixedKcal = 0;
  let fixedNa = 0;
  let fixedK = 0;
  const vars = [];

  for (const { meal, ingredients } of expectedMeals(config, day)) {
    void meal;
    for (const ing of ingredients) {
      const ref = lookup(ing.name);
      if (!ref) return null; // an unpriced ingredient makes the bound meaningless
      if (ing.isAuto) {
        vars.push({
          name: ing.name,
          lo: ing.minGrams ? parseFloat(ing.minGrams) : 0,
          hi: ing.maxGrams ? parseFloat(ing.maxGrams) : UNBOUNDED_MAX_G,
          kcalPerG: ref.isSalt ? 0 : ref.kcalPerG,
          na: ref.na / 100,
          k: ref.k / 100
        });
      } else {
        const grams = parseFloat(ing.weight) || 0;
        fixedKcal += ref.isSalt ? 0 : grams * ref.kcalPerG;
        fixedNa += ref.isSalt ? grams * SODIUM_MG_PER_G_SALT : (grams * ref.na) / 100;
        fixedK += (grams * ref.k) / 100;
      }
    }
  }

  const budget = target - fixedKcal;
  const evaluate = (ratio) => {
    const x = solveWithCalorieBudget(vars, vars.map((v) => v.na - ratio * v.k), budget);
    if (!x) return null;
    const sodium = fixedNa + vars.reduce((sum, v, i) => sum + v.na * x[i], 0);
    const potassium = fixedK + vars.reduce((sum, v, i) => sum + v.k * x[i], 0);
    return { sodium, potassium, ratio: sodium / potassium };
  };

  if (!evaluate(0)) {
    return { calorieTargetReachable: false, bestRatio: null, ratioReachable: false };
  }

  // Binary search the smallest r for which some mix satisfies Na - r*K <= 0.
  let lo = 0;
  let hi = 5;
  for (let iteration = 0; iteration < 60; iteration++) {
    const mid = (lo + hi) / 2;
    const point = evaluate(mid);
    if (point && point.sodium - mid * point.potassium <= 0) hi = mid;
    else lo = mid;
  }

  const best = evaluate(hi);
  if (!best) return { calorieTargetReachable: true, bestRatio: null, ratioReachable: false };

  const ratioReachable = best.ratio <= ratioMax + 1e-6;
  return {
    calorieTargetReachable: true,
    bestRatio: best.ratio,
    ratioReachable,
    extraPotassiumNeededMg: ratioReachable ? 0 : Math.round(best.sodium / ratioMax - best.potassium),
    saltReductionNeededG: ratioReachable ? 0 : Math.round(((best.sodium - ratioMax * best.potassium) / SODIUM_MG_PER_G_SALT) * 100) / 100
  };
}

// -------------------------------------------------------------
// VERIFICATION
// -------------------------------------------------------------

function makeIssueSink() {
  const issues = [];
  const push = (severity, category, message) => issues.push({ severity, category, message });
  return {
    issues,
    error: (category, message) => push(SEV.ERROR, category, message),
    warn: (category, message) => push(SEV.WARNING, category, message)
  };
}

/**
 * Verify one day's generated plan against the config it was generated from.
 *
 * @param {object} config   – Config document (plain object or Mongoose doc)
 * @param {string} day      – 'MONDAY' … 'SUNDAY'
 * @param {string} planText – The cached responseText for that day
 */
function verifyPlan(config, day, planText) {
  const sink = makeIssueSink();
  const dayKey = String(day).toUpperCase();
  const target = Number(config.global?.dailyCalorieTarget) || 0;
  const ratioMin = config.global?.idealSodiumPotassiumRatioMin ?? 0.7;
  const ratioMax = config.global?.idealSodiumPotassiumRatioMax ?? 0.8;

  const empty = {
    day: dayKey,
    ok: false,
    checkedAt: new Date().toISOString(),
    issues: [],
    errorCount: 0,
    warningCount: 0,
    computed: null,
    stated: null,
    feasibility: null
  };

  if (!planText || !String(planText).trim()) {
    sink.error('format', 'No generated plan to verify for this day.');
    return { ...empty, issues: sink.issues, errorCount: 1 };
  }

  const db = buildReferenceDb(config, dayKey);
  const lookup = makeLookup(db);
  const plan = parsePlan(planText, dayKey);
  const expected = expectedMeals(config, dayKey);

  if (plan.meals.length === 0) {
    sink.error('format', 'Could not find any "N. Meal name (X Meals Per Day)" tables in Part 1 — the plan does not follow the expected format.');
    return { ...empty, issues: sink.issues, errorCount: 1 };
  }
  if (plan.meals.length !== expected.length) {
    sink.error('format', `Part 1 has ${plan.meals.length} meal section(s), the config has ${expected.length} active meal(s).`);
  }

  let dayKcal = 0;
  let dayProtein = 0;
  let dayCarbs = 0;
  let dayFat = 0;
  let daySodium = 0;
  let dayPotassium = 0;
  let saltGrams = 0;
  let unpricedIngredients = 0;
  const mealDailyKcal = new Map();

  for (let index = 0; index < plan.meals.length; index++) {
    const parsed = plan.meals[index];
    const config1 = expected[index];
    const perDay = config1 ? config1.meal.mealsPerDay : parsed.perDay;

    if (config1) {
      if (parsed.name.toLowerCase() !== config1.meal.name.trim().toLowerCase()) {
        sink.error('format', `Part 1 section ${index + 1} is "${parsed.name}" but the config's meal ${index + 1} is "${config1.meal.name.trim()}".`);
      }
      if (parsed.perDay !== config1.meal.mealsPerDay) {
        sink.error('weights', `"${parsed.name}": header says ${parsed.perDay} meals/day, the config says ${config1.meal.mealsPerDay}.`);
      }
    }

    let perMealKcal = 0;
    let perMealProtein = 0;
    let perMealCarbs = 0;
    let perMealFat = 0;
    // What the printed rows literally add up to — a Total row that matches the
    // (rounded) numbers above it is self-consistent, which is all it claims.
    let printedKcal = 0;
    let printedProtein = 0;
    let printedCarbs = 0;
    let printedFat = 0;
    let thisMealKcal = 0;
    let thisMealProtein = 0;
    let thisMealCarbs = 0;
    let thisMealFat = 0;

    for (const row of parsed.rows) {
      const ref = lookup(row.name);
      const dailyGrams = Number.isFinite(row.dailyGrams) ? row.dailyGrams : row.perMealGrams * perDay;
      const printedPerMeal = Number.isFinite(row.perMealGrams) ? row.perMealGrams : dailyGrams / perDay;

      if (!ref) {
        // Not in the reference table: the prompt lets the model fall back to
        // USDA values, so trust the row but say the totals are unverified.
        unpricedIngredients++;
        sink.warn('reference', `"${row.name}" is not in the reference nutrition table, so its numbers could not be re-derived.`);
        perMealKcal += row.kcal || 0;
        perMealProtein += row.protein || 0;
        perMealCarbs += row.carbs || 0;
        perMealFat += row.fat || 0;
        printedKcal += row.kcal || 0;
        printedProtein += row.protein || 0;
        printedCarbs += row.carbs || 0;
        printedFat += row.fat || 0;
        thisMealKcal += (row.kcal || 0) * perDay;
        thisMealProtein += (row.protein || 0) * perDay;
        thisMealCarbs += (row.carbs || 0) * perDay;
        thisMealFat += (row.fat || 0) * perDay;
        continue;
      }

      if (Number.isFinite(row.perMealGrams) && Number.isFinite(row.dailyGrams)
        && Math.abs(printedPerMeal * perDay - dailyGrams) > 0.5 * perDay + TOL.grams) {
        sink.error('weights', `"${parsed.name}" / ${row.name}: ${printedPerMeal}g per meal × ${perDay} = ${fmt(printedPerMeal * perDay)}g, but the daily total column says ${dailyGrams}g.`);
      }

      // A per-meal cell may be derived from the printed (rounded) per-meal
      // weight or from the exact daily ÷ meals — accept either.
      const bases = [printedPerMeal, dailyGrams / perDay];
      const valueFor = (weight, per100) => (per100 === null ? (ref.isSalt ? 0 : weight * ref.kcalPerG) : (weight * per100) / 100);
      const matches = (stated, per100, tolerance) => bases.some((w) => Math.abs(valueFor(w, per100) - stated) <= tolerance);
      const closest = (stated, per100) => bases
        .map((w) => valueFor(w, per100))
        .reduce((a, b) => (Math.abs(a - stated) < Math.abs(b - stated) ? a : b));

      if (Number.isFinite(row.kcal) && !matches(row.kcal, null, TOL.kcalRow)) {
        sink.error('calories', `"${parsed.name}" / ${row.name} ${printedPerMeal}g: shows ${row.kcal} kcal, should be ${fmt(closest(row.kcal, null))}.`);
      }
      for (const [label, stated, per100, decimals] of [
        ['protein', row.protein, ref.p, row.proteinDecimals],
        ['carbs', row.carbs, ref.c, row.carbsDecimals],
        ['fat', row.fat, ref.f, row.fatDecimals]
      ]) {
        const slack = roundingSlack(decimals, TOL.macroRow);
        if (!Number.isFinite(stated) || matches(stated, per100, slack)) continue;
        const expectedValue = closest(stated, per100);
        const severe = Math.abs(expectedValue - stated) > Math.max(TOL.macroRowHard, slack * 2);
        sink[severe ? 'error' : 'warn']('macros', `"${parsed.name}" / ${row.name} ${printedPerMeal}g: ${label} ${stated}g, computed ${fmt(expectedValue, 2)}g.`);
      }
      for (const [label, grams, statedKcal, perGram] of [
        ['protein', row.protein, row.proteinKcal, 4],
        ['carbs', row.carbs, row.carbsKcal, 4],
        ['fat', row.fat, row.fatKcal, 9]
      ]) {
        if (Number.isFinite(statedKcal) && Number.isFinite(grams) && Math.abs(grams * perGram - statedKcal) > TOL.kcalRow) {
          sink.warn('macros', `"${parsed.name}" / ${row.name}: ${label} ${grams}g printed as ${statedKcal} kcal (should be ${Math.round(grams * perGram)}).`);
        }
      }

      printedKcal += Number.isFinite(row.kcal) ? row.kcal : 0;
      printedProtein += Number.isFinite(row.protein) ? row.protein : 0;
      printedCarbs += Number.isFinite(row.carbs) ? row.carbs : 0;
      printedFat += Number.isFinite(row.fat) ? row.fat : 0;

      const exactPerMeal = dailyGrams / perDay;
      perMealKcal += ref.isSalt ? 0 : exactPerMeal * ref.kcalPerG;
      perMealProtein += (exactPerMeal * ref.p) / 100;
      perMealCarbs += (exactPerMeal * ref.c) / 100;
      perMealFat += (exactPerMeal * ref.f) / 100;

      thisMealKcal += ref.isSalt ? 0 : dailyGrams * ref.kcalPerG;
      thisMealProtein += (dailyGrams * ref.p) / 100;
      thisMealCarbs += (dailyGrams * ref.c) / 100;
      thisMealFat += (dailyGrams * ref.f) / 100;

      if (ref.isSalt) {
        saltGrams += dailyGrams;
      } else {
        daySodium += (dailyGrams * ref.na) / 100;
        dayPotassium += (dailyGrams * ref.k) / 100;
      }
    }

    if (parsed.total) {
      // Some runs label the total row "Total (Daily, 3 Meals)" instead of per meal.
      const isDailyTotal = /daily/i.test(parsed.totalLabel)
        || (perDay > 1 && Math.abs(parsed.total.kcal - thisMealKcal) < Math.abs(parsed.total.kcal - perMealKcal));
      const [totalKcal, totalProtein, totalCarbs, totalFat] = isDailyTotal
        ? [thisMealKcal, thisMealProtein, thisMealCarbs, thisMealFat]
        : [perMealKcal, perMealProtein, perMealCarbs, perMealFat];
      // A Total may be derived from exact values or from the printed rows;
      // either is defensible, so only flag it when neither explains it.
      const totalMatches = (stated, exact, printed, tolerance) =>
        Math.abs(exact - stated) <= tolerance || Math.abs(printed - stated) <= tolerance;

      if (Number.isFinite(parsed.total.kcal)
        && !totalMatches(parsed.total.kcal, totalKcal, printedKcal, TOL.kcalMealTotal)) {
        sink.error('calories', `"${parsed.name}": Total row says ${parsed.total.kcal} kcal, its own rows sum to ${fmt(totalKcal)}.`);
      }
      for (const [label, stated, computed, printed, decimals] of [
        ['protein', parsed.total.protein, totalProtein, printedProtein, parsed.total.proteinDecimals],
        ['carbs', parsed.total.carbs, totalCarbs, printedCarbs, parsed.total.carbsDecimals],
        ['fat', parsed.total.fat, totalFat, printedFat, parsed.total.fatDecimals]
      ]) {
        const slack = roundingSlack(decimals, TOL.macroMealTotal);
        if (!Number.isFinite(stated) || totalMatches(stated, computed, printed, slack)) continue;
        const severe = Math.min(Math.abs(computed - stated), Math.abs(printed - stated)) > Math.max(TOL.macroMealTotalHard, slack * 2);
        sink[severe ? 'error' : 'warn']('macros', `"${parsed.name}": Total ${label} ${stated}g, rows sum to ${fmt(computed, 2)}g.`);
      }
    } else {
      sink.warn('format', `"${parsed.name}": the table has no Total row.`);
    }

    mealDailyKcal.set(parsed.name, { exact: thisMealKcal, printed: printedKcal * perDay, perDay });
    dayKcal += thisMealKcal;
    dayProtein += thisMealProtein;
    dayCarbs += thisMealCarbs;
    dayFat += thisMealFat;

    if (!config1) continue;
    checkMealAgainstConfig(sink, config1, parsed, lookup);
  }

  const saltSodium = saltGrams * SODIUM_MG_PER_G_SALT;
  const totalSodium = saltSodium + daySodium;
  const ratio = dayPotassium > 0 ? totalSodium / dayPotassium : NaN;
  const mineralsTrusted = unpricedIngredients === 0;

  checkMinerals(sink, plan.nak, {
    saltSodium,
    saltGrams,
    naturalSodium: daySodium,
    totalSodium,
    potassium: dayPotassium,
    ratio,
    ratioMin,
    ratioMax,
    mineralsTrusted
  });

  checkDailyTotals(sink, plan.totals, {
    target,
    dayKcal,
    dayProtein,
    dayCarbs,
    dayFat,
    mealDailyKcal,
    trusted: mineralsTrusted
  });

  checkCookPlan(sink, plan, expected, dayKey, config);

  const feasibility = computeFeasibility(config, dayKey);
  if (feasibility && feasibility.ratioReachable === false && feasibility.bestRatio !== null
    && Number.isFinite(ratio) && ratio > ratioMax) {
    sink.warn(
      'sodium',
      `The ${ratioMin}–${ratioMax} Na:K range is not reachable for this day: the best any plan could do is ${fmt(feasibility.bestRatio, 3)} (needs ${feasibility.extraPotassiumNeededMg} mg more potassium, or ${feasibility.saltReductionNeededG} g less salt).`
    );
  }

  const errorCount = sink.issues.filter((issue) => issue.severity === SEV.ERROR).length;
  const warningCount = sink.issues.length - errorCount;

  return {
    day: dayKey,
    ok: errorCount === 0,
    checkedAt: new Date().toISOString(),
    issues: sink.issues,
    errorCount,
    warningCount,
    computed: {
      calories: Math.round(dayKcal * 10) / 10,
      protein: Math.round(dayProtein * 10) / 10,
      carbs: Math.round(dayCarbs * 10) / 10,
      fat: Math.round(dayFat * 10) / 10,
      sodium: Math.round(totalSodium),
      saltGrams: Math.round(saltGrams * 100) / 100,
      potassium: Math.round(dayPotassium),
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 1000 : null,
      inIdealRange: Number.isFinite(ratio) ? ratio >= ratioMin - 1e-9 && ratio <= ratioMax + 1e-9 : null
    },
    stated: {
      calories: Number.isFinite(plan.totals.calories) ? plan.totals.calories : null,
      protein: Number.isFinite(plan.totals.protein) ? plan.totals.protein : null,
      carbs: Number.isFinite(plan.totals.carbs) ? plan.totals.carbs : null,
      fat: Number.isFinite(plan.totals.fat) ? plan.totals.fat : null,
      sodium: Number.isFinite(plan.nak.sodium) ? plan.nak.sodium : null,
      potassium: Number.isFinite(plan.nak.potassium) ? plan.nak.potassium : null,
      ratio: Number.isFinite(plan.nak.ratio) ? plan.nak.ratio : null,
      verdict: plan.nak.verdict || null
    },
    target,
    feasibility
  };
}

/** Fixed weights honoured, AUTO weights inside their bounds, nothing invented. */
function checkMealAgainstConfig(sink, expectedMeal, parsedMeal, lookup) {
  const mealName = expectedMeal.meal.name.trim();
  const perDay = expectedMeal.meal.mealsPerDay;
  const matched = new Set();

  for (const ing of expectedMeal.ingredients) {
    const row = parsedMeal.rows.find(
      (candidate) => !matched.has(candidate) && candidate.name.trim().toLowerCase() === ing.name.trim().toLowerCase()
    );
    if (!row) {
      sink.error('weights', `"${mealName}": configured ingredient "${ing.name}" is missing from the Part 1 table.`);
      continue;
    }
    matched.add(row);

    const dailyGrams = Number.isFinite(row.dailyGrams) ? row.dailyGrams : row.perMealGrams * perDay;
    if (!ing.isAuto) {
      const configured = parseFloat(ing.weight);
      if (Number.isFinite(configured) && Math.abs(dailyGrams - configured) > TOL.grams) {
        sink.error('weights', `"${mealName}" / ${ing.name}: the config fixes this at ${configured}g/day, the plan uses ${dailyGrams}g/day.`);
      }
      continue;
    }

    const min = ing.minGrams ? parseFloat(ing.minGrams) : null;
    const max = ing.maxGrams ? parseFloat(ing.maxGrams) : null;
    if (min !== null && dailyGrams < min - TOL.grams) {
      sink.error('weights', `"${mealName}" / ${ing.name}: AUTO solved to ${dailyGrams}g, below the configured minimum of ${min}g.`);
    }
    if (max !== null && dailyGrams > max + TOL.grams) {
      sink.error('weights', `"${mealName}" / ${ing.name}: AUTO solved to ${dailyGrams}g, above the configured maximum of ${max}g.`);
    }
  }

  for (const row of parsedMeal.rows) {
    if (matched.has(row)) continue;
    sink.error('weights', `"${mealName}": Part 1 lists "${row.name}", which is not in the config for this day.`);
  }
}

function checkMinerals(sink, stated, computed) {
  const severity = computed.mineralsTrusted ? 'error' : 'warn';

  if (Number.isFinite(stated.saltSodium) && Math.abs(stated.saltSodium - computed.saltSodium) > TOL.kcalRow) {
    sink.error('sodium', `Sodium from salt: the plan says ${stated.saltSodium} mg, the actual salt in the plan is ${computed.saltGrams}g = ${Math.round(computed.saltSodium)} mg.`);
  }
  if (Number.isFinite(stated.naturalSodium) && Math.abs(stated.naturalSodium - computed.naturalSodium) > TOL.mineralMg) {
    sink[severity]('sodium', `Natural sodium: the plan says ${stated.naturalSodium} mg, computed ${Math.round(computed.naturalSodium)} mg.`);
  }
  if (Number.isFinite(stated.sodium) && Math.abs(stated.sodium - computed.totalSodium) > TOL.mineralMg) {
    sink[severity]('sodium', `Total sodium: the plan says ${stated.sodium} mg, computed ${Math.round(computed.totalSodium)} mg (off by ${Math.round(stated.sodium - computed.totalSodium)} mg).`);
  }
  if (Number.isFinite(stated.potassium) && Math.abs(stated.potassium - computed.potassium) > TOL.mineralMg) {
    sink[severity]('sodium', `Total potassium: the plan says ${stated.potassium} mg, computed ${Math.round(computed.potassium)} mg (off by ${Math.round(stated.potassium - computed.potassium)} mg).`);
  }

  if (Number.isFinite(stated.sodium) && Number.isFinite(stated.potassium) && Number.isFinite(stated.ratio)
    && Math.abs(stated.sodium / stated.potassium - stated.ratio) > TOL.ratio) {
    sink.error('sodium', `Na:K ratio ${stated.ratio} does not match the plan's own numbers: ${stated.sodium}/${stated.potassium} = ${fmt(stated.sodium / stated.potassium, 3)}.`);
  }
  if (Number.isFinite(stated.ratio) && Number.isFinite(computed.ratio) && Math.abs(stated.ratio - computed.ratio) > TOL.ratio) {
    sink[severity]('sodium', `Na:K ratio: the plan says ${stated.ratio}, computed ${fmt(computed.ratio, 3)}.`);
  }

  if (Number.isFinite(computed.ratio)) {
    const actual = computed.ratio >= computed.ratioMin - 1e-9 && computed.ratio <= computed.ratioMax + 1e-9
      ? 'Ideal'
      : computed.ratio < computed.ratioMin ? 'Below Ideal' : 'Above Ideal';
    if (stated.verdict && stated.verdict.toLowerCase() !== actual.toLowerCase()) {
      sink[severity]('sodium', `The plan calls the ratio "${stated.verdict}", but ${fmt(computed.ratio, 3)} is ${actual} for the configured ${computed.ratioMin}–${computed.ratioMax} range.`);
    }
  }

  checkRatioAdvice(sink, stated);
}

/** The "add X mg potassium" advice must at least agree with the plan's own totals. */
function checkRatioAdvice(sink, stated) {
  if (!stated.adjustment || !Number.isFinite(stated.sodium) || !Number.isFinite(stated.potassium)) return;

  const potassiumAdvice = stated.adjustment.match(/additional\s*\*{0,2}\s*([\d,]+)\s*\*{0,2}\s*mg of Potassium to reach\s*\*{0,2}([\d.]+)/i);
  if (potassiumAdvice) {
    const needed = stated.sodium / parseFloat(potassiumAdvice[2]) - stated.potassium;
    if (Math.abs(needed - num(potassiumAdvice[1])) > TOL.kcalMealTotal) {
      sink.error('sodium', `Ratio advice: says ${num(potassiumAdvice[1])} mg more potassium to reach ${potassiumAdvice[2]}, its own numbers give ${fmt(needed, 0)} mg.`);
    }
  }

  const secondTarget = stated.adjustment.match(/or\s*\*{0,2}\s*([\d,]+)\s*\*{0,2}\s*mg to reach\s*\*{0,2}([\d.]+)/i);
  if (secondTarget) {
    const needed = stated.sodium / parseFloat(secondTarget[2]) - stated.potassium;
    if (Math.abs(needed - num(secondTarget[1])) > TOL.kcalMealTotal) {
      sink.error('sodium', `Ratio advice: says ${num(secondTarget[1])} mg more potassium to reach ${secondTarget[2]}, its own numbers give ${fmt(needed, 0)} mg.`);
    }
  }

  const sodiumAdvice = stated.adjustment.match(/additional\s*\*{0,2}\s*([\d,]+)\s*\*{0,2}\s*mg of Sodium.*?to reach\s*\*{0,2}([\d.]+)/i);
  if (sodiumAdvice) {
    const needed = parseFloat(sodiumAdvice[2]) * stated.potassium - stated.sodium;
    if (Math.abs(needed - num(sodiumAdvice[1])) > TOL.kcalMealTotal) {
      sink.error('sodium', `Ratio advice: says ${num(sodiumAdvice[1])} mg more sodium to reach ${sodiumAdvice[2]}, its own numbers give ${fmt(needed, 0)} mg.`);
    }
  }
}

function checkDailyTotals(sink, stated, computed) {
  const severity = computed.trusted ? 'error' : 'warn';

  for (const [name, meal] of computed.mealDailyKcal.entries()) {
    const key = Object.keys(stated.perMeal).find((candidate) => candidate.toLowerCase().startsWith(name.toLowerCase().slice(0, 8)));
    if (!key) continue;
    // A summary figure may be derived from the exact weights or from the
    // printed per-meal rows multiplied up, and whole-kcal row rounding puts
    // those up to half a kcal per row apart before the frequency multiplies
    // the gap. Accept either, and scale the slack the same way.
    const slack = TOL.kcalMealTotal * Math.max(1, meal.perDay);
    if (Math.abs(stated.perMeal[key] - meal.exact) > slack
      && Math.abs(stated.perMeal[key] - meal.printed) > slack) {
      sink[severity]('calories', `Daily summary: "${name}" listed as ${stated.perMeal[key]} kcal, its weights give ${fmt(meal.exact)} kcal.`);
    }
  }

  if (computed.target > 0 && Math.abs(computed.dayKcal - computed.target) > TOL.kcalDay) {
    sink[severity]('calories', `The plan's own weights total ${fmt(computed.dayKcal)} kcal against a ${computed.target} kcal target (off by ${fmt(computed.dayKcal - computed.target)}).`);
  }
  if (Number.isFinite(stated.calories) && Math.abs(stated.calories - computed.dayKcal) > TOL.kcalDay) {
    sink[severity]('calories', `The plan claims ${stated.calories} kcal but the weights it lists add up to ${fmt(computed.dayKcal)} kcal.`);
  }

  for (const [label, statedGrams, computedGrams] of [
    ['protein', stated.protein, computed.dayProtein],
    ['carbs', stated.carbs, computed.dayCarbs],
    ['fat', stated.fat, computed.dayFat]
  ]) {
    if (Number.isFinite(statedGrams) && Math.abs(statedGrams - computedGrams) > TOL.macroDay) {
      sink[severity]('macros', `Daily ${label}: the plan says ${statedGrams}g, computed ${fmt(computedGrams)}g.`);
    }
  }
  for (const [label, grams, kcal, perGram] of [
    ['protein', stated.protein, stated.proteinKcal, 4],
    ['carbs', stated.carbs, stated.carbsKcal, 4],
    ['fat', stated.fat, stated.fatKcal, 9]
  ]) {
    if (Number.isFinite(grams) && Number.isFinite(kcal) && Math.abs(grams * perGram - kcal) > TOL.kcalMealTotal) {
      sink.warn('macros', `Daily ${label} ${grams}g printed as ${kcal} kcal (should be ${Math.round(grams * perGram)}).`);
    }
  }

  if (stated.crossCheck) {
    const sum = stated.crossCheck.protein + stated.crossCheck.carbs + stated.crossCheck.fat;
    if (sum !== stated.crossCheck.sum) {
      sink.error('macros', `Macro cross-check arithmetic: ${stated.crossCheck.protein} + ${stated.crossCheck.carbs} + ${stated.crossCheck.fat} = ${sum}, but it prints ${stated.crossCheck.sum}.`);
    }
    if (computed.target > 0 && Math.abs(stated.crossCheck.sum - computed.target) > 3) {
      sink.error('macros', `The macro cross-check lands on ${stated.crossCheck.sum} kcal instead of the ${computed.target} kcal target — the plan is rationalising a gap rather than closing it.`);
    }
  }
}

/** Part 2 is what the cook actually receives, so it gets its own pass. */
function checkCookPlan(sink, plan, expected, day, config) {
  const blocks = plan.cook.blocks;
  if (blocks.length === 0) {
    sink.error('cook', 'Part 2 (cook instructions) is missing or could not be parsed.');
    return;
  }
  if (blocks.length !== expected.length) {
    sink.error('cook', `Part 2 has ${blocks.length} meal block(s), expected ${expected.length}.`);
  }

  expected.forEach((expectedMeal, index) => {
    const block = blocks[index];
    const mealName = expectedMeal.meal.name.trim();
    if (!block) {
      sink.error('cook', `Part 2 is missing the block for "${mealName}".`);
      return;
    }

    const isPerMeal = (expectedMeal.meal.cookQuantityMode || 'daily') === 'per-meal';
    if (block.name.toLowerCase() !== mealName.toLowerCase()) {
      sink.error('cook', `Part 2 block ${index + 1} is "${block.name}", expected "${mealName}".`);
    }
    if (isPerMeal && block.frequency !== expectedMeal.meal.mealsPerDay) {
      sink.error('cook', `Part 2 "${block.name}": per-meal meals need an "(x${expectedMeal.meal.mealsPerDay} daily)" suffix, found ${block.frequency === null ? 'none' : `x${block.frequency}`}.`);
    }
    if (!isPerMeal && block.frequency !== null) {
      sink.error('cook', `Part 2 "${block.name}": daily-total meals must not carry a frequency suffix (found x${block.frequency}).`);
    }

    const table = plan.meals[index];
    const listed = [];
    for (const line of block.lines) {
      if (/^(liquids|prep method)/i.test(line)) continue;
      const parsed = line.match(/^(.+?)\s+([\d.]+)\s*g\s*\((per meal|daily total)\)\s*$/i);
      if (!parsed) continue;

      const name = parsed[1].trim();
      const grams = parseFloat(parsed[2]);
      const mode = parsed[3].toLowerCase();
      listed.push(name.toLowerCase());

      if (isPerMeal !== (mode === 'per meal')) {
        sink.error('cook', `Part 2 "${block.name}" / ${name}: labelled "(${mode})" but this meal is in ${isPerMeal ? 'per-meal' : 'daily total'} mode.`);
      }
      const row = table && table.rows.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (!row) {
        sink.error('cook', `Part 2 "${block.name}": "${name}" does not appear in the Part 1 table for this meal.`);
        continue;
      }
      const expectedGrams = isPerMeal ? row.perMealGrams : row.dailyGrams;
      if (Number.isFinite(expectedGrams) && Math.abs(expectedGrams - grams) > TOL.grams) {
        sink.error('cook', `Part 2 "${block.name}" / ${name}: ${grams}g, but Part 1 says ${expectedGrams}g.`);
      }
    }

    for (const ing of expectedMeal.ingredients) {
      const hasSplitInstruction = !!String(ing.split || '').trim();
      const present = listed.includes(ing.name.trim().toLowerCase());
      if (ing.personalOnly) {
        if (present) sink.error('cook', `Part 2 "${block.name}": "${ing.name}" is marked personal-only and must not be sent to the cook.`);
        continue;
      }
      if (hasSplitInstruction && present) {
        sink.error('cook', `Part 2 "${block.name}": "${ing.name}" has a split instruction, so it must appear only as its split, not as an ingredient line.`);
      }
      if (!hasSplitInstruction && !present) {
        sink.error('cook', `Part 2 "${block.name}": "${ing.name}" is missing — the cook would never add it.`);
      }
    }

    const wantsPrep = !!String(expectedMeal.meal.prepMethod || '').trim();
    const hasPrep = block.lines.some((line) => /^prep method/i.test(line));
    if (wantsPrep !== hasPrep) {
      sink.error('cook', `Part 2 "${block.name}": prep method ${hasPrep ? 'is listed but none is configured' : 'is missing'}.`);
    }
  });

  const activeMeals = (config.meals || []).filter((meal) => !meal.disabled);
  const variables = (mapGet(config.dailyVariables, day) || []).filter(
    (ing) => !ing.disabled && activeMeals.some((meal) => meal.id === (ing.mealId || 'meal-chicken'))
  );
  const expectedVariant = getDayVariantName(variables, activeMeals);
  if (plan.cook.heading && plan.cook.heading !== expectedVariant) {
    sink.warn('cook', `Part 2 heading reads "${plan.cook.heading}", expected "${expectedVariant}".`);
  }
  if (/#{1,6}.*splits?\s*(&|and)?\s*(cooking|seasoning)/i.test(plan.part2)) {
    sink.error('cook', 'Part 2 contains a separate splits section — every split must sit inside its owning meal block.');
  }
}

module.exports = {
  verifyPlan,
  computeFeasibility,
  buildReferenceDb,
  parsePlan,
  SODIUM_MG_PER_G_SALT
};
