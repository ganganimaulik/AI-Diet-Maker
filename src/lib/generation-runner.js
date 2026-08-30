/**
 * Shared lifecycle helpers for durable GenerationJob documents.
 *
 * The dashboard's /api/generate route persists a queued job; the long-running
 * whatsapp-worker process claims and executes it (no serverless timeout there),
 * writing progress and the final result back onto the same document. These
 * helpers keep the lease/claim semantics identical in both places.
 *
 * Plain CommonJS so whatsapp-worker.js can require() it without a build step.
 */

const { randomUUID } = require('node:crypto');

// How long a claimed job may go without a heartbeat before another poller may
// reclaim it. The runner is a long-lived process (not a ~60s serverless call),
// so this only guards against a crashed worker, not a slow model.
const LEASE_DURATION_MS = 300_000;
// Heartbeat cadence while a job executes. Must stay well under LEASE_DURATION_MS
// so one slow tick cannot trip a takeover.
const HEARTBEAT_INTERVAL_MS = 30_000;

function isDuplicateKeyError(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * Atomically claim the oldest queued job for execution. Returns the claimed job
 * (with prompt + leaseId populated) or null when nothing is queued.
 *
 * The atomic status transition is the election: two concurrent pollers cannot
 * both receive a job, because only one update matches status:'queued'.
 */
async function claimNextQueuedJob(GenerationJob) {
  const now = new Date();
  const leaseId = randomUUID();
  return GenerationJob.findOneAndUpdate(
    { status: 'queued' },
    {
      $set: {
        status: 'running',
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        heartbeatAt: now,
        startedAt: now,
        completedAt: null,
        responseText: '',
        thinkingText: '',
        error: ''
      },
      $inc: { attempts: 1 }
    },
    { new: true, sort: { requestedAt: 1 } }
  ).select('+prompt +leaseId');
}

/**
 * Return jobs whose runner died mid-execution (lease expired) to the queue so
 * they retry. Called on worker startup and opportunistically by the GET route.
 */
async function requeueStaleJobs(GenerationJob, now = new Date()) {
  const result = await GenerationJob.updateMany(
    { status: 'running', leaseExpiresAt: { $lte: now } },
    {
      $set: {
        status: 'queued',
        leaseId: '',
        leaseExpiresAt: null,
        heartbeatAt: null
      }
    }
  );
  return result.modifiedCount || 0;
}

/**
 * Extend the lease and refresh heartbeatAt while a job runs. `partial` may carry
 * responseText/thinkingText to checkpoint incremental progress. Returns false
 * when the lease was lost (a newer claim owns the job now).
 */
async function heartbeatJob(GenerationJob, jobId, leaseId, partial = {}) {
  const now = new Date();
  const $set = {
    heartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS)
  };
  if (typeof partial.responseText === 'string') $set.responseText = partial.responseText;
  if (typeof partial.thinkingText === 'string') $set.thinkingText = partial.thinkingText;

  const result = await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    { $set }
  );
  return result.matchedCount > 0;
}

/** Mark a job completed with its final text and release the lease. */
async function completeJob(GenerationJob, jobId, leaseId, { responseText = '', thinkingText = '' } = {}) {
  const now = new Date();
  await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $set: {
        status: 'completed',
        responseText,
        thinkingText,
        error: '',
        completedAt: now,
        heartbeatAt: now,
        leaseId: '',
        leaseExpiresAt: null
      }
    }
  );
}

/** Mark a job failed with a sanitized message and release the lease. */
async function failJob(GenerationJob, jobId, leaseId, errorMessage, { responseText = '', thinkingText = '' } = {}) {
  const now = new Date();
  await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $set: {
        status: 'failed',
        responseText,
        thinkingText,
        error: errorMessage,
        completedAt: now,
        heartbeatAt: now,
        leaseId: '',
        leaseExpiresAt: null
      }
    }
  );
}

module.exports = {
  LEASE_DURATION_MS,
  HEARTBEAT_INTERVAL_MS,
  isDuplicateKeyError,
  claimNextQueuedJob,
  requeueStaleJobs,
  heartbeatJob,
  completeJob,
  failJob
};
