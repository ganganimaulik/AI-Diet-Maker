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
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '10px', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label className="form-label" style={{ margin: 0, fontSize: '0.8rem' }}>Target Day</label>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {totalCachedCount}/7 Days Cached
          </span>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <select
            className="form-input"
            style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem', fontWeight: 600 }}
            value={config.selectedGenerationDay || 'MONDAY'}
            onChange={e => setSelectedGenerationDay(e.target.value)}
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
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          {DAYS_OF_WEEK.map(day => {
            const status = cacheStatus[day];
            const isCurrent = day === config.selectedGenerationDay;
            const progress = dayProgress[day];

            let badgeBg = 'rgba(255,255,255,0.04)';
            let badgeColor = 'var(--text-muted)';
            let label = day.substring(0, 3);

            if (progress === 'generating' || progress === 'checking') {
              badgeBg = 'rgba(192, 132, 252, 0.2)';
              badgeColor = '#c084fc';
              label = `⌛ ${day.substring(0, 3)}`;
            } else if (progress === 'error') {
              badgeBg = 'rgba(244, 63, 94, 0.2)';
              badgeColor = '#fda4af';
              label = `❌ ${day.substring(0, 3)}`;
            } else if (status?.isValid) {
              badgeBg = 'rgba(34, 197, 94, 0.15)';
              badgeColor = '#4ade80';
              label = `✓ ${day.substring(0, 3)}`;
            } else if (status && !status.isValid) {
              badgeBg = 'rgba(245, 158, 11, 0.15)';
              badgeColor = '#fcd34d';
              label = `! ${day.substring(0, 3)}`;
            }

            return (
              <button
                key={day}
                onClick={() => setSelectedGenerationDay(day)}
                style={{
                  padding: '0.2rem 0.45rem',
                  fontSize: '0.7rem',
                  borderRadius: '4px',
                  border: isCurrent ? '1px solid #c084fc' : '1px solid transparent',
                  background: badgeBg,
                  color: badgeColor,
                  cursor: 'pointer',
                  fontWeight: isCurrent ? 700 : 500
                }}
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

      <div style={{ marginTop: '1.25rem' }}>
        {cached && (
          <div className={`cache-status-bar ${cached.isValid ? 'cache-valid' : 'cache-stale'}`} style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
              <span style={{ fontSize: '0.9rem' }}>{cached.isValid ? '✅' : '⚠️'}</span>
              <div>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                  {cached.isValid ? `${currentCacheDay} cached` : `${currentCacheDay} cache stale — config changed`}
                </span>
                <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: '0.5rem' }}>Generated {timeAgo}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                className="cache-action-btn cache-clear-btn"
                onClick={() => onClearCache(currentCacheDay)}
                title={`Delete ${currentCacheDay} cached response`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                </svg>
                Clear
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              disabled={isGenerating || isBatchGenerating || isCacheLoading}
              onClick={() => onGenerate(false)}
            >
              {isGenerating ? (
                <>
                  <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                  Generating {config.selectedGenerationDay || 'Day'}...
                </>
              ) : isCacheLoading ? (
                <>
                  <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                  Checking cache...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  </svg>
                  Generate {config.selectedGenerationDay || 'Day'}
                </>
              )}
            </button>

            {cacheStatus[currentCacheDay] && (
              <button
                className="btn-regenerate"
                disabled={isGenerating || isBatchGenerating || isCacheLoading}
                onClick={() => onGenerate(true)}
                title="Skip cache and regenerate fresh"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 4v6h6M23 20v-6h-6"/>
                  <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                </svg>
                Regenerate
              </button>
            )}
          </div>

          <button
            className="btn-secondary"
            style={{
              width: '100%',
              padding: '0.55rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              background: 'rgba(192, 132, 252, 0.12)',
              border: '1px solid rgba(192, 132, 252, 0.25)',
              color: '#e9d5ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
            disabled={isBatchGenerating}
            onClick={onGenerateAllDays}
            title="Generate all 7 days concurrently in parallel and store each in cache"
          >
            {isBatchGenerating ? (
              <>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: '#e9d5ff', boxShadow: 'none' }}></div>
                Generating All 7 Days (Parallel)...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      </div>
    </>
  );
}
