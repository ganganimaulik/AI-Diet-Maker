'use client';

interface BuilderHistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** Undo / Redo for Diet Builder edits. Icon-only on small phones. */
export default function BuilderHistoryControls({ canUndo, canRedo, onUndo, onRedo }: BuilderHistoryControlsProps) {
  return (
    <div className="history-controls">
      <button
        type="button"
        className="history-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo last change"
        aria-label="Undo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M9 14 4 9l5-5"/>
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
        </svg>
        <span className="history-btn__label">Undo</span>
      </button>
      <button
        type="button"
        className="history-btn"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        aria-label="Redo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m15 14 5-5-5-5"/>
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>
        </svg>
        <span className="history-btn__label">Redo</span>
      </button>
    </div>
  );
}
