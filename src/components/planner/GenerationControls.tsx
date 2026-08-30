'use client';
import { Config, DayProgress, DAYS_OF_WEEK } from '@/lib/types';
import { getDayVariantName } from '@/lib/compile-prompt';
import { CacheEntryStatus } from '@/hooks/useDietCache';

interface GenerationControlsProps {
  config: Config;
  setSelectedGenerationDay: (day: string) => void;
  cacheStatus: Record<string, CacheEntryStatus>;
  currentCacheDay: string;
  isGenerating: boolean;
  isBatchGenerating: boolean;
  dayProgress: Record<string, DayProgress>;
  isCacheLoading: boolean;
  onGenerate: (forceRegenerate: boolean) => void;
  onGenerateAllDays: () => void;
  onClearCache: (day?: string) => void;
}

/** Maps a day's cache/progress state onto a chip modifier and short label. */
function dayChipState(status: CacheEntryStatus | undefined, progress: DayProgress | undefined, day: string) {
  const abbr = day.substring(0, 3);
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
  isBatchGenerating,
  dayProgress,
  isCacheLoading,
  onGenerate,
  onGenerateAllDays,
  onClearCache
}: GenerationControlsProps) {
  const cached = cacheStatus[currentCacheDay];

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

            return (
              <button
                key={day}
                className={`day-status-chip ${cls} ${isCurrent ? 'is-current' : ''}`}
                onClick={() => setSelectedGenerationDay(day)}
                title={
                  progress === 'generating' || progress === 'checking'
                    ? `${day}: generating…`
                    : `${day}: ${status?.isValid ? 'Valid cache' : status ? 'Stale cache' : 'Not cached'}`
                }
              >
                {label}
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
            disabled={isGenerating || isCacheLoading}
            onClick={() => onGenerate(false)}
          >
            {isGenerating ? (
              <>
                <div className="spinner spinner--inline"></div>
                Generating {config.selectedGenerationDay || 'Day'}...
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

          {cacheStatus[currentCacheDay] && (
            <button
              className="btn-regenerate"
              disabled={isGenerating || isCacheLoading}
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

        <button
          className="btn-secondary btn-batch"
          disabled={isBatchGenerating}
          onClick={onGenerateAllDays}
          title="Generate all 7 days concurrently in parallel and store each in cache"
        >
          {isBatchGenerating ? (
            <>
              <div className="spinner spinner--inline"></div>
              Generating All 7 Days (Parallel)...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              ⚡ Generate All 7 Days (Parallel)
            </>
          )}
        </button>
      </div>
    </>
  );
}
