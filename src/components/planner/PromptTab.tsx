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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label className="form-label" style={{ margin: 0 }}>Active LLM Prompt Text</label>
        <div
          className={`switch-container ${isCustomMode ? 'checked' : ''}`}
          onClick={() => setIsCustomMode(!isCustomMode)}
        >
          <div className="switch-control" style={{ transform: 'scale(0.8)' }}></div>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Edit Prompt Directly</span>
        </div>
      </div>

      <textarea
        className={`prompt-preview-body ${isCustomMode ? 'editable' : ''}`}
        style={{ height: '350px' }}
        value={activePrompt}
        disabled={!isCustomMode}
        onChange={e => setCustomPrompt(e.target.value)}
      />
      {!isCustomMode && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
          {'Auto-compiling from form fields above. Enable "Edit Prompt Directly" to tweak instructions manually.'}
        </p>
      )}
    </div>
  );
}
