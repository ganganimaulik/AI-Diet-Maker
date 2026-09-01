import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  dbConnect,
  Config,
  CachedResponse,
  VerificationResult,
  type IVerificationResult
} from '@/lib/db';
import { computeConfigHash } from '@/lib/config-hash';
import { runPlanVerification } from '@/lib/verification-runner';

// The arithmetic pass is instant; only the optional AI review is slow, and the
// dashboard verifies one day per request so "Verify All" stays seven short
// calls instead of one long one.
//
// This route serves the manual "Verify" buttons. The same pipeline also runs
// automatically inside whatsapp-worker.js after every generation — both call
// runPlanVerification so a plan is judged identically either way.
export const maxDuration = 300;

const VALID_DAYS = new Set([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
]);

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim().toUpperCase();
  return VALID_DAYS.has(day) ? day : null;
}

function serialize(record: IVerificationResult, isStale: boolean) {
  return {
    day: record.day,
    ok: record.ok,
    checkedAt: record.checkedAt instanceof Date ? record.checkedAt.toISOString() : String(record.checkedAt),
    errorCount: record.errorCount,
    warningCount: record.warningCount,
    issues: record.issues || [],
    computed: record.computed ?? null,
    stated: record.stated ?? null,
    feasibility: record.feasibility ?? null,
    target: record.target || 0,
    aiReview: record.aiReview ?? null,
    isStale
  };
}

/**
 * A verdict describes one exact plan. Once the plan is regenerated or the
 * config that produced it changes, the verdict is history, not a status.
 */
function isVerdictStale(
  record: Pick<IVerificationResult, 'configHash' | 'planGeneratedAt'>,
  currentHash: string,
  planGeneratedAt: Date | null
): boolean {
  if (record.configHash && record.configHash !== currentHash) return true;
  if (!planGeneratedAt) return true;
  const stamped = record.planGeneratedAt ? new Date(record.planGeneratedAt).getTime() : 0;
  return stamped !== planGeneratedAt.getTime();
}

/**
 * POST /api/verify  { day, aiReview?: boolean }
 * Re-derives that day's cached plan and stores the verdict.
 */
export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const day = normalizeDay((body as { day?: unknown }).day);
    if (!day) {
      return NextResponse.json({ error: 'A valid day is required.' }, { status: 400 });
    }

    await dbConnect();
    const config = await Config.findOne();
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 });
    }

    const cached = await CachedResponse.findOne({ day });
    if (!cached || !cached.responseText) {
      return NextResponse.json(
        { error: `No generated plan cached for ${day}. Generate it first.` },
        { status: 404 }
      );
    }

    const currentHash = computeConfigHash(config, day);
    const requestedReview = (body as { aiReview?: unknown }).aiReview;

    const record = await runPlanVerification(config, day, cached.responseText, {
      aiReview: typeof requestedReview === 'boolean' ? requestedReview : undefined,
      configHash: cached.configHash || currentHash,
      planGeneratedAt: cached.generatedAt || null
    });

    const saved = await VerificationResult.findOneAndUpdate(
      { day },
      { $set: record },
      { upsert: true, new: true }
    );

    return NextResponse.json(
      { result: serialize(saved, isVerdictStale(saved, currentHash, cached.generatedAt || null)) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error verifying plan:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/verify         — every stored verdict, each flagged stale or not
 * GET /api/verify?day=MON — one day's stored verdict
 */
export async function GET(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const config = await Config.findOne();
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const requestedDay = searchParams.get('day');
    const day = requestedDay === null ? null : normalizeDay(requestedDay);
    if (requestedDay !== null && !day) {
      return NextResponse.json({ error: 'A valid day is required.' }, { status: 400 });
    }

    const [records, plans] = await Promise.all([
      day ? VerificationResult.find({ day }) : VerificationResult.find({}),
      day ? CachedResponse.find({ day }, { day: 1, generatedAt: 1 }) : CachedResponse.find({}, { day: 1, generatedAt: 1 })
    ]);
    const planStamps = new Map(plans.map((plan) => [plan.day, plan.generatedAt || null]));

    const results = records.map((record) =>
      serialize(record, isVerdictStale(record, computeConfigHash(config, record.day), planStamps.get(record.day) || null))
    );

    if (day) {
      return NextResponse.json({ result: results[0] || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error loading verification results:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/verify?day=MONDAY — drop one day's verdict
 * DELETE /api/verify            — drop them all
 */
export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const requestedDay = searchParams.get('day');
    const day = requestedDay === null ? null : normalizeDay(requestedDay);
    if (requestedDay !== null && !day) {
      return NextResponse.json({ error: 'A valid day is required.' }, { status: 400 });
    }

    const result = day
      ? await VerificationResult.deleteOne({ day })
      : await VerificationResult.deleteMany({});

    return NextResponse.json({ success: true, deletedCount: result.deletedCount || 0 });
  } catch (error) {
    console.error('Error deleting verification results:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
