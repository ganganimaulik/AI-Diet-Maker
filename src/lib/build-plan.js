/**
 * Deterministic (no-LLM) diet-plan builder.
 *
 * Solves the `[AUTO]` weights and writes both halves of the plan document
 * without a model in the loop. Every figure it prints is derived from the same
 * reference nutrition table that verify-plan.js re-derives its own numbers
 * from — the solver, the reference lookup and the per-day ingredient grouping
 * are literally the checker's own functions — so a plan produced here is
 * judged by exactly the arithmetic that produced it.
 *
 * What this module deliberately does NOT do: invent nutrition for ingredients
 * the reference table does not price. A model can fall back on "standard USDA
 * values"; arithmetic cannot. Those configs are refused with a message naming
 * the ingredients rather than quietly costing them at zero.
 *
 * Used by:
 *   - src/app/api/generate/route.ts (ES import via build-plan.ts)
 *   - whatsapp-worker.js            (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const { getDayVariantName } = require('./compile-prompt.js');
const {
  buildReferenceDb,
  makeLookup,
  expectedMeals,
  solveWithCalorieBudget,
  SODIUM_MG_PER_G_SALT,
  UNBOUNDED_MAX_G
} = require('./verify-plan.js');

/**
 * Bumped whenever a change here would produce a different plan for the same
 * configuration. Mixed into the config hash for deterministic runs so plans
 * cached by an older builder are regenerated rather than trusted.
 */
const PLAN_BUILDER_VERSION = 1;

/** Decimals allowed on the one weight that may absorb a rounding residual. */
const FALLBACK_GRAM_DECIMALS = 1;

/**
 * Whole-gram weights are preferred; the residual is only allowed to spill into
 * a fractional weight once it would otherwise exceed this many kcal. The
 * checker tolerates 2.01 kcal on the day total, so this leaves headroom.
 */
const MAX_INTEGER_RESIDUAL_KCAL = 1;

const DEFAULT_RATIO_MIN = 0.7;
const DEFAULT_RATIO_MAX = 0.8;

class PlanBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanBuildError';
  }
}

// -------------------------------------------------------------
// NUMBER FORMATTING
// A printed weight and the weight every downstream figure is computed from
// must be the same number, or the plan disagrees with its own arithmetic.
// Everything is therefore snapped to its display precision before use.
// -------------------------------------------------------------

const snap = (value, decimals = 3) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

// Rounding a bound has to move inwards. Rounding a minimum down (or a maximum
// up) produces a weight the checker reads as breaking the bound it came from.
const ceilTo = (value, decimals) => {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor - 1e-6) / factor;
};

const floorTo = (value, decimals) => {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor + 1e-6) / factor;
};

/** Grams exactly as printed: "100", "100.4", "9.55". */
const fmtGrams = (value) => String(snap(value));

/** Macro grams, always one decimal, matching the checker's rounding slack. */
const fmtMacro = (value) => (Math.round(value * 10) / 10).toFixed(1);

const toNumber = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const kcalOf = (ref, grams) => (ref.isSalt ? 0 : grams * ref.kcalPerG);

// -------------------------------------------------------------
// DAY MODEL
// -------------------------------------------------------------

/**
 * Resolve one day's active meals, their ingredients and every ingredient's
 * reference entry. `expectedMeals` is the checker's own grouping, so the meals
 * written here are exactly the meals it will look for.
 */
function buildModel(config, day) {
  const db = buildReferenceDb(config, day);
  const lookup = makeLookup(db);
  const unpriced = [];
  const contradictory = [];
  const duplicated = [];

  const meals = expectedMeals(config, day).map((group) => {
    const mealName = String(group.meal.name || '').trim();
    const perDay = Math.max(1, Math.round(Number(group.meal.mealsPerDay) || 1));

    const items = group.ingredients.map((ing) => {
      const name = String(ing.name || '').trim();
      const ref = lookup(name);
      if (!ref) unpriced.push(`${mealName} / ${name || '(unnamed ingredient)'}`);

      const min = toNumber(ing.minGrams);
      const max = toNumber(ing.maxGrams);
      const fixed = toNumber(ing.weight);
      const lo = Number.isFinite(min) ? Math.max(0, min) : 0;
      const hi = Number.isFinite(max) ? Math.max(lo, max) : UNBOUNDED_MAX_G;
      if (ing.isAuto && Number.isFinite(min) && Number.isFinite(max)) {
        if (min > max) {
          contradictory.push(`${mealName} / ${name}: min ${min}g is above max ${max}g`);
        } else if (ceilTo(lo, 3) > floorTo(hi, 3)) {
          // Narrower than the precision a weight is printed at, so no figure
          // could be written that sits inside it.
          contradictory.push(`${mealName} / ${name}: nothing between ${min}g and ${max}g can be written as a weight`);
        }
      }

      return {
        name,
        ref,
        isAuto: !!ing.isAuto,
        personalOnly: !!ing.personalOnly,
        split: String(ing.split || '').trim(),
        lo,
        hi,
        grams: ing.isAuto ? 0 : (Number.isFinite(fixed) ? snap(fixed) : 0)
      };
    });

    // Two rows sharing a name inside one meal cannot be told apart downstream:
    // the cook would see the same ingredient twice and the checker matches its
    // Part 2 lines back to Part 1 by name. A day variable routed onto a meal
    // that already lists that ingredient lands here too.
    const seen = new Set();
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) duplicated.push(`${mealName} lists "${item.name}" more than once`);
      seen.add(key);
    }

    return {
      name: mealName,
      perDay,
      perMealMode: (group.meal.cookQuantityMode || 'daily') === 'per-meal',
      prepMethod: String(group.meal.prepMethod || '').trim(),
      items
    };
  });

  return { meals, unpriced, contradictory, duplicated };
}

// -------------------------------------------------------------
// SOLVING THE AUTO WEIGHTS
//
// The feasible set is one linear equality (the AUTO weights must close the
// calorie gap exactly) plus box bounds, which is what solveWithCalorieBudget
// optimises over. Sodium and potassium are both linear in those weights, so
// for any target ratio r the expression Na(x) - r*K(x) is linear too: its
// minimum and maximum over the feasible set bracket every ratio the day can
// reach, and any point between them is itself feasible. That turns "steer the
// ratio into the ideal range" into one interpolation rather than a search.
// -------------------------------------------------------------

function collectVars(model) {
  const vars = [];
  let fixedKcal = 0;
  let fixedNa = 0;
  let fixedK = 0;

  for (const meal of model.meals) {
    for (const item of meal.items) {
      const ref = item.ref;
      if (item.isAuto) {
        vars.push({
          item,
          // Salt carries no calories, so the solver cannot move it; it stays
          // at its lower bound exactly as the feasibility check assumes.
          kcalPerG: ref.isSalt ? 0 : ref.kcalPerG,
          na: ref.na / 100,
          k: ref.k / 100,
          lo: item.lo,
          hi: item.hi
        });
      } else {
        fixedKcal += kcalOf(ref, item.grams);
        fixedNa += ref.isSalt
          ? item.grams * SODIUM_MG_PER_G_SALT
          : (item.grams * ref.na) / 100;
        fixedK += (item.grams * ref.k) / 100;
      }
    }
  }

  return { vars, fixedKcal, fixedNa, fixedK };
}

function linearValue(vars, x, fixedNa, fixedK, ratio) {
  let total = fixedNa - ratio * fixedK;
  for (let i = 0; i < vars.length; i++) {
    total += (vars[i].na - ratio * vars[i].k) * x[i];
  }
  return total;
}

/**
 * A feasible mix whose Na:K ratio is exactly `ratio`, or the feasible mix
 * closest to it when the day cannot reach that ratio at all.
 */
function solveForRatio(vars, budget, fixedNa, fixedK, ratio) {
  const weights = vars.map((v) => v.na - ratio * v.k);
  const lowPoint = solveWithCalorieBudget(vars, weights, budget);
  const highPoint = solveWithCalorieBudget(vars, weights.map((w) => -w), budget);
  if (!lowPoint || !highPoint) return null;

  const low = linearValue(vars, lowPoint, fixedNa, fixedK, ratio);
  const high = linearValue(vars, highPoint, fixedNa, fixedK, ratio);

  if (low > 1e-9) return { x: lowPoint, reached: false, side: 'above' };
  if (high < -1e-9) return { x: highPoint, reached: false, side: 'below' };

  const span = high - low;
  const t = span > 1e-12 ? -low / span : 0;
  return {
    x: lowPoint.map((value, i) => value + t * (highPoint[i] - value)),
    reached: true,
    side: 'exact'
  };
}

/** The lowest (or highest) Na:K ratio this day can reach at the calorie target. */
function extremeRatioPoint(vars, budget, fixedNa, fixedK, direction) {
  let lo = 0;
  let hi = 5;
  for (let iteration = 0; iteration < 80; iteration++) {
    const mid = (lo + hi) / 2;
    const attempt = solveForRatio(vars, budget, fixedNa, fixedK, mid);
    if (!attempt) return null;
    if (direction === 'min') {
      if (attempt.side === 'above') lo = mid;
      else hi = mid;
    } else if (attempt.side === 'below') hi = mid;
    else lo = mid;
  }

  const ratio = direction === 'min' ? hi : lo;
  const point = solveForRatio(vars, budget, fixedNa, fixedK, ratio);
  return point ? { x: point.x, ratio } : null;
}

/**
 * Spread the remaining calories evenly across the AUTO ingredients, letting
 * anything that hits a min/max bound stop there and re-sharing what is left
 * among the rest. This is the prompt's own default whenever the Na:K band does
 * not need steering: an even split keeps the day's food varied, where chasing
 * a ratio the day cannot reach would pile every calorie onto one ingredient
 * for a hundredth of a point.
 */
function equalCalorieSplit(vars, budget) {
  const movable = vars.map((v) => v.kcalPerG > 0);
  const loKcal = vars.map((v, i) => (movable[i] ? v.lo * v.kcalPerG : 0));
  const hiKcal = vars.map((v, i) => (movable[i] ? v.hi * v.kcalPerG : 0));

  const filled = (share) => vars.reduce(
    (sum, v, i) => (movable[i] ? sum + Math.min(hiKcal[i], Math.max(loKcal[i], share)) : sum),
    0
  );

  const ceiling = Math.max(0, ...hiKcal);
  if (filled(0) > budget + 1e-6 || filled(ceiling) < budget - 1e-6) return null;

  let lo = 0;
  let hi = ceiling;
  for (let iteration = 0; iteration < 200; iteration++) {
    const mid = (lo + hi) / 2;
    if (filled(mid) < budget) lo = mid;
    else hi = mid;
  }

  const share = (lo + hi) / 2;
  return vars.map((v, i) => (
    movable[i] ? Math.min(hiKcal[i], Math.max(loKcal[i], share)) / v.kcalPerG : v.lo
  ));
}

/**
 * Round the continuous solution onto whole grams and repair the drift.
 *
 * Each ±1 g step moves the day total by that ingredient's calorie density, so
 * the residual an integer solution can leave is bounded by the smallest such
 * density with headroom. When even that overshoots the day tolerance, one
 * weight — the cheapest per gram, so the fractional part stays small — takes
 * a single decimal rather than the plan quietly missing its target.
 */
function integerize(vars, x, budget, fixedNa, fixedK, desiredRatio, band) {
  const bounds = vars.map((v, i) => {
    // An ingredient the continuous solve actually asked for keeps at least a
    // gram: rounding it away to shave a fraction of a kcal would put "0g" in
    // front of the cook.
    const wholeLo = Math.max(Math.ceil(v.lo - 1e-9), x[i] >= 0.5 ? 1 : 0);
    const wholeHi = Math.floor(v.hi + 1e-9);
    return {
      // False for a band like min 50.2 / max 50.8, which holds no whole gram.
      whole: wholeLo <= wholeHi,
      lo: wholeLo,
      hi: wholeHi,
      fineLo: ceilTo(v.lo, FALLBACK_GRAM_DECIMALS),
      fineHi: floorTo(v.hi, FALLBACK_GRAM_DECIMALS),
      exactLo: ceilTo(v.lo, 3),
      exactHi: floorTo(v.hi, 3)
    };
  });

  const w = x.map((value, i) => {
    const bound = bounds[i];
    if (bound.whole) return Math.min(bound.hi, Math.max(bound.lo, Math.round(value)));
    return Math.min(bound.exactHi, Math.max(bound.exactLo, snap(value, 3)));
  });

  const errorOf = () => vars.reduce((sum, v, i) => sum + v.kcalPerG * w[i], 0) - budget;
  const sodiumOf = () => fixedNa + vars.reduce((sum, v, i) => sum + v.na * w[i], 0);
  const potassiumOf = () => fixedK + vars.reduce((sum, v, i) => sum + v.k * w[i], 0);
  const ratioOf = () => {
    const potassium = potassiumOf();
    return potassium > 0 ? sodiumOf() / potassium : NaN;
  };
  const ratioGapOf = () => {
    const ratio = ratioOf();
    return Number.isFinite(ratio) ? Math.abs(ratio - desiredRatio) : 0;
  };

  // Whole-gram repair: walk the calorie error down one gram at a time.
  for (let iteration = 0; iteration < 5000; iteration++) {
    const error = errorOf();
    if (Math.abs(error) < 1e-9) break;

    let best = null;
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      if (!(v.kcalPerG > 0) || !bounds[i].whole) continue;

      for (const step of [-1, 1]) {
        const next = w[i] + step;
        if (next < bounds[i].lo - 1e-9 || next > bounds[i].hi + 1e-9) continue;
        const nextError = Math.abs(error + step * v.kcalPerG);
        if (nextError >= Math.abs(error) - 1e-9) continue;

        const previous = w[i];
        w[i] = next;
        const gap = ratioGapOf();
        w[i] = previous;

        if (!best || nextError < best.error - 1e-9
          || (Math.abs(nextError - best.error) <= 1e-9 && gap < best.gap)) {
          best = { index: i, step, error: nextError, gap };
        }
      }
    }

    if (!best) break;
    w[best.index] += best.step;
  }

  // Rounding can nudge a ratio that was inside the ideal band back out of it.
  // Walk it back in with single-gram moves that keep the calorie total inside
  // the tolerance the whole plan is judged against.
  if (band) {
    const distance = (ratio) => (Number.isFinite(ratio)
      ? Math.max(0, band.min - ratio, ratio - band.max)
      : Infinity);
    const kcalCeiling = Math.max(Math.abs(errorOf()), MAX_INTEGER_RESIDUAL_KCAL);

    for (let iteration = 0; iteration < 500; iteration++) {
      const gap = distance(ratioOf());
      if (gap <= 0) break;

      let best = null;
      for (let i = 0; i < vars.length; i++) {
        if (!bounds[i].whole) continue;
        for (const step of [-1, 1]) {
          const next = w[i] + step;
          if (next < bounds[i].lo - 1e-9 || next > bounds[i].hi + 1e-9) continue;

          const previous = w[i];
          w[i] = next;
          const nextGap = distance(ratioOf());
          const nextError = Math.abs(errorOf());
          w[i] = previous;

          if (nextError > kcalCeiling + 1e-9) continue;
          if (nextGap >= gap - 1e-12) continue;
          if (!best || nextGap < best.gap - 1e-12
            || (Math.abs(nextGap - best.gap) <= 1e-12 && nextError < best.error)) {
            best = { index: i, step, gap: nextGap, error: nextError };
          }
        }
      }

      if (!best) break;
      w[best.index] += best.step;
    }
  }

  // Whole grams cannot always land on the target — a day whose only AUTO
  // ingredient is olive oil moves in 8.84 kcal steps, and a fractional minimum
  // leaves the whole-gram floor above the weight the solve actually wanted.
  // Let weights take a single decimal, one at a time, until the residual is
  // inside the tolerance. Each candidate is rounded INTO its own bounds, so
  // this can never buy calorie accuracy by breaking a min or a max.
  for (let pass = 0; pass < vars.length * 2 + 4; pass++) {
    const residual = errorOf();
    if (Math.abs(residual) <= MAX_INTEGER_RESIDUAL_KCAL) break;

    let best = null;
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      const bound = bounds[i];
      if (!(v.kcalPerG > 0) || bound.fineLo > bound.fineHi) continue;

      const candidate = Math.min(
        bound.fineHi,
        Math.max(bound.fineLo, snap(w[i] - residual / v.kcalPerG, FALLBACK_GRAM_DECIMALS))
      );
      const nextError = Math.abs(residual + (candidate - w[i]) * v.kcalPerG);
      if (nextError >= Math.abs(residual) - 1e-9) continue;
      if (!best || nextError < best.error) best = { index: i, value: candidate, error: nextError };
    }

    if (!best) break;
    w[best.index] = best.value;
  }

  return w;
}

/**
 * Assign every AUTO weight for the day. Returns what actually happened so the
 * derivation log and the plan's own notes can say it out loud.
 */
function solveAutoWeights(model, target, ratioMin, ratioMax) {
  const { vars, fixedKcal, fixedNa, fixedK } = collectVars(model);
  const budget = target - fixedKcal;
  const desiredRatio = (ratioMin + ratioMax) / 2;

  const outcome = {
    autoCount: vars.length,
    fixedKcal,
    budget,
    calorieTargetReachable: true,
    ratioReachable: true,
    strategy: 'even-split',
    desiredRatio,
    plannedRatio: null
  };

  if (vars.length === 0) {
    outcome.calorieTargetReachable = Math.abs(budget) <= 2;
    return outcome;
  }

  const ratioOf = (x) => {
    const potassium = fixedK + vars.reduce((sum, v, i) => sum + v.k * x[i], 0);
    if (!(potassium > 0)) return NaN;
    return (fixedNa + vars.reduce((sum, v, i) => sum + v.na * x[i], 0)) / potassium;
  };

  let x = null;
  const feasible = solveWithCalorieBudget(vars, vars.map(() => 0), budget);
  if (!feasible) {
    // No mix of the day's AUTO ingredients can close the calorie gap. Sit at
    // whichever boundary lands closest rather than pretending otherwise.
    outcome.calorieTargetReachable = false;
    outcome.strategy = 'calorie-boundary';
    const minKcal = vars.reduce((sum, v) => sum + v.lo * v.kcalPerG, 0);
    x = budget < minKcal ? vars.map((v) => v.lo) : vars.map((v) => v.hi);
  } else {
    const even = equalCalorieSplit(vars, budget) || feasible;
    const evenRatio = ratioOf(even);
    x = even;

    if (Number.isFinite(evenRatio) && (evenRatio < ratioMin - 1e-9 || evenRatio > ratioMax + 1e-9)) {
      // Aim just inside the near edge rather than at the middle of the band:
      // it is the smallest departure from the even split that still lands in
      // range, with enough margin to survive whole-gram rounding.
      // Aim at the middle of a narrow band so whole-gram rounding cannot push
      // the result back out of it, and only hug the near edge once the band is
      // wide enough that the middle would distort the split for nothing.
      const margin = Math.min(0.005, (ratioMax - ratioMin) / 2);
      const goal = Math.min(ratioMax - margin, Math.max(ratioMin + margin, evenRatio));
      outcome.desiredRatio = goal;
      const attempt = solveForRatio(vars, budget, fixedNa, fixedK, goal);
      if (attempt && attempt.reached) {
        outcome.strategy = 'ratio-steered';
        x = attempt.x;
      } else {
        // The band is out of reach for this day. Land on the closest ratio the
        // ingredients can produce rather than on an even split that abandons
        // the target entirely — the same thing the retry prompt tells the
        // model to do when it hits this case. The plan says so in as many
        // words, and prints the ratio these weights actually give.
        outcome.ratioReachable = false;
        outcome.strategy = 'closest-ratio';
        const extreme = attempt
          ? extremeRatioPoint(vars, budget, fixedNa, fixedK, attempt.side === 'above' ? 'min' : 'max')
          : null;
        if (extreme) {
          x = extreme.x;
          outcome.desiredRatio = extreme.ratio;
        }
      }
    }
  }

  // Anchor the whole-gram repair on the ratio the continuous solution actually
  // produced, so rounding preserves the mix that was chosen rather than
  // drifting back toward a goal that was already ruled out.
  const anchorRatio = Number.isFinite(ratioOf(x)) ? ratioOf(x) : desiredRatio;
  const w = integerize(
    vars,
    x,
    budget,
    fixedNa,
    fixedK,
    anchorRatio,
    outcome.ratioReachable ? { min: ratioMin, max: ratioMax } : null
  );
  vars.forEach((v, i) => {
    v.item.grams = snap(w[i]);
  });

  const sodium = fixedNa + vars.reduce((sum, v, i) => sum + v.na * w[i], 0);
  const potassium = fixedK + vars.reduce((sum, v, i) => sum + v.k * w[i], 0);
  outcome.plannedRatio = potassium > 0 ? sodium / potassium : null;
  return outcome;
}

// -------------------------------------------------------------
// TOTALS
// -------------------------------------------------------------

/**
 * Every number the plan prints, derived once from the solved weights. Salt is
 * accounted the way the checker accounts it: no calories, no natural sodium,
 * its whole weight converted at 388 mg of sodium per gram.
 */
function computeTotals(model) {
  const day = {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    naturalSodium: 0,
    potassium: 0,
    saltGrams: 0
  };

  for (const meal of model.meals) {
    meal.rows = meal.items.map((item) => {
      const ref = item.ref;
      const daily = item.grams;
      const exactPerMeal = daily / meal.perDay;
      const perMealGrams = meal.perDay <= 1 ? snap(daily) : Math.round(exactPerMeal);

      const row = {
        item,
        daily,
        perMealGrams,
        kcal: kcalOf(ref, exactPerMeal),
        protein: (exactPerMeal * ref.p) / 100,
        carbs: (exactPerMeal * ref.c) / 100,
        fat: (exactPerMeal * ref.f) / 100
      };

      day.kcal += kcalOf(ref, daily);
      day.protein += (daily * ref.p) / 100;
      day.carbs += (daily * ref.c) / 100;
      day.fat += (daily * ref.f) / 100;
      if (ref.isSalt) {
        day.saltGrams += daily;
      } else {
        day.naturalSodium += (daily * ref.na) / 100;
        day.potassium += (daily * ref.k) / 100;
      }

      return row;
    });

    meal.perMealTotals = meal.rows.reduce((totals, row) => ({
      kcal: totals.kcal + row.kcal,
      protein: totals.protein + row.protein,
      carbs: totals.carbs + row.carbs,
      fat: totals.fat + row.fat
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

    meal.dailyKcal = meal.rows.reduce(
      (sum, row) => sum + kcalOf(row.item.ref, row.daily),
      0
    );
  }

  day.saltSodium = day.saltGrams * SODIUM_MG_PER_G_SALT;
  day.sodium = day.saltSodium + day.naturalSodium;
  day.ratio = day.potassium > 0 ? day.sodium / day.potassium : NaN;
  return day;
}

// -------------------------------------------------------------
// SPLIT INSTRUCTIONS
// -------------------------------------------------------------

const REMAINDER_WORDS = /^(?:the\s+)?(?:remaining|remainder|rest|balance)\b/i;

/**
 * Turn a split instruction into explicit grams: "50% in subji, remaining in
 * chicken" against 10 g becomes "5g in subji, 5g in chicken". Anything that
 * cannot be resolved is passed through with the total attached rather than
 * dropped, because the cook still needs to see it.
 */
function resolveSplit(splitText, totalGrams) {
  const raw = String(splitText || '').trim();
  if (!raw) return '';

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  const resolved = [];
  let assigned = 0;
  let openCount = 0;

  for (const part of parts) {
    const percent = part.match(/^(\d+(?:\.\d+)?)\s*%\s*(.*)$/);
    if (percent) {
      const grams = (parseFloat(percent[1]) / 100) * totalGrams;
      resolved.push({ grams, label: percent[2].trim() });
      assigned += grams;
      continue;
    }

    const explicit = part.match(/^(\d+(?:\.\d+)?)\s*g\b\s*(.*)$/i);
    if (explicit) {
      const grams = parseFloat(explicit[1]);
      resolved.push({ grams, label: explicit[2].trim() });
      assigned += grams;
      continue;
    }

    resolved.push({ grams: null, label: part.replace(REMAINDER_WORDS, '').trim() || part });
    openCount++;
  }

  if (openCount > 0) {
    const leftover = Math.max(0, totalGrams - assigned) / openCount;
    for (const entry of resolved) {
      if (entry.grams === null) entry.grams = leftover;
    }
  }

  const text = resolved
    .map((entry) => `${fmtGrams(entry.grams)}g${entry.label ? ` ${entry.label}` : ''}`)
    .join(', ');

  // Never end on a colon: Part 2 reads a trailing-colon line as a meal block.
  return text.replace(/:\s*$/, '');
}

// -------------------------------------------------------------
// RENDERING
// -------------------------------------------------------------

function ratioVerdict(ratio, ratioMin, ratioMax) {
  if (!Number.isFinite(ratio)) return 'Unknown';
  if (ratio >= ratioMin - 1e-9 && ratio <= ratioMax + 1e-9) return 'Ideal';
  return ratio < ratioMin ? 'Below Ideal' : 'Above Ideal';
}

function ratioAdvice(day, ratioMin, ratioMax, statedSodium, statedPotassium) {
  const minText = ratioMin.toFixed(2);
  const maxText = ratioMax.toFixed(2);
  const verdict = ratioVerdict(day.ratio, ratioMin, ratioMax);

  if (verdict === 'Ideal' || !Number.isFinite(day.ratio)) {
    return `Ratio is in the ideal range (${minText} - ${maxText}).`;
  }

  // Derived from the rounded figures the plan prints, so the advice agrees
  // with the numbers a reader can check it against.
  if (verdict === 'Below Ideal') {
    const extraSodium = Math.round(ratioMin * statedPotassium - statedSodium);
    const extraSalt = (extraSodium / SODIUM_MG_PER_G_SALT).toFixed(2);
    return `Ratio is below ideal. Need an additional **${extraSodium}** mg of Sodium `
      + `(approx. **${extraSalt}** g of table salt) to reach ${minText}.`;
  }

  // Reaching a ratio of zero would take unbounded potassium, and the field
  // accepts a zero (clearing it in Global Targets stores 0), so an unreachable
  // bound is said to be unreachable rather than printed as "Infinity mg".
  // The wording is otherwise fixed: checkRatioAdvice re-derives these figures
  // by matching this exact sentence, and a rephrasing would silently retire
  // that check instead of failing it.
  if (!(ratioMax > 0)) {
    return `Ratio is above ideal, but a target of ${maxText} cannot be reached by adding potassium. `
      + 'Set a sodium:potassium range above zero in Global Targets.';
  }

  const toMax = Math.round(statedSodium / ratioMax - statedPotassium);
  if (!(ratioMin > 0) || ratioMin === ratioMax) {
    return `Ratio is above ideal. Need an additional **${toMax}** mg of Potassium to reach ${maxText}.`;
  }

  const toMin = Math.round(statedSodium / ratioMin - statedPotassium);
  return `Ratio is above ideal. Need an additional **${toMax}** mg of Potassium `
    + `to reach ${maxText} (or **${toMin}** mg to reach ${minText}).`;
}

function renderMealTable(meal, index) {
  const mealsWord = `${meal.perDay} Meal${meal.perDay > 1 ? 's' : ''}`;
  const lines = [
    `${index + 1}. ${meal.name} (${mealsWord} Per Day)`,
    '',
    `| Ingredient | Weight Per Meal | Daily Total (${mealsWord}) | Calories (Per Meal) | Protein (Per Meal) | Carbs (Per Meal) | Fat (Per Meal) |`,
    '|---|---:|---:|---:|---:|---:|---:|'
  ];

  for (const row of meal.rows) {
    const protein = fmtMacro(row.protein);
    const carbs = fmtMacro(row.carbs);
    const fat = fmtMacro(row.fat);
    lines.push(
      `| ${row.item.name} | ${fmtGrams(row.perMealGrams)}g | ${fmtGrams(row.daily)}g | `
      + `${Math.round(row.kcal)} kcal | `
      + `${protein}g (${Math.round(parseFloat(protein) * 4)} kcal) | `
      + `${carbs}g (${Math.round(parseFloat(carbs) * 4)} kcal) | `
      + `${fat}g (${Math.round(parseFloat(fat) * 9)} kcal) |`
    );
  }

  const totals = meal.perMealTotals;
  const totalProtein = fmtMacro(totals.protein);
  const totalCarbs = fmtMacro(totals.carbs);
  const totalFat = fmtMacro(totals.fat);
  lines.push(
    `| **Total** |  |  | **${Math.round(totals.kcal)} kcal** | `
    + `**${totalProtein}g (${Math.round(parseFloat(totalProtein) * 4)} kcal)** | `
    + `**${totalCarbs}g (${Math.round(parseFloat(totalCarbs) * 4)} kcal)** | `
    + `**${totalFat}g (${Math.round(parseFloat(totalFat) * 9)} kcal)** |`
  );

  const splits = meal.rows
    .filter((row) => row.item.split)
    .map((row) => {
      const base = meal.perMealMode ? row.perMealGrams : row.daily;
      const text = resolveSplit(row.item.split, base);
      return text ? `${row.item.name} — ${text}` : '';
    })
    .filter(Boolean);

  if (splits.length > 0) {
    lines.push('', `Splits (${meal.perMealMode ? 'per meal' : 'daily total'}): ${splits.join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * Whole milligrams for the ordinary case, more precision when they would stop
 * reproducing the ratio.
 *
 * The checker cross-examines a plan against itself: the ratio it prints must
 * match its own printed sodium ÷ potassium, and also the exact ratio, both
 * inside 0.006. Rounding both minerals to whole mg moves that quotient by
 * roughly (1 + ratio) / (2 * potassium), which is nothing at this diet's
 * ~0.8 ratio and thousands of mg of potassium — but grows with the ratio and
 * shrinks with potassium, and does breach the window at the extremes.
 */
function mineralDecimals(sodium, potassium, ratio) {
  for (let decimals = 0; decimals < 3; decimals++) {
    const na = snap(sodium, decimals);
    const k = snap(potassium, decimals);
    if (k > 0 && Math.abs(na / k - ratio) <= 0.0005) return decimals;
  }
  return 3;
}

function renderPart1(model, day, totals, target, ratioMin, ratioMax, outcome) {
  const decimals = mineralDecimals(totals.sodium, totals.potassium, totals.ratio);
  const statedSodium = snap(totals.sodium, decimals);
  const statedPotassium = snap(totals.potassium, decimals);
  const verdict = ratioVerdict(totals.ratio, ratioMin, ratioMax);
  // Derived from the printed minerals, so the plan agrees with its own numbers.
  const ratioText = statedPotassium > 0
    ? (statedSodium / statedPotassium).toFixed(2)
    : 'n/a';

  const protein = fmtMacro(totals.protein);
  const carbs = fmtMacro(totals.carbs);
  const fat = fmtMacro(totals.fat);
  const proteinKcal = Math.round(parseFloat(protein) * 4);
  const carbsKcal = Math.round(parseFloat(carbs) * 4);
  const fatKcal = Math.round(parseFloat(fat) * 9);

  const lines = [
    '### Daily Sodium & Potassium Summary',
    `For the day (${day}):`,
    `- **${day}**: Total Sodium: **${statedSodium} mg** | Total Potassium: **${statedPotassium} mg** `
      + `| Na:K Ratio: **${ratioText}** (${verdict})`,
    `  * Includes **${snap(totals.saltSodium, decimals)} mg** sodium from consumed salt and `
      + `**${snap(totals.naturalSodium, decimals)} mg** natural sodium, from `
      + `**${fmtGrams(snap(totals.saltGrams, 2))} g** of table salt across all meals counted in full. `
      + 'Total potassium is from natural ingredients.',
    `  * **Ratio Adjustment Info**: ${ratioAdvice(totals, ratioMin, ratioMax, statedSodium, statedPotassium)}`
  ];

  if (!outcome.calorieTargetReachable) {
    lines.push(
      `  * **Energy note**: the configured limits on this day's ingredients cannot close the `
      + `${target} kcal goal — **${Math.round(totals.kcal)} kcal** is the closest reachable figure. `
      + 'Widen an AUTO ingredient\'s min/max or add an ingredient to close the gap.'
    );
  } else if (verdict !== 'Ideal') {
    // Driven by the ratio these weights actually produce, not by what the
    // solver set out to do: whole-gram rounding moves the result, and a note
    // saying the band was missed above a ratio the plan itself calls Ideal
    // would be the plan contradicting itself.
    lines.push(
      outcome.ratioReachable
        ? `  * **Ratio note**: rounding the weights to whole grams left the ratio just outside the `
          + `${ratioMin.toFixed(2)}–${ratioMax.toFixed(2)} band; the figure above is the one these `
          + 'weights actually produce.'
        : `  * **Ratio note**: no mix of this day's ingredients reaches the ${ratioMin.toFixed(2)}–`
          + `${ratioMax.toFixed(2)} band at the calorie goal. The weights below get as close as the `
          + 'configured min/max bounds allow, and the ratio above is the one they actually produce.'
    );
  }

  lines.push('');
  model.meals.forEach((meal, index) => {
    lines.push(renderMealTable(meal, index), '');
  });

  const perMealCalories = model.meals
    .map((meal) => `${meal.name}: **${Math.round(meal.dailyKcal)} kcal**`)
    .join(' | ');

  lines.push(
    'Daily Totals (Summary)',
    `- **${day} meal calories**: ${perMealCalories}`,
    `- **Total Daily Calories**: **${Math.round(totals.kcal)} kcal** (Target: **${target} kcal**)`,
    `- **Total Daily Protein**: **${protein}g (${proteinKcal} kcal)**`,
    `- **Total Daily Carbohydrates**: **${carbs}g (${carbsKcal} kcal)**`,
    `- **Total Daily Fat**: **${fat}g (${fatKcal} kcal)**`,
    // Deliberately not labelled a "macro calorie check": for real foods the
    // macro grams in the reference table do not re-sum to its listed calories,
    // so this is reported as what it is rather than forced onto the target.
    `- **Macro energy total**: ${proteinKcal} + ${carbsKcal} + ${fatKcal} = `
      + `**${proteinKcal + carbsKcal + fatKcal} kcal**`
  );

  return lines.join('\n');
}

function renderPart2(config, model, day) {
  const activeMeals = (config.meals || []).filter((meal) => !meal.disabled);
  const variables = (mapGet(config.dailyVariables, day) || []).filter(
    (ing) => !ing.disabled && activeMeals.some((meal) => meal.id === (ing.mealId || 'meal-chicken'))
  );

  const variant = getDayVariantName(variables, activeMeals);

  // The checker finds Part 2 by the first "### DAY:" line that mentions neither
  // sodium nor potassium — a guard against splitting on the Na:K summary. An
  // ingredient named for either mineral would therefore hide the whole cook
  // plan behind that guard, so a bare heading goes first to mark the split and
  // the named one follows to carry the variant.
  const lines = ['---'];
  if (/sodium|potassium/i.test(variant)) lines.push(`### ${day}:`);
  lines.push(`### ${day}: ${variant}`, '');

  for (const meal of model.meals) {
    const mode = meal.perMealMode ? 'per meal' : 'daily total';
    lines.push(meal.perMealMode ? `${meal.name} (x${meal.perDay} daily):` : `${meal.name}:`);

    for (const row of meal.rows) {
      // Personal-only items never reach the cook; split items appear only as
      // their split, so the cook cannot add the same thing twice.
      if (row.item.personalOnly || row.item.split) continue;
      const grams = meal.perMealMode ? row.perMealGrams : row.daily;
      lines.push(`${row.item.name} ${fmtGrams(grams)}g (${mode})`);
    }

    for (const row of meal.rows) {
      if (row.item.personalOnly || !row.item.split) continue;
      const base = meal.perMealMode ? row.perMealGrams : row.daily;
      const text = resolveSplit(row.item.split, base);
      if (text) lines.push(`${row.item.name}: ${text}`);
    }

    if (meal.prepMethod) {
      // Collapsed onto one line: a wrapped prep step ending in a colon would
      // otherwise read as the start of another meal block.
      const prep = meal.prepMethod
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' — ');
      if (prep) lines.push(`prep method: ${prep}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

// -------------------------------------------------------------
// DERIVATION LOG
// -------------------------------------------------------------

function renderDerivation(model, day, totals, target, ratioMin, ratioMax, outcome) {
  const lines = [
    `Deterministic plan build for ${day} (no model was called).`,
    '',
    `Calorie target: ${target} kcal`,
    `Fixed-weight ingredients: ${Math.round(outcome.fixedKcal)} kcal`,
    `Budget left for the ${outcome.autoCount} [AUTO] ingredient(s): ${Math.round(outcome.budget)} kcal`,
    `Na:K goal: ${ratioMin.toFixed(2)}–${ratioMax.toFixed(2)} (aiming at ${outcome.desiredRatio.toFixed(3)})`,
    ''
  ];

  lines.push(`Allocation strategy: ${outcome.strategy}`, '');
  if (!outcome.calorieTargetReachable) {
    lines.push('The calorie target is out of reach with the configured min/max bounds; the closest feasible mix was used.', '');
  } else if (!outcome.ratioReachable) {
    lines.push(
      `The Na:K band is out of reach at this calorie target; the closest reachable ratio was used instead`
      + ` (landing on ${Number.isFinite(totals.ratio) ? totals.ratio.toFixed(3) : 'n/a'}).`,
      ''
    );
  } else if (outcome.strategy === 'ratio-steered') {
    lines.push(`An even calorie split fell outside the Na:K band, so the split was shifted to land on ${outcome.desiredRatio.toFixed(3)}.`, '');
  }

  lines.push('Solved weights:');
  for (const meal of model.meals) {
    for (const row of meal.rows) {
      if (!row.item.isAuto) continue;
      const bounds = [];
      if (row.item.lo > 0) bounds.push(`min ${row.item.lo}g`);
      if (row.item.hi < UNBOUNDED_MAX_G) bounds.push(`max ${row.item.hi}g`);
      lines.push(
        `  ${meal.name} / ${row.item.name}: ${fmtGrams(row.daily)}g`
        + `${bounds.length ? ` (${bounds.join(', ')})` : ''}`
        + ` = ${Math.round(kcalOf(row.item.ref, row.daily))} kcal`
      );
    }
  }

  lines.push(
    '',
    'Resulting day:',
    `  Calories: ${Math.round(totals.kcal)} kcal (target ${target}, off by ${(totals.kcal - target).toFixed(2)})`,
    `  Protein: ${fmtMacro(totals.protein)}g | Carbs: ${fmtMacro(totals.carbs)}g | Fat: ${fmtMacro(totals.fat)}g`,
    `  Sodium: ${Math.round(totals.sodium)} mg (${Math.round(totals.saltSodium)} mg from ${snap(totals.saltGrams, 2)}g salt)`,
    `  Potassium: ${Math.round(totals.potassium)} mg`,
    `  Na:K ratio: ${Number.isFinite(totals.ratio) ? totals.ratio.toFixed(3) : 'n/a'}`
      + ` (${ratioVerdict(totals.ratio, ratioMin, ratioMax)})`
  );

  return lines.join('\n');
}

// -------------------------------------------------------------
// ENTRY POINT
// -------------------------------------------------------------

/**
 * Build one day's plan document without calling a model.
 *
 * @param {object} config – Config document (plain object or Mongoose doc)
 * @param {string} day    – 'MONDAY' … 'SUNDAY'
 * @returns {{ text: string, thinking: string, totals: object, outcome: object }}
 * @throws {PlanBuildError} when the config cannot be solved deterministically
 */
function buildPlan(config, day) {
  const dayKey = String(day || '').toUpperCase();
  if (!dayKey) throw new PlanBuildError('A day is required to build a plan.');

  const target = Number(config?.global?.dailyCalorieTarget) || 0;
  if (!(target > 0)) {
    throw new PlanBuildError('Set a daily calorie target before generating without a model.');
  }

  const ratioMin = config?.global?.idealSodiumPotassiumRatioMin ?? DEFAULT_RATIO_MIN;
  const ratioMax = config?.global?.idealSodiumPotassiumRatioMax ?? DEFAULT_RATIO_MAX;

  const model = buildModel(config, dayKey);
  if (model.meals.length === 0) {
    throw new PlanBuildError('No active meals are configured, so there is nothing to plan.');
  }
  if (model.duplicated.length > 0) {
    throw new PlanBuildError(
      'A meal cannot list the same ingredient twice — the cook plan has no way to '
      + `tell the two apart: ${[...new Set(model.duplicated)].join('; ')}. `
      + 'Merge them into one row, or check whether a daily variable duplicates a meal ingredient.'
    );
  }
  if (model.contradictory.length > 0) {
    throw new PlanBuildError(
      'No weight can satisfy these [AUTO] bounds, so this day cannot be solved: '
      + `${model.contradictory.join('; ')}.`
    );
  }
  if (model.unpriced.length > 0) {
    const listed = model.unpriced.slice(0, 8).join(', ');
    const more = model.unpriced.length > 8 ? ` (+${model.unpriced.length - 8} more)` : '';
    throw new PlanBuildError(
      `Generating without a model needs every ingredient in the reference nutrition table, `
      + `and these are not in it: ${listed}${more}. Rename them to a listed ingredient, or `
      + `generate this day with the AI provider instead.`
    );
  }

  const outcome = solveAutoWeights(model, target, ratioMin, ratioMax);
  const totals = computeTotals(model);

  const text = `${renderPart1(model, dayKey, totals, target, ratioMin, ratioMax, outcome)}\n\n`
    + `${renderPart2(config, model, dayKey)}\n`;

  return {
    text,
    thinking: renderDerivation(model, dayKey, totals, target, ratioMin, ratioMax, outcome),
    totals,
    outcome
  };
}

module.exports = {
  PLAN_BUILDER_VERSION,
  PlanBuildError,
  buildPlan,
  resolveSplit
};
