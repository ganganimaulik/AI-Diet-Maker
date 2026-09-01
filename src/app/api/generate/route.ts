import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  Config,
  GenerationJob,
  dbConnect,
  type IConfig,
  type IGenerationJob
} from '@/lib/db';
import { computeConfigHash } from '@/lib/config-hash';

import { requeueStaleJobs, requestCancelJob } from '@/lib/generation-runner';

// Generation no longer executes in this serverless function. POST persists a
// durable GenerationJob and the always-on whatsapp-worker process claims and
// runs it (see src/lib/generation-runner.js), so a long plan cannot hit
// Vercel's per-invocation timeout. This route only enqueues and reports status.

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

interface GenerationRequestBody {
  day?: unknown;
  prompt?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  maxTokens?: unknown;
  reasoningEffort?: unknown;
  provider?: unknown;
  cacheable?: unknown;
  enterpriseAuthMethod?: unknown;
  enterpriseProjectId?: unknown;
  enterpriseLocation?: unknown;
}

interface PublicGenerationJob {
  jobId: string;
  day: string;
  status: IGenerationJob['status'];
  responseText: string;
  thinkingText: string;
  error: string;
  cacheable: boolean;
  isCurrentConfig: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim().toUpperCase();
  return VALID_DAYS.has(day) ? day : null;
}

function normalizeMaxTokens(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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

function serializeJob(job: IGenerationJob, config: IConfig | null): PublicGenerationJob {
  return {
    jobId: job.jobId,
    day: job.day,
    status: job.status,
    responseText: job.responseText || '',
    thinkingText: job.thinkingText || '',
    error: job.error || '',
    cacheable: !!job.cacheable,
    isCurrentConfig: isCurrentConfig(job, config),
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
  const jobValues = {
    jobId: randomUUID(),
    day,
    status: 'queued' as const,
    prompt: stringValue(body.prompt),
    provider: stringValue(body.provider, config.provider || 'google-ai-studio'),
    model: stringValue(body.model, config.model || 'gemini-3.7-flash'),
    thinkingLevel: stringValue(body.thinkingLevel, config.thinkingLevel || 'default'),
    maxTokens,
    reasoningEffort: stringValue(body.reasoningEffort, config.reasoningEffort || 'default'),
    enterpriseAuthMethod: stringValue(body.enterpriseAuthMethod, config.enterpriseAuthMethod || 'api-key'),
    enterpriseProjectId: stringValue(body.enterpriseProjectId, config.enterpriseProjectId || ''),
    enterpriseLocation: stringValue(body.enterpriseLocation, config.enterpriseLocation || 'global'),
    configHash,
    cacheable: body.cacheable !== false,
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
