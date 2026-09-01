'use client';
import { useState } from 'react';
import { DayVerification, GenerationJob, VerificationAttempt, VerificationIssue, VerificationTotals } from '@/lib/types';

interface VerificationReportProps {
  day: string;
  verification: DayVerification | undefined;
  isVerifying: boolean;
  error?: string;
  hasPlan: boolean;
  /** The generation job behind this day, carrying its automatic retry history. */
  job?: GenerationJob;
  /** The day is inside an automatic post-generation verification pass. */
  isAutoVerifying?: boolean;
  onVerify: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  calories: 'Calories',
  macros: 'Macros',
  sodium: 'Sodium / Potassium',
  weights: 'Weights',
  cook: "Cook's copy",
  format: 'Format',
  reference: 'Reference data',
  instructions: 'Instructions',
  usability: 'Usability',
  claims: 'Claims',
  other: 'Other'
};

/** Rounds for display without pretending to precision the number lacks. */
const show = (value: number | null | undefined, digits = 0, suffix = '') =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}${suffix}`;

function Row({ label, computed, stated, digits = 0, suffix = '', tolerance = 0.51 }: {
  label: string;
  computed: number | null | undefined;
  stated: number | null | undefined;
  digits?: number;
  suffix?: string;
  tolerance?: number;
}) {
  const bothKnown = Number.isFinite(computed as number) && Number.isFinite(stated as number);
  const mismatch = bothKnown && Math.abs((computed as number) - (stated as number)) > tolerance;

  return (
    <tr className={mismatch ? 'is-mismatch' : ''}>
      <th scope="row">{label}</th>
      <td>{show(stated, digits, suffix)}</td>
      <td>{show(computed, digits, suffix)}</td>
      <td aria-hidden="true">{bothKnown ? (mismatch ? '✗' : '✓') : ''}</td>
    </tr>
  );
}

function IssueList({ issues }: { issues: VerificationIssue[] }) {
  return (
    <ul className="verify-issue-list">
      {issues.map((issue, index) => (
        <li key={index} className={`verify-issue is-${issue.severity}`}>
          <span className="verify-issue__tags">
            <span className={`verify-issue__severity is-${issue.severity}`}>
              {issue.severity === 'error' ? 'Error' : 'Note'}
            </span>
            <span className="verify-issue__category">
              {CATEGORY_LABELS[issue.category] || issue.category}
            </span>
            {issue.source === 'ai' && <span className="verify-issue__source">AI review</span>}
          </span>
          <span className="verify-issue__message">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

const ATTEMPT_LABELS: Record<VerificationAttempt['status'], { icon: string; text: string }> = {
  passed: { icon: '✅', text: 'passed' },
  failed: { icon: '❌', text: 'rejected — regenerated' },
  error: { icon: '⚠️', text: 'could not be verified' },
  skipped: { icon: '—', text: 'not verified' }
};

/**
 * Every automatic attempt this plan went through, newest last. A plan that
 * needed three tries is a different thing from one that passed first time,
 * and the rejected attempts are the only record of why.
 */
function AttemptHistory({ day, job, isAutoVerifying }: {
  day: string;
  job: GenerationJob | undefined;
  isAutoVerifying: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const attempts = job?.verificationAttempts || [];
  if (!job?.autoVerify || (attempts.length === 0 && !isAutoVerifying)) return null;

  const total = job.maxGenerationAttempts;
  const passed = attempts.some(attempt => attempt.status === 'passed');
  const rejected = attempts.filter(attempt => attempt.status === 'failed').length;
  const exhausted = !passed && !isAutoVerifying && attempts.length >= total;

  const headline = isAutoVerifying
    ? `Verifying attempt ${Math.max(1, job.generationAttempt)} of ${total}…`
    : passed
      ? rejected === 0
        ? 'Passed on the first attempt'
        : `Passed on attempt ${attempts.length} of ${total} after ${rejected} regeneration${rejected === 1 ? '' : 's'}`
      : exhausted
        ? `Still failing after all ${attempts.length} attempt(s) — the last plan was kept`
        : attempts.length > 0 && attempts[attempts.length - 1].status === 'error'
          ? 'Verification could not run — the plan was kept unchecked'
          : `${attempts.length} attempt(s) recorded`;

  return (
    <div className={`verify-attempts ${passed ? 'is-pass' : exhausted ? 'is-fail' : ''}`}>
      <div className="verify-attempts__head">
        <span className="verify-attempts__label">Automatic verification</span>
        <span className="verify-attempts__headline">{headline}</span>
      </div>

      <ol className="verify-attempts__list">
        {attempts.map(attempt => {
          const meta = ATTEMPT_LABELS[attempt.status];
          const isOpen = expanded === attempt.attempt;
          const canExpand = attempt.issues.length > 0 || !!attempt.error;
          return (
            <li key={attempt.attempt} className={`verify-attempt is-${attempt.status}`}>
              <button
                className="verify-attempt__row"
                onClick={() => setExpanded(isOpen ? null : attempt.attempt)}
                disabled={!canExpand}
                aria-expanded={isOpen}
              >
                <span className="verify-attempt__icon" aria-hidden="true">{meta.icon}</span>
                <span className="verify-attempt__title">
                  Attempt {attempt.attempt} of {total} {meta.text}
                </span>
                <span className="verify-attempt__counts">
                  {attempt.status === 'error'
                    ? attempt.error
                    : `${attempt.errorCount} error${attempt.errorCount === 1 ? '' : 's'}`
                      + (attempt.warningCount ? ` · ${attempt.warningCount} note${attempt.warningCount === 1 ? '' : 's'}` : '')}
                </span>
                {canExpand && <span className="verify-attempt__chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>}
              </button>

              {isOpen && attempt.issues.length > 0 && (
                <div className="verify-attempt__detail">
                  <IssueList issues={attempt.issues} />
                </div>
              )}
              {isOpen && !attempt.issues.length && attempt.error && (
                <div className="verify-attempt__detail">
                  <p className="verify-note is-warn">{attempt.error}</p>
                </div>
              )}
            </li>
          );
        })}
        {isAutoVerifying && (
          <li className="verify-attempt is-running">
            <span className="verify-attempt__row" aria-live="polite">
              <span className="spinner spinner--inline"></span>
              <span className="verify-attempt__title">
                Attempt {Math.max(1, job.generationAttempt)} of {total} — checking {day} now
              </span>
            </span>
          </li>
        )}
      </ol>

      {exhausted && (
        <p className="verify-note is-warn">
          The retry budget is spent, so the last plan was kept as-is. Fix the findings in the
          configuration, or regenerate {day} manually to try again.
        </p>
      )}
    </div>
  );
}

export default function VerificationReport({
  day,
  verification,
  isVerifying,
  error,
  hasPlan,
  job,
  isAutoVerifying = false,
  onVerify
}: VerificationReportProps) {
  if (isVerifying) {
    return (
      <div className="loading-container" style={{ flex: 1 }}>
        <div className="spinner"></div>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Verifying {day}...</p>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Re-deriving every weight, calorie and mineral from the reference table
        </span>
      </div>
    );
  }

  if (!verification) {
    const hasAttempts = !!job?.autoVerify && (job.verificationAttempts.length > 0 || isAutoVerifying);
    return (
      <div className={hasAttempts ? 'verify-report' : 'placeholder-container'}>
        {hasAttempts ? (
          <>
            <AttemptHistory day={day} job={job} isAutoVerifying={isAutoVerifying} />
            {error && <div className="error-banner">{error}</div>}
            <p className="verify-note">
              The full verdict for the plan that is kept appears here once this run finishes.
            </p>
          </>
        ) : (
          <>
            <div className="placeholder-icon">🔍</div>
            <h3 className="placeholder-title">{day} has not been verified</h3>
            <p className="placeholder-text">
              {hasPlan
                ? 'Re-derive every weight, calorie, macro and the Na:K ratio from the reference nutrition table and compare them against what the plan claims.'
                : `Generate the ${day} plan first — there is nothing to verify yet.`}
            </p>
            {error && <div className="error-banner" style={{ marginTop: '0.75rem' }}>{error}</div>}
            {hasPlan && (
              <div className="placeholder-actions">
                <button className="btn-primary" onClick={onVerify}>Verify {day}</button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const computed = (verification.computed || {}) as VerificationTotals;
  const stated = (verification.stated || {}) as VerificationTotals;
  const errors = verification.issues.filter(issue => issue.severity === 'error');
  const warnings = verification.issues.filter(issue => issue.severity === 'warning');
  const checkedAt = new Date(verification.checkedAt);
  const review = verification.aiReview;

  return (
    <div className="verify-report">
      <div className={`verify-verdict ${verification.ok ? 'is-pass' : 'is-fail'}`}>
        <span className="verify-verdict__icon" aria-hidden="true">{verification.ok ? '✅' : '❌'}</span>
        <div className="verify-verdict__body">
          <strong>
            {verification.ok
              ? `${day} checks out`
              : `${day} failed verification — ${errors.length} error${errors.length === 1 ? '' : 's'}`}
          </strong>
          <span className="verify-verdict__meta">
            Checked {checkedAt.toLocaleString()}
            {warnings.length > 0 && ` · ${warnings.length} note${warnings.length === 1 ? '' : 's'}`}
            {review?.status === 'ok' && review.model && ` · AI review: ${review.model.split('/').pop()}`}
          </span>
        </div>
        <button className="btn-regenerate btn-regenerate--sm" onClick={onVerify} title={`Re-run verification for ${day}`}>
          Re-verify
        </button>
      </div>

      <AttemptHistory day={day} job={job} isAutoVerifying={isAutoVerifying} />

      {verification.isStale && (
        <div className="verify-stale-banner">
          ⚠️ This verdict was computed for an older version of the plan or config. Re-verify to refresh it.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <table className="verify-table">
        <caption>What the plan claims vs. what its own listed weights add up to</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Plan says</th>
            <th scope="col">Actual</th>
            <th scope="col"><span className="sr-only">Match</span></th>
          </tr>
        </thead>
        <tbody>
          <Row label={`Calories (target ${verification.target || '—'})`} computed={computed.calories} stated={stated.calories} tolerance={2.01} suffix=" kcal" />
          <Row label="Protein" computed={computed.protein} stated={stated.protein} digits={1} suffix=" g" />
          <Row label="Carbs" computed={computed.carbs} stated={stated.carbs} digits={1} suffix=" g" />
          <Row label="Fat" computed={computed.fat} stated={stated.fat} digits={1} suffix=" g" />
          <Row label="Sodium" computed={computed.sodium} stated={stated.sodium} tolerance={2.01} suffix=" mg" />
          <Row label="Potassium" computed={computed.potassium} stated={stated.potassium} tolerance={2.01} suffix=" mg" />
          <Row label="Na:K ratio" computed={computed.ratio} stated={stated.ratio} digits={3} tolerance={0.006} />
        </tbody>
      </table>

      {computed.saltGrams !== undefined && (
        <p className="verify-note">
          Salt counted across all meals and splits: <strong>{computed.saltGrams} g</strong>
          {computed.inIdealRange === false && ' · Na:K is outside the configured ideal range'}
        </p>
      )}

      {verification.feasibility && verification.feasibility.ratioReachable === false && verification.feasibility.bestRatio !== null && (
        <p className="verify-note is-info">
          ℹ️ No plan can reach the configured Na:K range on this day. The best achievable ratio is{' '}
          <strong>{verification.feasibility.bestRatio.toFixed(3)}</strong> — it would take{' '}
          {verification.feasibility.extraPotassiumNeededMg} mg more potassium or{' '}
          {verification.feasibility.saltReductionNeededG} g less salt to close the gap.
        </p>
      )}

      {review?.status === 'ok' && review.summary && (
        <div className={`verify-ai-summary ${review.verdict === 'fail' ? 'is-fail' : ''}`}>
          <span className="verify-ai-summary__label">AI review ({review.model?.split('/').pop()})</span>
          <p>{review.summary}</p>
        </div>
      )}
      {review?.status === 'failed' && (
        <div className="verify-note is-warn">
          The AI review could not run: {review.error}. The arithmetic check above still applies.
        </div>
      )}

      {errors.length > 0 && (
        <div className="verify-section">
          <h4 className="verify-section__title">Errors ({errors.length})</h4>
          <IssueList issues={errors} />
        </div>
      )}

      {warnings.length > 0 && (
        <div className="verify-section">
          <h4 className="verify-section__title">Notes ({warnings.length})</h4>
          <IssueList issues={warnings} />
        </div>
      )}

      {verification.issues.length === 0 && (
        <p className="verify-note is-ok">
          Every weight, calorie, macro and mineral figure in this plan matches the reference table, all
          AUTO weights are inside their configured bounds, and the cook&apos;s copy matches Part 1.
        </p>
      )}
    </div>
  );
}
