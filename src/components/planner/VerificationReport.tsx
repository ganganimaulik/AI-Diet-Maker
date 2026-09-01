'use client';
import { DayVerification, VerificationIssue, VerificationTotals } from '@/lib/types';

interface VerificationReportProps {
  day: string;
  verification: DayVerification | undefined;
  isVerifying: boolean;
  error?: string;
  hasPlan: boolean;
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

export default function VerificationReport({
  day,
  verification,
  isVerifying,
  error,
  hasPlan,
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
    return (
      <div className="placeholder-container">
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
