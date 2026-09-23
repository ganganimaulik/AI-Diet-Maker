import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  CachedResponse,
  Config,
  GenerationJob,
  VerificationResult,
  dbConnect,
  type IConfig,
  type IGenerationJob,
  type IGenerationVerificationAttempt
} from '@/lib/db';
import { computeConfigHash } from '@/lib/config-hash';
import { buildPlan } from '@/lib/build-plan';
import { runPlanVerification } from '@/lib/verification-runner';

import { requeueStaleJobs, requestCancelJob } from '@/lib/generation-runner';

// Model generation does not execute in this serverless function. POST persists
// a durable GenerationJob and the always-on whatsapp-worker process claims and
// runs it (see src/lib/generation-runner.js), so a long plan cannot hit
// Vercel's per-invocation timeout. This route only enqueues and reports status.
//
// The deterministic engine is the exception: it is pure arithmetic over the
// config, finishes in milliseconds and calls nothing over the network, so it
// runs here and the job comes back already completed. That also means it works
// with the worker down and with no API key configured at all.

const VALID_DAYS = new Set([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
]);
const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;

// Regenerations after the first attempt. The config can lower this, but never
// past a ceiling — an unbounded retry loop is a bill, not a feature.
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_MAX_RETRIES = 3;

interface GenerationRequestBody {
  day?: unknown;
  prompt?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  maxTokens?: unknown;
  reasoningEffort?: unknown;
  provider?: unknown;
  cacheable?: unknown;
  autoVerify?: unknown;
  enterpriseAuthMethod?: unknown;
  enterpriseProjectId?: unknown;
  enterpriseLocation?: unknown;
}

interface PublicGenerationJob {
  jobId: string;
  day: string;
  status: IGenerationJob['status'];
  phase: IGenerationJob['phase'];
  responseText: string;
  thinkingText: string;
  error: string;
  cacheable: boolean;
  isCurrentConfig: boolean;
  engine: 'llm' | 'deterministic';
  autoVerify: boolean;
  generationAttempt: number;
  maxGenerationAttempts: number;
  verificationOk: boolean | null;
  verificationAttempts: PublicVerificationAttempt[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface PublicVerificationAttempt {
  attempt: number;
  status: IGenerationVerificationAttempt['status'];
  errorCount: number;
  warningCount: number;
  issues: IGenerationVerificationAttempt['issues'];
  aiStatus: string;
  aiVerdict: string;
  aiSummary: string;
  error: string;
  generatedAt: string | null;
  checkedAt: string | null;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim().toUpperCase();
  return VALID_DAYS.has(day) ? day : null;
}

/**
 * The engine a run executes on.
 *
 * Read from the saved configuration and nowhere else, because computeConfigHash
 * stamps the engine from that same document. Honouring a per-request override
 * would let the two disagree — a stale browser tab could run the model while
 * the hash said "computed", and the model's plan would then be cached under the
 * deterministic hash and served back as a computed one.
 */
function resolveEngine(config: IConfig): 'llm' | 'deterministic' {
  return config.generationEngine === 'deterministic' ? 'deterministic' : 'llm';
}

function normalizeMaxTokens(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** Retries allowed after the first generation, clamped to a sane ceiling. */
function normalizeMaxRetries(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RETRIES;
  return Math.min(MAX_ALLOWED_RETRIES, Math.max(0, Math.floor(parsed)));
}

function dateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function isCurrentConfig(job: IGenerationJob, config: IConfig | null): boolean {
  if (!config) return false;
  try {
    return job.configHash === computeConfigHash(config, job.day);
  } catch {
    return false;
  }
}

function serializeAttempt(attempt: IGenerationVerificationAttempt): PublicVerificationAttempt {
  return {
    attempt: attempt.attempt,
    status: attempt.status,
    errorCount: attempt.errorCount || 0,
    warningCount: attempt.warningCount || 0,
    issues: attempt.issues || [],
    aiStatus: attempt.aiStatus || '',
    aiVerdict: attempt.aiVerdict || '',
    aiSummary: attempt.aiSummary || '',
    error: attempt.error || '',
    generatedAt: dateString(attempt.generatedAt),
    checkedAt: dateString(attempt.checkedAt)
  };
}

function serializeJob(job: IGenerationJob, config: IConfig | null): PublicGenerationJob {
  return {
    jobId: job.jobId,
    day: job.day,
    status: job.status,
    phase: job.phase || 'generating',
    responseText: job.responseText || '',
    thinkingText: job.thinkingText || '',
    error: job.error || '',
    cacheable: !!job.cacheable,
    isCurrentConfig: isCurrentConfig(job, config),
    engine: job.engine === 'deterministic' ? 'deterministic' : 'llm',
    autoVerify: !!job.autoVerify,
    generationAttempt: job.generationAttempt || 0,
    maxGenerationAttempts: job.maxGenerationAttempts || 1,
    verificationOk: typeof job.verificationOk === 'boolean' ? job.verificationOk : null,
    verificationAttempts: (job.verificationAttempts || []).map(serializeAttempt),
    // requestedAt represents the current logical job when the per-day Mongo
    // document has been reused after a previous terminal generation.
    createdAt: dateString(job.requestedAt) || dateString(job.createdAt) || new Date(0).toISOString(),
    updatedAt: dateString(job.updatedAt) || dateString(job.requestedAt) || new Date(0).toISOString(),
    startedAt: dateString(job.startedAt),
    completedAt: dateString(job.completedAt)
  };
}

async function createOrReuseJob(
  day: string,
  configHash: string,
  body: GenerationRequestBody,
  config: IConfig
) {
  const active = await GenerationJob.findOne({
    day,
    status: { $in: ACTIVE_JOB_STATUSES }
  });
  if (active) return active;

  const now = new Date();
  const maxTokens = normalizeMaxTokens(body.maxTokens ?? config.maxTokens);
  // A hand-written prompt is judged against a brief the checker never saw, so
  // those runs are never auto-verified regardless of the setting.
  const cacheable = body.cacheable !== false;
  const autoVerify = cacheable && (typeof body.autoVerify === 'boolean'
    ? body.autoVerify
    : config.verificationAutoRetry !== false);
  const jobValues = {
    jobId: randomUUID(),
    day,
    status: 'queued' as const,
    prompt: stringValue(body.prompt),
    engine: 'llm' as const,
    provider: stringValue(body.provider, config.provider || 'google-ai-studio'),
    model: stringValue(body.model, config.model || 'gemini-3.7-flash'),
    thinkingLevel: stringValue(body.thinkingLevel, config.thinkingLevel || 'default'),
    maxTokens,
    reasoningEffort: stringValue(body.reasoningEffort, config.reasoningEffort || 'default'),
    enterpriseAuthMethod: stringValue(body.enterpriseAuthMethod, config.enterpriseAuthMethod || 'api-key'),
    enterpriseProjectId: stringValue(body.enterpriseProjectId, config.enterpriseProjectId || ''),
    enterpriseLocation: stringValue(body.enterpriseLocation, config.enterpriseLocation || 'global'),
    configHash,
    cacheable,
    autoVerify,
    maxGenerationAttempts: autoVerify ? 1 + normalizeMaxRetries(config.verificationMaxRetries) : 1,
    phase: 'generating' as const,
    generationAttempt: 0,
    verificationAttempts: [],
    verificationOk: null,
    cancelRequested: false,
    responseText: '',
    thinkingText: '',
    error: '',
    leaseId: '',
    leaseExpiresAt: null,
    heartbeatAt: null,
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    attempts: 0
  };

  try {
    return await GenerationJob.findOneAndUpdate(
      { day, status: { $nin: ACTIVE_JOB_STATUSES } },
      { $set: jobValues },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Two simultaneous requests can both observe no active job. The unique day
    // index elects one; the loser returns the winner idempotently.
    if (isDuplicateKeyError(error)) {
      const winner = await GenerationJob.findOne({
        day,
        status: { $in: ACTIVE_JOB_STATUSES }
      });
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Claim a day by replacing its terminal job document with a finished one.
 *
 * The filter deliberately skips active jobs, so the upsert collides with the
 * unique day index when a run starts in the gap between the caller's check and
 * this write. Returns null on that collision: another run owns the day, and the
 * caller must leave its cache entry and its verdict alone rather than
 * overwriting them with a plan that lost the race.
 */
async function upsertCompletedJob(day: string, values: Record<string, unknown>) {
  try {
    return await GenerationJob.findOneAndUpdate(
      { day, status: { $nin: ACTIVE_JOB_STATUSES } },
      { $set: values },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

/**
 * Compute one day's plan without a model and store it as a finished job.
 *
 * The plan is verified by the same arithmetic checker that judges a model's,
 * because a builder bug should surface as a failed verdict rather than as a
 * plan nobody checked. The second-opinion AI review is deliberately skipped:
 * this path exists to run without a provider, and that review never decides
 * pass/fail anyway. There is no retry loop either — the same config yields the
 * same plan, so regenerating it would only produce the same verdict.
 */
async function runDeterministicJob(
  day: string,
  configHash: string,
  body: GenerationRequestBody,
  config: IConfig
) {
  const built = buildPlan(config, day);
  const generatedAt = new Date();

  const record = await runPlanVerification(config, day, built.text, {
    aiReview: false,
    configHash,
    planGeneratedAt: generatedAt
  });

  const attempt: IGenerationVerificationAttempt = {
    attempt: 1,
    status: record.ok ? 'passed' : 'failed',
    errorCount: record.errorCount,
    warningCount: record.warningCount,
    issues: record.issues,
    aiStatus: 'skipped',
    aiVerdict: '',
    aiSummary: '',
    error: '',
    generatedAt,
    checkedAt: record.checkedAt
  };

  // Only now that a verified plan exists is it safe to stand down a job that
  // was queued for the worker. Doing it earlier would throw away a viable run
  // for a config that then turned out to be unsolvable.
  await GenerationJob.updateOne(
    { day, status: 'queued' },
    {
      $set: {
        status: 'cancelled',
        cancelRequested: true,
        error: 'Superseded by a computed plan.',
        completedAt: new Date()
      }
    }
  );

  const job = await upsertCompletedJob(day, {
    jobId: randomUUID(),
    day,
    status: 'completed' as const,
    // The compiled brief is stored even though nothing read it, so the
    // verification tab and the assistant still see what this day was
    // planned against.
    prompt: stringValue(body.prompt),
    engine: 'deterministic' as const,
    provider: 'deterministic',
    model: 'deterministic',
    thinkingLevel: 'default',
    maxTokens: 0,
    reasoningEffort: 'default',
    enterpriseAuthMethod: config.enterpriseAuthMethod || 'api-key',
    enterpriseProjectId: config.enterpriseProjectId || '',
    enterpriseLocation: config.enterpriseLocation || 'global',
    configHash,
    cacheable: true,
    autoVerify: true,
    maxGenerationAttempts: 1,
    phase: 'generating' as const,
    generationAttempt: 1,
    verificationAttempts: [attempt],
    verificationOk: record.ok,
    cancelRequested: false,
    responseText: built.text,
    thinkingText: built.thinking,
    error: '',
    leaseId: '',
    leaseExpiresAt: null,
    heartbeatAt: null,
    requestedAt: generatedAt,
    startedAt: generatedAt,
    completedAt: new Date(),
    attempts: 1
  });

  // Lost the race for the day: another run's plan is the day's plan now, and
  // this one must not overwrite the cache entry or the verdict that belong to it.
  if (!job) return null;

  try {
    await Promise.all([
      CachedResponse.findOneAndUpdate(
        { day },
        {
          $set: {
            configHash,
            responseText: built.text,
            thinkingText: built.thinking,
            generatedAt
          }
        },
        { upsert: true }
      ),
      VerificationResult.findOneAndUpdate(
        { day },
        { $set: { ...record, planGeneratedAt: generatedAt } },
        { upsert: true }
      )
    ]);
  } catch (error) {
    // The job document already says this day completed. Leaving it that way
    // after failing to store the plan would have the dashboard show a plan the
    // cache and the WhatsApp dispatch do not have, so the claim is withdrawn
    // before the error surfaces.
    await GenerationJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'failed',
          error: 'The computed plan could not be stored.',
          verificationOk: null,
          completedAt: new Date()
        }
      }
    ).catch(() => {});
    throw error;
  }

  return job;
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as GenerationRequestBody;
    const day = normalizeDay(body.day);
    if (!day) {
      return NextResponse.json({ error: 'A valid generation day is required.' }, { status: 400 });
    }
    if (!stringValue(body.prompt).trim()) {
      return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
    }

    await dbConnect();
    const config = await Config.findOne();
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 });
    }

    const configHash = computeConfigHash(config, day);

    if (resolveEngine(config) === 'deterministic') {
      // A day a worker is actively generating must not be replaced mid-flight.
      // A merely *queued* job is different: nothing has claimed it, and if the
      // worker is down nothing ever will — which is the situation this engine
      // exists to get out of. Cancelling it and computing the day is what the
      // user just asked for, so a dead queue cannot leave a day stuck.
      const running = await GenerationJob.findOne({ day, status: 'running' });
      if (running) {
        return NextResponse.json(
          { job: serializeJob(running, config) },
          { status: 202, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      try {
        const job = await runDeterministicJob(day, configHash, body, config);
        if (!job) {
          // Another run claimed the day between the check above and the write.
          // Its plan is the day's plan; nothing here was stored.
          const winner = await GenerationJob.findOne({ day });
          return NextResponse.json(
            { job: winner ? serializeJob(winner, config) : null },
            { status: 202, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return NextResponse.json(
          { job: serializeJob(job, config) },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (error) {
        // A config the arithmetic cannot solve (an ingredient the reference
        // table does not price, contradictory AUTO bounds) is a bad request,
        // not a server fault, and its message is the actionable part.
        if (error instanceof Error && error.name === 'PlanBuildError') {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    // Persist the job as queued; the whatsapp-worker claims and executes it.
    const job = await createOrReuseJob(day, configHash, body, config);

    return NextResponse.json(
      { job: serializeJob(job, config) },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error queueing generation job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const day = normalizeDay(searchParams.get('day'));
    if (!day) {
      return NextResponse.json({ error: 'A valid generation day is required.' }, { status: 400 });
    }
    const jobIdParam = searchParams.get('jobId');
    const jobId = jobIdParam && jobIdParam.trim() ? jobIdParam.trim() : null;

    await dbConnect();
    // Target the exact job the caller is tracking. The per-day document is
    // recycled between runs, so a stale tab must not cancel a newer one.
    const job = await requestCancelJob(GenerationJob, day, jobId);
    if (!job) {
      if (jobId) {
        const active = await GenerationJob.findOne(
          { day, status: { $in: ACTIVE_JOB_STATUSES } },
          { jobId: 1 }
        );
        if (active) {
          return NextResponse.json(
            { error: `Generation job ${jobId} is no longer active for ${day}; a newer run may have replaced it.` },
            { status: 409 }
          );
        }
      }
      return NextResponse.json({ error: `No active generation job for ${day}.` }, { status: 404 });
    }

    const config = await Config.findOne();
    return NextResponse.json(
      { job: serializeJob(job, config) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error cancelling generation job:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedDay = searchParams.get('day');
    const day = requestedDay === null ? null : normalizeDay(requestedDay);
    if (requestedDay !== null && !day) {
      return NextResponse.json({ error: 'A valid generation day is required.' }, { status: 400 });
    }

    await dbConnect();

    // If the worker died mid-run, its jobs sit in 'running' with an expired
    // lease. Return them to the queue here so they resume once the worker is
    // back, then read the (now corrected) state.
    await requeueStaleJobs(GenerationJob).catch((error: unknown) => {
      console.error('Failed to requeue stale generation jobs:', error);
    });

    const [config, jobs] = await Promise.all([
      Config.findOne(),
      day
        ? GenerationJob.find({ day }).sort({ requestedAt: -1 })
        : GenerationJob.find({}).sort({ requestedAt: -1 })
    ]);

    if (day) {
      return NextResponse.json(
        { job: jobs[0] ? serializeJob(jobs[0], config) : null },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { jobs: jobs.map((job) => serializeJob(job, config)) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error loading generation jobs:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
