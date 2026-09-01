/**
 * Shared plan-verification pipeline: the deterministic arithmetic pass plus the
 * optional second-opinion AI review, assembled into the record that is stored
 * as one day's VerificationResult.
 *
 * Used by:
 *   - src/app/api/verify/route.ts (ES import via verification-runner.ts) — the
 *     manual "Verify" button.
 *   - whatsapp-worker.js (CommonJS require) — the automatic pass that runs
 *     after every generation and drives the regenerate-until-it-passes retries.
 *
 * Both callers must judge a plan identically, so the review prompt and the
 * verdict rules live here rather than in either caller.
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const { verifyPlan } = require('./verify-plan.js');
const { completeOnce } = require('./ai-complete.js');
const { compilePromptText } = require('./compile-prompt.js');

// A reviewer that rambles costs money and tells us nothing the checker did not,
// so the request is capped well below the plan-generation budget.
const REVIEW_FALLBACK_MAX_TOKENS = 8192;

// Retry feedback is a nudge, not a transcript: past this many findings the
// prompt stops being a fix list and starts being noise.
const MAX_RETRY_FEEDBACK_ISSUES = 25;

/**
 * Resolve which model reviews the plan. Blank verification settings mean
 * "reuse the generation model", so a config saved before this feature existed
 * still gets a working reviewer.
 */
function resolveReviewModel(config) {
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
function buildReviewPrompt(config, day, planText, math) {
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
function parseReviewJson(text) {
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

function toReviewIssues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const message = typeof entry.message === 'string' ? entry.message.trim() : '';
    if (!message) return [];
    return [{
      severity: entry.severity === 'error' ? 'error' : 'warning',
      category: typeof entry.category === 'string' && entry.category ? entry.category : 'other',
      message
    }];
  });
}

/**
 * Ask the review model for the judgement calls arithmetic cannot make.
 * Never throws: a failed review is reported as a status, because the
 * deterministic verdict stands on its own.
 */
async function runAiReview(config, day, planText, math, signal) {
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
      enterpriseLocation: settings.enterpriseLocation,
      signal
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

/**
 * Verify one day's plan and build the record stored as its VerificationResult.
 *
 * @param {object} config             – the config the plan was generated from
 * @param {string} day
 * @param {string} planText
 * @param {object} [options]
 * @param {boolean} [options.aiReview]        – run the review model too
 * @param {string}  [options.configHash]      – hash the plan was generated under
 * @param {Date}    [options.planGeneratedAt] – stamp of the plan being judged
 * @param {AbortSignal} [options.signal]      – aborts the review request
 * @returns {Promise<object>} record ready for VerificationResult.findOneAndUpdate
 */
async function runPlanVerification(config, day, planText, options = {}) {
  const math = verifyPlan(config, day, planText);

  const wantsReview = typeof options.aiReview === 'boolean'
    ? options.aiReview
    : !!config.verificationAiReview;

  const { review, issues: aiIssues } = wantsReview
    ? await runAiReview(config, day, planText, math, options.signal)
    : { review: { status: 'skipped' }, issues: [] };

  const issues = [
    ...math.issues.map((issue) => ({ ...issue, source: 'math' })),
    ...aiIssues.map((issue) => ({ ...issue, source: 'ai' }))
  ];
  // The arithmetic pass owns the pass/fail verdict — it is the one that
  // cannot be wrong about a number. An AI "error" is a flag, not a failure.
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;

  return {
    day,
    configHash: options.configHash || '',
    planGeneratedAt: options.planGeneratedAt || null,
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
}

/**
 * The corrective block appended to the original prompt when a verified plan is
 * regenerated. Handing the model the exact findings is the whole point of the
 * retry: a blind re-roll usually reproduces the same arithmetic slip.
 *
 * The base prompt is never mutated — each retry appends this block to the
 * pristine original so feedback from earlier attempts cannot pile up.
 */
function buildRetryFeedback(day, rejectedAttempt, issues, feasibility = null) {
  const ranked = [
    ...(issues || []).filter((issue) => issue.severity === 'error'),
    ...(issues || []).filter((issue) => issue.severity !== 'error')
  ].slice(0, MAX_RETRY_FEEDBACK_ISSUES);

  const lines = ranked.length
    ? ranked.map((issue) => {
      const origin = issue.source === 'ai' ? 'reviewer' : 'checker';
      return `- [${issue.severity}/${issue.category}, ${origin}] ${issue.message}`;
    }).join('\n')
    : '- The previous attempt could not be verified at all — re-read the output format rules above and follow them exactly.';

  // Some findings report a target no plan can hit on this day. Handing those to
  // a model under "fix every one of these" is an invitation to write numbers
  // that satisfy the checker instead of numbers that are true, so the one
  // constraint that is physically out of reach is called out as exactly that.
  const unreachable = feasibility && feasibility.ratioReachable === false && feasibility.bestRatio !== null
    ? `

NOTE: the configured sodium:potassium range is physically unreachable with this day's ingredients — the closest any plan can get is ${feasibility.bestRatio.toFixed(3)}. Get as close to it as the ingredients allow and print the ratio your own weights actually produce. Do NOT adjust any figure to make the ratio appear inside the range.`
    : '';

  return `

=== AUTOMATED VERIFICATION FEEDBACK — ATTEMPT ${rejectedAttempt} WAS REJECTED ===
A deterministic checker re-derived every weight, calorie, macro and mineral figure in your previous ${day} plan straight from the reference table above, and rejected it for the reasons below.

${lines}

Produce the complete ${day} plan again from scratch, in exactly the format specified above, with every one of these problems fixed. Recompute the numbers rather than editing the previous answer's figures, and make sure each printed total is the sum of the rows you actually printed. Every figure you print must be the one the reference table gives for the weight you chose — never a figure picked to make a total or a ratio look right.${unreachable}

Do not mention this feedback, the previous attempt, or the checker anywhere in your answer.`;
}

module.exports = {
  REVIEW_FALLBACK_MAX_TOKENS,
  MAX_RETRY_FEEDBACK_ISSUES,
  resolveReviewModel,
  buildReviewPrompt,
  runAiReview,
  runPlanVerification,
  buildRetryFeedback
};
