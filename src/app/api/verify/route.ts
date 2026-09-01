import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import {
  dbConnect,
  Config,
  CachedResponse,
  VerificationResult,
  type IConfig,
  type IVerificationResult
} from '@/lib/db';
import { computeConfigHash } from '@/lib/config-hash';
import { verifyPlan, type PlanVerification, type VerificationIssue } from '@/lib/verify-plan';
import { completeOnce } from '@/lib/ai-complete';
import { compilePromptText } from '@/lib/compile-prompt';

// The arithmetic pass is instant; only the optional AI review is slow, and the
// dashboard verifies one day per request so "Verify All" stays seven short
// calls instead of one long one.
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

// A reviewer that rambles costs money and tells us nothing the checker did not,
// so the request is capped well below the plan-generation budget.
const REVIEW_FALLBACK_MAX_TOKENS = 8192;

interface AiReview {
  status: 'skipped' | 'ok' | 'failed';
  provider?: string;
  model?: string;
  verdict?: string;
  summary?: string;
  error?: string;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim().toUpperCase();
  return VALID_DAYS.has(day) ? day : null;
}

/**
 * Resolve which model reviews the plan. Blank verification settings mean
 * "reuse the generation model", so a config saved before this feature existed
 * still gets a working reviewer.
 */
function resolveReviewModel(config: IConfig) {
  const provider = config.verificationProvider || config.provider || 'google-ai-studio';
  const sameAsGeneration = !config.verificationProvider || config.verificationProvider === config.provider;

  let selected = config.verificationModel || '';
  let custom = config.verificationCustomModel || '';
  if (!selected && sameAsGeneration) {
    selected = config.model || '';
    custom = config.customModel || '';
  }
  const model = selected === 'custom' ? custom : selected;

  return {
    provider,
    model,
    thinkingLevel: config.verificationThinkingLevel || 'default',
    reasoningEffort: config.verificationReasoningEffort || 'default',
    maxTokens: Number(config.verificationMaxTokens) > 0
      ? Number(config.verificationMaxTokens)
      : REVIEW_FALLBACK_MAX_TOKENS,
    enterpriseAuthMethod: config.enterpriseAuthMethod || 'api-key',
    enterpriseProjectId: config.enterpriseProjectId || '',
    enterpriseLocation: config.enterpriseLocation || 'global',
    credentials: {
      fireworksApiKey: config.fireworksApiKey,
      apiKey: config.apiKey,
      enterpriseApiKey: config.enterpriseApiKey,
      enterpriseServiceAccountJson: config.enterpriseServiceAccountJson
    }
  };
}

/**
 * The reviewer gets the same brief the generator got, the plan under test, and
 * what the arithmetic pass already found — its job is the judgement the
 * checker cannot make, not a second round of the same sums.
 */
function buildReviewPrompt(config: IConfig, day: string, planText: string, math: PlanVerification): string {
  const generationBrief = compilePromptText(config, { mode: 'single', selectedDay: day });
  const findings = math.issues.length
    ? math.issues.map((issue) => `- [${issue.severity}/${issue.category}] ${issue.message}`).join('\n')
    : '- (none)';

  return `You are auditing a generated diet plan for ${day}. A deterministic checker has already re-derived every weight, calorie, macro and mineral figure from the reference table, so do NOT redo that arithmetic — trust its findings and look for what it cannot see.

Judge the plan on:
1. Instructions in the brief that were ignored or half-followed (formatting rules, exclusion rules, per-meal vs daily-total quantity modes, splits printed in the wrong place).
2. Anything a cook or the person eating this would find unusable, ambiguous, or unsafe to follow.
3. Claims the plan states as fact that its own numbers do not support, or explanatory text invented to paper over a gap.
4. Whether the deterministic findings below have a common root cause worth naming.

=== THE BRIEF THE PLAN WAS GENERATED FROM ===
${generationBrief}

=== THE GENERATED PLAN UNDER TEST ===
${planText}

=== WHAT THE DETERMINISTIC CHECKER ALREADY FOUND ===
${findings}

Reply with ONLY a JSON object, no prose and no markdown fences:
{
  "verdict": "pass" | "fail",
  "summary": "one or two sentences",
  "issues": [{ "severity": "error" | "warning", "category": "instructions" | "usability" | "claims" | "other", "message": "what is wrong and where" }]
}
Use "fail" only for problems that make the plan wrong or unusable. Report at most 10 issues, most important first. An empty issues array is a valid answer.`;
}

/** Models wrap JSON in prose or fences often enough to be worth handling. */
function parseReviewJson(text: string): { verdict?: string; summary?: string; issues?: unknown } | null {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toReviewIssues(raw: unknown): VerificationIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const issue = entry as Record<string, unknown>;
    const message = typeof issue.message === 'string' ? issue.message.trim() : '';
    if (!message) return [];
    return [{
      severity: issue.severity === 'error' ? 'error' : 'warning',
      category: typeof issue.category === 'string' && issue.category ? issue.category : 'other',
      message
    } as VerificationIssue];
  });
}

async function runAiReview(
  config: IConfig,
  day: string,
  planText: string,
  math: PlanVerification
): Promise<{ review: AiReview; issues: VerificationIssue[] }> {
  const settings = resolveReviewModel(config);
  if (!settings.model) {
    return {
      review: { status: 'skipped', error: 'No verification model selected — pick one in Settings → AI Provider & LLM Settings.' },
      issues: []
    };
  }

  try {
    const { text } = await completeOnce({
      provider: settings.provider,
      model: settings.model,
      prompt: buildReviewPrompt(config, day, planText, math),
      credentials: settings.credentials,
      thinkingLevel: settings.thinkingLevel,
      reasoningEffort: settings.reasoningEffort,
      maxTokens: settings.maxTokens,
      enterpriseAuthMethod: settings.enterpriseAuthMethod,
      enterpriseProjectId: settings.enterpriseProjectId,
      enterpriseLocation: settings.enterpriseLocation
    });

    const parsed = parseReviewJson(text);
    if (!parsed) {
      // Still worth surfacing: an unparseable answer usually still says something.
      return {
        review: {
          status: 'ok',
          provider: settings.provider,
          model: settings.model,
          verdict: 'unknown',
          summary: text.trim().slice(0, 2000) || 'The review model returned an empty response.'
        },
        issues: []
      };
    }

    return {
      review: {
        status: 'ok',
        provider: settings.provider,
        model: settings.model,
        verdict: parsed.verdict === 'fail' ? 'fail' : 'pass',
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
      },
      issues: toReviewIssues(parsed.issues)
    };
  } catch (error) {
    return {
      review: {
        status: 'failed',
        provider: settings.provider,
        model: settings.model,
        error: error instanceof Error ? error.message : String(error)
      },
      issues: []
    };
  }
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
    const math = verifyPlan(config, day, cached.responseText);

    const requestedReview = (body as { aiReview?: unknown }).aiReview;
    const wantsReview = typeof requestedReview === 'boolean' ? requestedReview : !!config.verificationAiReview;
    const { review, issues: aiIssues } = wantsReview
      ? await runAiReview(config, day, cached.responseText, math)
      : { review: { status: 'skipped' } as AiReview, issues: [] as VerificationIssue[] };

    const issues = [
      ...math.issues.map((issue) => ({ ...issue, source: 'math' as const })),
      ...aiIssues.map((issue) => ({ ...issue, source: 'ai' as const }))
    ];
    // The arithmetic pass owns the pass/fail verdict — it is the one that
    // cannot be wrong about a number. An AI "error" is a flag, not a failure.
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;

    const record = {
      day,
      configHash: cached.configHash || currentHash,
      planGeneratedAt: cached.generatedAt || null,
      ok: math.errorCount === 0,
      errorCount,
      warningCount: issues.length - errorCount,
      issues,
      computed: math.computed,
      stated: math.stated,
      feasibility: math.feasibility,
      target: math.target || 0,
      aiReview: review,
      checkedAt: new Date()
    };

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
