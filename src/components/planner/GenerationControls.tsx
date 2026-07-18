'use client';
import { Config, DAYS_OF_WEEK } from '@/lib/types';
import { getDayVariantName } from '@/lib/compile-prompt';
import { CacheEntryStatus } from '@/hooks/useDietCache';

interface GenerationControlsProps {
  config: Config;
  setGenerationRange: (range: 'all' | 'single') => void;
  setSelectedGenerationDay: (day: string) => void;
  cacheStatus: Record<string, CacheEntryStatus>;
  currentCacheDay: string;
  isGenerating: boolean;
  isCacheLoading: boolean;
  onGenerate: (forceRegenerate: boolean) => void;
  onClearCache: (day: string) => void;
}

export default function GenerationControls({
  config,
  setGenerationRange,
  setSelectedGenerationDay,
  cacheStatus,
  currentCacheDay,
  isGenerating,
  isCacheLoading,
  onGenerate,
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

  return (
    <>
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '10px', marginTop: '1.5rem' }}>
        <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontSize: '0.8rem' }}>Generation Scope</label>
        <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input
              type="radio"
              name="generationRange"
              checked={config.generationRange === 'all'}
              onChange={() => setGenerationRange('all')}
            />
            All Days (Full Week)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input
              type="radio"
              name="generationRange"
              checked={config.generationRange === 'single'}
              onChange={() => setGenerationRange('single')}
            />
            Single Day Only
          </label>
        </div>

        {config.generationRange === 'single' && (
          <div className="form-group" style={{ margin: 0, marginTop: '0.75rem' }}>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Choose Day</label>
            <select
              className="form-input"
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
              value={config.selectedGenerationDay}
              onChange={e => setSelectedGenerationDay(e.target.value)}
            >
              {DAYS_OF_WEEK.map(day => {
                const ingredients = config.dailyVariables[day] || [];
                const variant = getDayVariantName(ingredients, config.meals.filter(m => !m.disabled));
                return (
                  <option key={day} value={day}>
                    {day} ({variant})
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        {cached && (
          <div className={`cache-status-bar ${cached.isValid ? 'cache-valid' : 'cache-stale'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
              <span style={{ fontSize: '0.9rem' }}>{cached.isValid ? '✅' : '⚠️'}</span>
              <div>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                  {cached.isValid ? 'Cached response available' : 'Cache stale — config changed'}
                </span>
                <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: '0.5rem' }}>Generated {timeAgo}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                className="cache-action-btn cache-clear-btn"
                onClick={() => onClearCache(currentCacheDay)}
                title="Delete cached response"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                </svg>
                Clear
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={isGenerating || isCacheLoading}
            onClick={() => onGenerate(false)}
          >
            {isGenerating ? (
              <>
                <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                Calculating &amp; Generating...
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
                Generate Diet Plan
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6M23 20v-6h-6"/>
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
              </svg>
              Regenerate
            </button>
          )}
        </div>
      </div>
    </>
  );
}
