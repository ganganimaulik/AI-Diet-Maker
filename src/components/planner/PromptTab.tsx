'use client';

interface PromptTabProps {
  activePrompt: string;
  isCustomMode: boolean;
  setIsCustomMode: (value: boolean) => void;
  setCustomPrompt: (value: string) => void;
}

export default function PromptTab({ activePrompt, isCustomMode, setIsCustomMode, setCustomPrompt }: PromptTabProps) {
  return (
    <div>
      <div className="builder-subheading">
        <label className="form-label" style={{ margin: 0 }}>Active LLM Prompt Text</label>
        <button
          type="button"
          className={`switch-container ${isCustomMode ? 'checked' : ''}`}
          role="switch"
          aria-checked={isCustomMode}
          style={{ background: 'none', border: 'none', padding: 0, color: 'inherit' }}
          onClick={() => setIsCustomMode(!isCustomMode)}
        >
          <span className="switch-control"></span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Edit Prompt Directly</span>
        </button>
      </div>

      <textarea
        className={`prompt-preview-body ${isCustomMode ? 'editable' : ''}`}
        value={activePrompt}
        disabled={!isCustomMode}
        onChange={e => setCustomPrompt(e.target.value)}
      />
      {!isCustomMode && (
        <p className="note-text">
          {'Auto-compiling from form fields above. Enable "Edit Prompt Directly" to tweak instructions manually.'}
        </p>
      )}
    </div>
  );
}
