'use client';

export type LayoutMode = 'builder' | 'results' | 'split';

interface LayoutModeToggleProps {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  hasOutput: boolean;
}

export default function LayoutModeToggle({ layoutMode, setLayoutMode, hasOutput }: LayoutModeToggleProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
      <div className="layout-toggle-group">
        <button
          className={`layout-toggle-btn ${layoutMode === 'builder' ? 'active' : ''}`}
          onClick={() => setLayoutMode('builder')}
          title="Show only the Diet Builder form"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 20h9M3 20h.01M3 16h.01M3 12h.01M3 8h.01M3 4h.01M7 4h14M7 9h14M7 14h14"/>
          </svg>
          Diet Builder Form
        </button>
        <button
          className={`layout-toggle-btn ${layoutMode === 'results' ? 'active' : ''}`}
          onClick={() => setLayoutMode('results')}
          title="Show only the Generated Diet Plan outputs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          Generated Plan
          {hasOutput && (
            <span className="results-dot-indicator" style={{ marginLeft: '0.25rem' }}></span>
          )}
        </button>
        <button
          className={`layout-toggle-btn ${layoutMode === 'split' ? 'active' : ''}`}
          onClick={() => setLayoutMode('split')}
          title="Show Builder and Generated Plan side-by-side"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
          </svg>
          Split Screen
        </button>
      </div>
    </div>
  );
}
