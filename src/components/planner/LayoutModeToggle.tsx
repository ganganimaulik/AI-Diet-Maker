'use client';

export type LayoutMode = 'builder' | 'results';

interface LayoutModeToggleProps {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  hasOutput: boolean;
}

/**
 * Builder ⇄ Generated Plan switch. On phones this is the app's main
 * navigation, so it sticks to the top of the viewport while you scroll.
 */
export default function LayoutModeToggle({ layoutMode, setLayoutMode, hasOutput }: LayoutModeToggleProps) {
  return (
    <div className="layout-switch">
      <div className="layout-toggle-group" role="tablist" aria-label="Switch between the builder and the generated plan">
        <button
          role="tab"
          aria-selected={layoutMode === 'builder'}
          className={`layout-toggle-btn ${layoutMode === 'builder' ? 'active' : ''}`}
          onClick={() => setLayoutMode('builder')}
          title="Show only the Diet Builder form"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 20h9M3 20h.01M3 16h.01M3 12h.01M3 8h.01M3 4h.01M7 4h14M7 9h14M7 14h14"/>
          </svg>
          <span className="label-short">Builder</span>
          <span className="label-long">Diet Builder Form</span>
        </button>
        <button
          role="tab"
          aria-selected={layoutMode === 'results'}
          className={`layout-toggle-btn ${layoutMode === 'results' ? 'active' : ''}`}
          onClick={() => setLayoutMode('results')}
          title="Show only the Generated Diet Plan outputs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span className="label-short">Plan</span>
          <span className="label-long">Generated Plan</span>
          {hasOutput && <span className="results-dot-indicator" aria-hidden="true"></span>}
        </button>
      </div>
    </div>
  );
}
