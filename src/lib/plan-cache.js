/**
 * The diet plan cache: each day's current plan, plus the plans it replaced.
 *
 * Used by:
 *   - src/app/api/cache/route.ts
 *   - whatsapp-worker.js (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 *
 * A day has one current plan (CachedResponse). Verification, the assistant
 * and the WhatsApp send all read it. Storing a plan for another config used to
 * throw the old one away, so changing a setting and changing it back paid for
 * the same plan twice. Now the plan being replaced is archived (PlanHistory)
 * under the config hash it was generated from, with its verdict. Resolving a
 * day whose current config has an archived plan puts that plan, and its
 * verdict, back as the day's current ones instead of calling the model.
 */

const { CachedResponse, PlanHistory, VerificationResult } = require('./models.js');

/** Archived plans kept per day; the ones replaced longest ago go first. */
const MAX_ARCHIVED_PLANS_PER_DAY = 10;

/**
 * @typedef {object} CachedPlan
 * @property {string} day
 * @property {string} configHash
 * @property {string} responseText
 * @property {string} thinkingText
 * @property {Date} generatedAt
 */

/**
 * @typedef {object} PlanStatus
 * @property {Date} generatedAt
 * @property {boolean} isValid  – generated from the day's current config
 * @property {boolean} restored – an archived plan was put back by this call
 */

function isDuplicateKeyError(error) {
  return !!error && error.code === 11000;
}

/** Whether two stored timestamps are the same instant; a missing one never is. */
function sameInstant(a, b) {
  return !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
}

/** A stored verdict without the fields that belong to its row, not its plan. */
function verdictSnapshot(verdict) {
  const { _id, __v, createdAt, updatedAt, day, ...snapshot } = verdict;
  return snapshot;
}

/** Drop a day's oldest archived plans past the cap. */
async function pruneHistory(day) {
  const excess = await PlanHistory.find({ day }, { _id: 1 })
    .sort({ archivedAt: -1, _id: -1 })
    .skip(MAX_ARCHIVED_PLANS_PER_DAY)
    .lean();
  if (excess.length > 0) {
    await PlanHistory.deleteMany({ _id: { $in: excess.map((entry) => entry._id) } });
  }
}

/**
 * Archive a plan that is about to stop being its day's current plan, with the
 * day's stored verdict when that verdict is about this exact plan.
 *
 * The history keeps one plan per config, the newest: an older plan never
 * overwrites a newer one. Archiving a plan that is already there (it was
 * restored, then replaced again) keeps the verdict it was archived with when
 * the day's verdict has moved on to another plan since.
 *
 * @param {CachedPlan} plan
 */
async function archivePlan(plan) {
  if (!plan || !plan.responseText || !plan.configHash) return;
  // The unique (day, configHash) index must exist before the first upsert,
  // or two simultaneous archives could leave two copies behind.
  await PlanHistory.init();

  const [verdict, existing] = await Promise.all([
    VerificationResult.findOne({ day: plan.day }).lean(),
    PlanHistory.findOne(
      { day: plan.day, configHash: plan.configHash },
      { generatedAt: 1, verification: 1 }
    ).lean()
  ]);

  let verification = null;
  if (
    verdict
    && sameInstant(verdict.planGeneratedAt, plan.generatedAt)
    && (!verdict.configHash || verdict.configHash === plan.configHash)
  ) {
    verification = verdictSnapshot(verdict);
  } else if (existing && sameInstant(existing.generatedAt, plan.generatedAt)) {
    verification = existing.verification || null;
  }

  const filter = { day: plan.day, configHash: plan.configHash };
  if (plan.generatedAt) {
    filter.$or = [{ generatedAt: { $lte: plan.generatedAt } }, { generatedAt: null }];
  }
  try {
    await PlanHistory.updateOne(
      filter,
      {
        $set: {
          responseText: plan.responseText,
          thinkingText: plan.thinkingText || '',
          generatedAt: plan.generatedAt || null,
          verification,
          archivedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    // The filter missed because a newer plan for this config is archived
    // already, and the upsert then collided with it: that one stays.
    if (!isDuplicateKeyError(error)) throw error;
  }
  await pruneHistory(plan.day);
}

/**
 * Make `next` the day's current plan, then archive the plan it replaced,
 * unless that one was for the same config: regenerating a config replaces its
 * plan.
 *
 * The swap is one atomic write that hands back the exact plan it displaced, so
 * writers racing for the same day (a finishing job, another tab restoring a
 * plan) each archive what they displaced, and none has to retry.
 *
 * @param {string} day
 * @param {{ configHash: string, responseText: string, thinkingText: string, generatedAt: Date }} next
 * @returns {Promise<CachedPlan>}
 */
async function replaceCurrentPlan(day, next) {
  const swap = () => CachedResponse.findOneAndUpdate(
    { day },
    { $set: next },
    { upsert: true, returnDocument: 'before', lean: true }
  );
  let previous;
  try {
    previous = await swap();
  } catch (error) {
    // Two first-ever writes for the day raced to create it and this one lost;
    // it replaces the winner's plan instead.
    if (!isDuplicateKeyError(error)) throw error;
    previous = await swap();
  }

  if (previous && previous.configHash !== next.configHash) {
    try {
      await archivePlan(previous);
    } catch (error) {
      // The new plan is stored either way; only the old one's history is lost.
      console.error(`Failed to archive the replaced ${day} plan:`, error);
    }
  }
  return { day, ...next };
}

/**
 * Store a freshly generated plan as the day's current plan, archiving the one
 * it replaces.
 *
 * @param {string} day
 * @param {{ configHash: string, responseText?: string, thinkingText?: string, generatedAt?: Date }} plan
 * @returns {Promise<CachedPlan>}
 */
async function storeCurrentPlan(day, plan) {
  return replaceCurrentPlan(day, {
    configHash: plan.configHash,
    responseText: plan.responseText || '',
    thinkingText: plan.thinkingText || '',
    generatedAt: plan.generatedAt || new Date()
  });
}

/**
 * The day's plan for the config that `configHash` describes.
 *
 * That is the current plan when it was generated from this config. Otherwise
 * it is the archived plan for this config, which becomes the current plan
 * again (and its verdict the day's verdict), so every reader of the current
 * plan sees it. With neither, the current plan comes back as it is, stale, or
 * null when the day has none.
 *
 * @param {string} day
 * @param {string} configHash
 * @returns {Promise<{ plan: CachedPlan | null, isValid: boolean, restored: boolean }>}
 */
async function resolveCurrentPlan(day, configHash) {
  const current = await CachedResponse.findOne({ day }).lean();
  if (current && current.configHash === configHash) {
    return { plan: current, isValid: true, restored: false };
  }

  const archived = await PlanHistory.findOne({ day, configHash }).lean();
  if (!archived || !archived.responseText) {
    return { plan: current || null, isValid: false, restored: false };
  }

  const plan = await replaceCurrentPlan(day, {
    configHash,
    responseText: archived.responseText,
    thinkingText: archived.thinkingText || '',
    generatedAt: archived.generatedAt || new Date()
  });
  if (archived.verification) {
    // Stamped with the plan it describes, so it reads as current, not stale.
    await VerificationResult.findOneAndUpdate(
      { day },
      { $set: { ...archived.verification, configHash, planGeneratedAt: plan.generatedAt } },
      { upsert: true }
    );
  }
  return { plan, isValid: true, restored: true };
}

/**
 * The cache status of several days, each against its own config hash,
 * restoring archived plans as resolveCurrentPlan does. Two reads cover the
 * whole week; only a day that gets a plan back costs more.
 *
 * @param {Record<string, string>} hashByDay – each day's current config hash
 * @returns {Promise<Record<string, PlanStatus>>} days with no plan are left out
 */
async function resolvePlanStatuses(hashByDay) {
  const days = Object.keys(hashByDay);
  const slots = await CachedResponse.find(
    { day: { $in: days } },
    { day: 1, configHash: 1, generatedAt: 1 }
  ).lean();
  const slotByDay = new Map(slots.map((slot) => [slot.day, slot]));

  const misses = days.filter((day) => {
    const slot = slotByDay.get(day);
    return !slot || slot.configHash !== hashByDay[day];
  });
  const archived = misses.length === 0
    ? []
    : await PlanHistory.find(
      { $or: misses.map((day) => ({ day, configHash: hashByDay[day] })) },
      { day: 1 }
    ).lean();
  const restorable = new Set(archived.map((entry) => entry.day));

  /** @type {Record<string, PlanStatus>} */
  const statuses = {};
  await Promise.all(days.map(async (day) => {
    if (restorable.has(day)) {
      const { plan, isValid, restored } = await resolveCurrentPlan(day, hashByDay[day]);
      if (plan) statuses[day] = { generatedAt: plan.generatedAt, isValid, restored };
      return;
    }
    const slot = slotByDay.get(day);
    if (slot) {
      statuses[day] = {
        generatedAt: slot.generatedAt,
        isValid: slot.configHash === hashByDay[day],
        restored: false
      };
    }
  }));
  return statuses;
}

/**
 * Forget a day's plans, current and archived, or every day's. The archive
 * goes too, or the next lookup would bring a cleared plan straight back.
 *
 * @param {string} [day]
 * @returns {Promise<{ deletedCount: number, deletedArchivedCount: number }>}
 */
async function clearPlans(day) {
  const filter = day ? { day } : {};
  const [current, archived] = await Promise.all([
    CachedResponse.deleteMany(filter),
    PlanHistory.deleteMany(filter)
  ]);
  return { deletedCount: current.deletedCount, deletedArchivedCount: archived.deletedCount };
}

module.exports = {
  MAX_ARCHIVED_PLANS_PER_DAY,
  storeCurrentPlan,
  resolveCurrentPlan,
  resolvePlanStatuses,
  clearPlans
};
