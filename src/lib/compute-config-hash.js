/**
 * Shared config hash computation logic.
 *
 * Used by:
 *   - src/lib/config-hash.ts  (ES import, for Next.js API routes)
 *   - whatsapp-worker.js      (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const { createHash } = require('crypto');

/**
 * Compute a SHA-256 hash of the diet-relevant configuration fields.
 * This hash is used to detect config changes for cache invalidation.
 *
 * Included fields (changes invalidate cache):
 *   - global (calorie target, olive oil, sodium/potassium ratios)
 *   - meals (definitions, ingredients, weights, prep methods)
 *   - customSplits
 *   - dailyVariables (per-day ingredient overrides)
 *   - dailySplits (per-day split overrides)
 *   - model, customModel, thinkingEnabled, thinkingBudget
 *
 * Excluded fields (changes do NOT invalidate cache):
 *   - apiKey, provider, enterpriseApiKey, etc. (API routing config)
 *   - generationRange, selectedGenerationDay (UI selection only)
 *   - huggingFaceToken, huggingFaceSpace (WhatsApp worker config)
 */
function computeConfigHash(config) {
  // Extract only the diet-relevant fields
  const hashableFields = {
    global: config.global || {},
    meals: (config.meals || []).map((meal) => ({
      id: meal.id,
      name: meal.name,
      mealsPerDay: meal.mealsPerDay,
      ingredients: (meal.ingredients || []).map((ing) => ({
        name: ing.name,
        weight: ing.weight,
        isAuto: ing.isAuto,
        disabled: ing.disabled,
        personalOnly: ing.personalOnly,
        split: ing.split,
        maxGrams: ing.maxGrams,
        minGrams: ing.minGrams,
        mealId: ing.mealId,
      })),
      water: meal.water,
      prepMethod: meal.prepMethod,
      cookQuantityMode: meal.cookQuantityMode,
      totalOliveOil: meal.totalOliveOil,
      oliveOilSplitPercent: meal.oliveOilSplitPercent,
    })),
    customSplits: (config.customSplits || []).map((s) => ({
      id: s.id,
      name: s.name,
      value: s.value,
    })),
    dailyVariables: normalizeDailyMap(config.dailyVariables),
    dailySplits: normalizeDailySplitsMap(config.dailySplits),
    model: config.model || '',
    customModel: config.customModel || '',
    thinkingEnabled: !!config.thinkingEnabled,
    thinkingBudget: config.thinkingBudget || 0,
  };

  const jsonStr = JSON.stringify(hashableFields, Object.keys(hashableFields).sort());
  return createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Normalize dailyVariables which may be a plain object or a Mongoose Map.
 */
function normalizeDailyMap(mapOrObj) {
  if (!mapOrObj) return {};
  const result = {};

  // Handle Mongoose Map
  if (typeof mapOrObj.toJSON === 'function') {
    const plain = mapOrObj.toJSON();
    for (const [key, value] of Object.entries(plain)) {
      result[key] = (value || []).map((ing) => ({
        name: ing.name,
        weight: ing.weight,
        isAuto: ing.isAuto,
        disabled: ing.disabled,
        personalOnly: ing.personalOnly,
        split: ing.split,
        maxGrams: ing.maxGrams,
        minGrams: ing.minGrams,
        mealId: ing.mealId,
      }));
    }
    return result;
  }

  // Handle plain object
  for (const [key, value] of Object.entries(mapOrObj)) {
    result[key] = (value || []).map((ing) => ({
      name: ing.name,
      weight: ing.weight,
      isAuto: ing.isAuto,
      disabled: ing.disabled,
      personalOnly: ing.personalOnly,
      split: ing.split,
      maxGrams: ing.maxGrams,
      minGrams: ing.minGrams,
      mealId: ing.mealId,
    }));
  }
  return result;
}

/**
 * Normalize dailySplits which may be a plain object or a Mongoose Map.
 */
function normalizeDailySplitsMap(mapOrObj) {
  if (!mapOrObj) return {};
  const result = {};

  // Handle Mongoose Map
  if (typeof mapOrObj.toJSON === 'function') {
    const plain = mapOrObj.toJSON();
    for (const [key, value] of Object.entries(plain)) {
      result[key] = (value || []).map((s) => ({
        id: s.id,
        name: s.name,
        value: s.value,
      }));
    }
    return result;
  }

  // Handle plain object
  for (const [key, value] of Object.entries(mapOrObj)) {
    result[key] = (value || []).map((s) => ({
      id: s.id,
      name: s.name,
      value: s.value,
    }));
  }
  return result;
}

// Support both CommonJS and ES module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeConfigHash };
}
