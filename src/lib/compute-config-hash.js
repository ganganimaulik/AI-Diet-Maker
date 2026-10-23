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
const { PROMPT_TEMPLATE_VERSION } = require('./compile-prompt.js');
const { PLAN_BUILDER_VERSION } = require('./build-plan.js');

/**
 * Compute a SHA-256 hash of the configuration that feeds ONE day's prompt.
 * This hash is used to detect config changes for cache invalidation.
 *
 * The hash is per day on purpose: a day's prompt is compiled from the shared
 * config plus only that day's overrides, so editing Sunday's ingredients must
 * not invalidate Monday's cached plan.
 *
 * Included fields (changes invalidate that day's cache):
 *   - global (calorie target and sodium/potassium ratios)
 *   - meals (definitions, ingredients, weights, prep methods)  [all days]
 *   - dailyVariables[day] (that day's ingredient overrides only)
 *   - provider, model, customModel, thinkingLevel
 *   - maxTokens, reasoningEffort (only once moved off their defaults, so
 *     existing caches are not invalidated by simply adding the settings)
 *   - generationEngine + PLAN_BUILDER_VERSION (deterministic runs only, so a
 *     model-written plan and a computed one never share a cache entry)
 *   - PROMPT_TEMPLATE_VERSION (bumped when the prompt template itself changes)
 *
 * Excluded fields (changes do NOT invalidate cache):
 *   - apiKey, enterpriseApiKey, etc. (credentials only)
 *   - other days' dailyVariables
 *   - generationRange, selectedGenerationDay (UI selection only)
 *   - huggingFaceToken, huggingFaceSpace (WhatsApp worker config)
 *
 * @param {object} config – Config object (plain object or Mongoose doc)
 * @param {string} day    – Day the cached response belongs to, e.g. 'MONDAY'
 */
function computeConfigHash(config, day) {
  if (!day) {
    throw new Error('computeConfigHash requires a day — cache hashes are per day.');
  }
  const dayKey = String(day).toUpperCase();

  // Extract only the diet-relevant fields
  const hashableFields = {
    global: {
      dailyCalorieTarget: config.global?.dailyCalorieTarget,
      idealSodiumPotassiumRatioMin: config.global?.idealSodiumPotassiumRatioMin,
      idealSodiumPotassiumRatioMax: config.global?.idealSodiumPotassiumRatioMax,
    },
    meals: (config.meals || []).map((meal) => ({
      id: meal.id,
      name: meal.name,
      mealsPerDay: meal.mealsPerDay,
      disabled: !!meal.disabled,
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
      prepMethod: meal.prepMethod,
      cookQuantityMode: meal.cookQuantityMode,
    })),
    dailyVariables: normalizeIngredients(mapGet(config.dailyVariables, dayKey)),
    provider: config.provider || '',
    model: config.model || '',
    customModel: config.customModel || '',
    thinkingLevel: String(config.thinkingLevel || '').toLowerCase(),
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
  };

  // Added later than the fields above: include them only when they carry a
  // non-default value, so configs that never touched them keep their hash.
  if (config.maxTokens) {
    hashableFields.maxTokens = config.maxTokens;
  }
  if (config.reasoningEffort && config.reasoningEffort !== 'default') {
    hashableFields.reasoningEffort = config.reasoningEffort;
  }
  // Only stamped for the deterministic engine, so switching to it invalidates
  // the day's cached model plan (and back again re-uses it) while configs that
  // never leave the default keep the hashes they already have.
  if (config.generationEngine === 'deterministic') {
    hashableFields.generationEngine = 'deterministic';
    hashableFields.planBuilderVersion = PLAN_BUILDER_VERSION;
  }

  const jsonStr = JSON.stringify(hashableFields, (key, value) => {
    // Sort object keys at every level for deterministic serialization
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
  return createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Read one key from a value that may be a plain object or a Mongoose Map.
 */
function mapGet(mapOrObj, key) {
  if (!mapOrObj) return undefined;
  if (typeof mapOrObj.get === 'function') return mapOrObj.get(key);
  return mapOrObj[key];
}

/**
 * Normalize one day's ingredient overrides to the diet-relevant fields only,
 * dropping Mongoose internals so the serialization stays stable.
 */
function normalizeIngredients(list) {
  return (list || []).map((ing) => ({
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

// Support both CommonJS and ES module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeConfigHash };
}
