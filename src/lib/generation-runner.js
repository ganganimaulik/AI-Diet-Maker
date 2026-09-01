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
 * Error thrown inside the runner when a cancel flag is observed mid-stream.
 * Distinctive class so the catch block can record 'cancelled' instead of
 * 'failed' (a cancellation is intentional, not an error worth retrying).
 */
class GenerationCancelledError extends Error {
  constructor(message = 'Generation cancelled by user.') {
    super(message);
    this.name = 'GenerationCancelledError';
  }
}

function isGenerationCancelledError(error) {
  return error instanceof GenerationCancelledError
    || (typeof error === 'object' && error !== null && error.name === 'GenerationCancelledError');
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
    { status: 'queued', cancelRequested: { $ne: true } },
    {
      $set: {
        status: 'running',
        // generationAttempt and verificationAttempts are deliberately NOT reset:
        // a job requeued after a crashed worker resumes its retry budget instead
        // of spending a fresh one.
        phase: 'generating',
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
 * A stale job the user already cancelled is finished off instead of requeued.
 */
async function requeueStaleJobs(GenerationJob, now = new Date()) {
  await GenerationJob.updateMany(
    { status: 'running', cancelRequested: true, leaseExpiresAt: { $lte: now } },
    {
      $set: {
        status: 'cancelled',
        error: 'Generation cancelled by user.',
        completedAt: now,
        leaseId: '',
        leaseExpiresAt: null
      }
    }
  );

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

/**
 * Start a new generation attempt on a claimed job: record which attempt is
 * running, flip back to the generating phase and clear the previous attempt's
 * streamed text so the dashboard shows a fresh stream rather than the rejected
 * plan. Returns false when the lease was lost.
 */
async function startGenerationAttempt(GenerationJob, jobId, leaseId, attempt) {
  const now = new Date();
  const result = await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $set: {
        phase: 'generating',
        generationAttempt: attempt,
        responseText: '',
        thinkingText: '',
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS)
      }
    }
  );
  return result.matchedCount > 0;
}

/**
 * Move a claimed job into its verification phase, checkpointing the plan that
 * is about to be judged. Returns false when the lease was lost.
 */
async function startVerificationPhase(GenerationJob, jobId, leaseId, { responseText = '', thinkingText = '' } = {}) {
  const now = new Date();
  const result = await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $set: {
        phase: 'verifying',
        responseText,
        thinkingText,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS)
      }
    }
  );
  return result.matchedCount > 0;
}

/**
 * Append one attempt's verdict to the job's history. Appended rather than
 * replaced so a reader always sees every attempt that was made, including the
 * ones whose plans were thrown away.
 */
async function recordVerificationAttempt(GenerationJob, jobId, leaseId, attemptRecord) {
  const now = new Date();
  const result = await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $push: { verificationAttempts: attemptRecord },
      $set: {
        // 'error'/'skipped' mean no verdict was reached, which is not the same
        // as a failing one — those leave verificationOk null.
        verificationOk: attemptRecord.status === 'passed' ? true
          : attemptRecord.status === 'failed' ? false
            : null,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS)
      }
    }
  );
  return result.matchedCount > 0;
}

/**
 * Mark a job completed with its final text and release the lease.
 *
 * The update atomically requires that no cancellation has arrived, so a DELETE
 * landing between the runner's last cancel check and this write cannot be
 * overwritten by a completion (and then cached). Returns true when the
 * completion was recorded; false means the job was cancelled mid-flight (or,
 * practically never, the lease was lost) and the caller must not cache.
 */
async function completeJob(
  GenerationJob,
  jobId,
  leaseId,
  { responseText = '', thinkingText = '', verificationOk = null } = {}
) {
  const now = new Date();
  const result = await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId, cancelRequested: { $ne: true } },
    {
      $set: {
        status: 'completed',
        phase: 'generating',
        verificationOk,
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
  return result.matchedCount > 0;
}

/**
 * Request cancellation of a day's active job. A queued job transitions straight
 * to 'cancelled' (the claim query also skips flagged jobs, so a lost race still
 * never executes); a running job is flagged and the worker aborts it at its
 * next cancel poll. Returns the updated job, or null when no active job exists.
 *
 * When `jobId` is given it must match the active job: the per-day document is
 * recycled between runs, so a delayed request from one tab must never cancel a
 * newer generation started by another.
 */
async function requestCancelJob(GenerationJob, day, jobId = null) {
  const now = new Date();
  const scope = jobId ? { day, jobId } : { day };

  const cancelled = await GenerationJob.findOneAndUpdate(
    { ...scope, status: 'queued' },
    {
      $set: {
        status: 'cancelled',
        cancelRequested: true,
        error: 'Generation cancelled by user.',
        completedAt: now
      }
    },
    { new: true }
  );
  if (cancelled) return cancelled;

  return GenerationJob.findOneAndUpdate(
    { ...scope, status: 'running' },
    { $set: { cancelRequested: true } },
    { new: true }
  );
}

/**
 * Lightweight poll used by the runner while streaming: has this claimed job
 * been asked to cancel? Lease-matched so a recycled per-day document (new
 * jobId/lease) never aborts a fresh run.
 */
async function isCancelRequested(GenerationJob, jobId, leaseId) {
  const doc = await GenerationJob.findOne(
    { jobId, status: 'running', leaseId, cancelRequested: true },
    { _id: 1 }
  );
  return !!doc;
}

/** Mark a running job cancelled, keeping any partial text already streamed. */
async function cancelJob(GenerationJob, jobId, leaseId, { responseText = '', thinkingText = '' } = {}) {
  const now = new Date();
  await GenerationJob.updateOne(
    { jobId, status: 'running', leaseId },
    {
      $set: {
        status: 'cancelled',
        phase: 'generating',
        responseText,
        thinkingText,
        error: 'Generation cancelled by user.',
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
        phase: 'generating',
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
  GenerationCancelledError,
  isGenerationCancelledError,
  claimNextQueuedJob,
  requeueStaleJobs,
  heartbeatJob,
  startGenerationAttempt,
  startVerificationPhase,
  recordVerificationAttempt,
  completeJob,
  failJob,
  requestCancelJob,
  isCancelRequested,
  cancelJob
};
