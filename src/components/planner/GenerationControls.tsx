'use client';
import { Config, DayProgress, DayVerification, GenerationJob, DAYS_OF_WEEK } from '@/lib/types';
import { getDayVariantName } from '@/lib/compile-prompt';
import { CacheEntryStatus } from '@/hooks/useDietCache';

interface GenerationControlsProps {
  config: Config;
  setSelectedGenerationDay: (day: string) => void;
  cacheStatus: Record<string, CacheEntryStatus>;
  currentCacheDay: string;
  isGenerating: boolean;
  /** The selected day is in its automatic post-generation verification pass. */
  isAutoVerifying: boolean;
  isBatchGenerating: boolean;
  dayProgress: Record<string, DayProgress>;
  dayJobs: Record<string, GenerationJob>;
  isCacheLoading: boolean;
  onGenerate: (forceRegenerate: boolean) => void;
  onGenerateAllDays: () => void;
  onCancel: (day: string) => void;
  onCancelAll: () => void;
  onClearCache: (day?: string) => void;
  verifications: Record<string, DayVerification>;
  verifyingDays: Record<string, boolean>;
  isVerifyingAll: boolean;
  onVerifyDay: (day: string) => void;
  onVerifyAll: () => void;
}

/** Verified / failed / stale marker shown on a day chip. */
function verifyMark(verification: DayVerification | undefined, isVerifying: boolean) {
  if (isVerifying) return { cls: 'is-checking', title: 'verifying…' };
  if (!verification) return null;
  if (verification.isStale) return { cls: 'is-stale-check', title: 'verified against an older plan' };
  if (!verification.ok) return { cls: 'is-failed', title: `${verification.errorCount} verification error(s)` };
  return { cls: 'is-verified', title: 'verified' };
}

function VerifyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  );
}

/** "2/4" attempt counter, empty unless the run actually verifies and retries. */
function attemptCounter(job: GenerationJob | undefined): string {
  if (!job || !job.autoVerify || job.maxGenerationAttempts <= 1) return '';
  return ` ${Math.max(1, job.generationAttempt)}/${job.maxGenerationAttempts}`;
}

/** Maps a day's cache/progress state onto a chip modifier and short label. */
function dayChipState(status: CacheEntryStatus | undefined, progress: DayProgress | undefined, day: string) {
  const abbr = day.substring(0, 3);
  if (progress === 'verifying') return { cls: 'is-verifying', label: `🔍 ${abbr}` };
  if (progress === 'generating' || progress === 'checking') return { cls: 'is-busy', label: `⌛ ${abbr}` };
  if (progress === 'error') return { cls: 'is-error', label: `❌ ${abbr}` };
  if (status?.isValid) return { cls: 'is-valid', label: `✓ ${abbr}` };
  if (status) return { cls: 'is-stale', label: `! ${abbr}` };
  return { cls: '', label: abbr };
}

export default function GenerationControls({
  config,
  setSelectedGenerationDay,
  cacheStatus,
  currentCacheDay,
  isGenerating,
  isAutoVerifying,
  isBatchGenerating,
  dayProgress,
  dayJobs,
  isCacheLoading,
  onGenerate,
  onGenerateAllDays,
  onCancel,
  onCancelAll,
  onClearCache,
  verifications,
  verifyingDays,
  isVerifyingAll,
  onVerifyDay,
  onVerifyAll
}: GenerationControlsProps) {
  const cached = cacheStatus[currentCacheDay];
  // Queued + generating days have a live server job; the cache-checking phase
  // is cancellable too — the client aborts the flow before any job is created.
  const currentDayProgress = dayProgress[currentCacheDay];
  const isCurrentDayQueued = currentDayProgress === 'queued';
  const isCurrentDayCancellable = isCurrentDayQueued
    || currentDayProgress === 'generating'
    || currentDayProgress === 'verifying'
    || isCacheLoading;
  const currentJob = dayJobs[currentCacheDay];
  const currentAttempts = currentJob?.verificationAttempts || [];
  // A retry only exists once an attempt has been rejected, so the banner below
  // stays out of the way on the common single-attempt run.
  const retriedAttempts = currentAttempts.filter(attempt => attempt.status === 'failed');

  const timeAgo = cached ? (() => {
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - new Date(cached.generatedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  })() : '';

  const totalCachedCount = DAYS_OF_WEEK.filter(day => cacheStatus[day]?.isValid).length;

  const isCurrentDayVerifying = !!verifyingDays[currentCacheDay];
  // Only days that actually have a plan can be verified.
  const verifiableDays = DAYS_OF_WEEK.filter(day => cacheStatus[day]);
  const verifiedCount = verifiableDays.filter(day => verifications[day] && !verifyingDays[day]).length;
  const checkedDays = verifiableDays.filter(day => verifications[day]);
  const verificationSummary = checkedDays.length > 0 ? {
    checked: checkedDays.length,
    failing: checkedDays.filter(day => !verifications[day].ok).length,
    stale: checkedDays.filter(day => verifications[day].isStale).length
  } : null;

  return (
    <>
      <div className="generation-panel">
        <div className="generation-panel__head">
          <label className="form-label" style={{ margin: 0, fontSize: '0.8rem' }}>Target Day</label>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {totalCachedCount}/7 Days Cached
          </span>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <select
            className="form-input"
            value={config.selectedGenerationDay || 'MONDAY'}
            onChange={e => setSelectedGenerationDay(e.target.value)}
            aria-label="Target day"
          >
            {DAYS_OF_WEEK.map(day => {
              const ingredients = config.dailyVariables[day] || [];
              const variant = getDayVariantName(ingredients, config.meals.filter(m => !m.disabled));
              const isDayCached = cacheStatus[day]?.isValid;
              return (
                <option key={day} value={day}>
                  {isDayCached ? '✅' : '⚪'} {day} ({variant})
                </option>
              );
            })}
          </select>
        </div>

        {/* Per-day cache status chips */}
        <div className="day-status-grid">
          {DAYS_OF_WEEK.map(day => {
            const status = cacheStatus[day];
            const progress = dayProgress[day];
            const isCurrent = day === config.selectedGenerationDay;
            const { cls, label } = dayChipState(status, progress, day);

            const mark = verifyMark(verifications[day], !!verifyingDays[day]);

            return (
              <button
                key={day}
                className={`day-status-chip ${cls} ${isCurrent ? 'is-current' : ''}`}
                onClick={() => setSelectedGenerationDay(day)}
                title={
                  progress === 'verifying'
                    ? `${day}: verifying the generated plan${attemptCounter(dayJobs[day])}…`
                    : progress === 'generating' || progress === 'checking'
                      ? `${day}: generating${attemptCounter(dayJobs[day])}…`
                      : `${day}: ${status?.isValid ? 'Valid cache' : status ? 'Stale cache' : 'Not cached'}${mark ? ` — ${mark.title}` : ''}`
                }
              >
                {label}
                {mark && <span className={`day-verify-dot ${mark.cls}`} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="generation-actions">
        {cached && (
          <div className={`cache-status-bar ${cached.isValid ? 'cache-valid' : 'cache-stale'}`}>
            <div className="cache-status-bar__info">
              <span style={{ fontSize: '0.9rem' }} aria-hidden="true">{cached.isValid ? '✅' : '⚠️'}</span>
              <div style={{ minWidth: 0 }}>
                <span className="cache-status-bar__label">
                  {cached.isValid ? `${currentCacheDay} cached` : `${currentCacheDay} cache stale — config changed`}
                </span>
                <span className="cache-status-bar__time">Generated {timeAgo}</span>
              </div>
            </div>
            <button
              className="cache-action-btn cache-clear-btn"
              onClick={() => onClearCache(currentCacheDay)}
              title={`Delete ${currentCacheDay} cached response`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
              </svg>
              Clear
            </button>
          </div>
        )}

        <div className="generation-actions__row">
          <button
            className="btn-primary"
            disabled={isGenerating || isAutoVerifying || isCacheLoading || isCurrentDayQueued}
            onClick={() => onGenerate(false)}
          >
            {isAutoVerifying ? (
              <>
                <div className="spinner spinner--inline"></div>
                Verifying {config.selectedGenerationDay || 'Day'}{attemptCounter(currentJob)}...
              </>
            ) : isGenerating ? (
              <>
                <div className="spinner spinner--inline"></div>
                {currentJob && currentJob.generationAttempt > 1 ? 'Regenerating' : 'Generating'}{' '}
                {config.selectedGenerationDay || 'Day'}{attemptCounter(currentJob)}...
              </>
            ) : isCurrentDayQueued ? (
              <>
                <span aria-hidden="true">⏳</span>
                {config.selectedGenerationDay || 'Day'} Queued...
              </>
            ) : isCacheLoading ? (
              <>
                <div className="spinner spinner--inline"></div>
                Checking cache...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                </svg>
                Generate {config.selectedGenerationDay || 'Day'}
              </>
            )}
          </button>

          {isCurrentDayCancellable && (
            <button
              className="btn-cancel"
              onClick={() => onCancel(currentCacheDay)}
              title={`Stop generating ${currentCacheDay}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
              Cancel
            </button>
          )}

          {cacheStatus[currentCacheDay] && !isCurrentDayCancellable && (
            <button
              className="btn-regenerate"
              disabled={isGenerating || isAutoVerifying || isCacheLoading}
              onClick={() => onGenerate(true)}
              title="Skip cache and regenerate fresh"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M1 4v6h6M23 20v-6h-6"/>
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
              </svg>
              Regenerate
            </button>
          )}
        </div>

        <div className="generation-actions__row verify-actions">
          <button
            className="btn-verify"
            disabled={!cached || isCurrentDayVerifying || isVerifyingAll}
            onClick={() => onVerifyDay(currentCacheDay)}
            title={cached
              ? `Re-derive every number in the ${currentCacheDay} plan and compare it to what the plan claims`
              : `Generate ${currentCacheDay} first — there is no plan to verify`}
          >
            {isCurrentDayVerifying ? (
              <>
                <div className="spinner spinner--inline"></div>
                Verifying {currentCacheDay.substring(0, 3)}...
              </>
            ) : (
              <>
                <VerifyIcon size={15} />
                Verify {currentCacheDay.substring(0, 3)}
              </>
            )}
          </button>

          <button
            className="btn-verify btn-verify--all"
            disabled={isVerifyingAll || verifiableDays.length === 0}
            onClick={onVerifyAll}
            title={verifiableDays.length
              ? `Verify all ${verifiableDays.length} generated day(s)`
              : 'No generated plans to verify yet'}
          >
            {isVerifyingAll ? (
              <>
                <div className="spinner spinner--inline"></div>
                Verifying {verifiedCount}/{verifiableDays.length}...
              </>
            ) : (
              <>
                <VerifyIcon size={15} />
                Verify All ({verifiableDays.length})
              </>
            )}
          </button>
        </div>

        {retriedAttempts.length > 0 && (
          <div className={`retry-summary ${currentJob?.verificationOk ? 'is-resolved' : 'is-exhausted'}`}>
            {currentJob?.verificationOk
              ? `🔁 ${currentCacheDay} was regenerated ${retriedAttempts.length}× before it passed verification`
              : isCurrentDayCancellable
                ? `🔁 ${currentCacheDay}: ${retriedAttempts.length} attempt(s) rejected so far — regenerating`
                : `🔁 ${currentCacheDay} still failed after ${currentAttempts.length} attempt(s) — the last plan was kept`}
          </div>
        )}

        {verificationSummary && (
          <div className={`verify-summary ${verificationSummary.failing > 0 ? 'has-failures' : 'all-clear'}`}>
            {verificationSummary.failing > 0
              ? `⚠️ ${verificationSummary.failing} of ${verificationSummary.checked} checked day(s) failed verification`
              : `✅ ${verificationSummary.checked} day(s) verified clean`}
            {verificationSummary.stale > 0 && ` · ${verificationSummary.stale} stale`}
          </div>
        )}

        {isBatchGenerating ? (
          <button
            className="btn-cancel btn-batch"
            onClick={onCancelAll}
            title="Cancel all running day generations"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            Cancel All Generations
          </button>
        ) : (
          <button
            className="btn-secondary btn-batch"
            onClick={onGenerateAllDays}
            title="Generate all 7 days concurrently in parallel and store each in cache"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            ⚡ Generate All 7 Days (Parallel)
          </button>
        )}
      </div>
    </>
  );
}
