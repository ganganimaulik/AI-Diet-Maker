'use client';

import { useState } from 'react';

interface PromptTabProps {
  activePrompt: string;
  isCustomMode: boolean;
  setIsCustomMode: (value: boolean) => void;
  setCustomPrompt: (value: string) => void;
}

export default function PromptTab({ activePrompt, isCustomMode, setIsCustomMode, setCustomPrompt }: PromptTabProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activePrompt);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }

    window.setTimeout(() => setCopyStatus('idle'), 2000);
  };

  return (
    <div>
      <div className="builder-subheading">
        <label className="form-label" style={{ margin: 0 }}>Active LLM Prompt Text</label>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className={`cook-copy-btn ${copyStatus === 'copied' ? 'copied' : ''}`}
            onClick={handleCopy}
            aria-live="polite"
          >
            {copyStatus === 'copied' ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copyStatus === 'failed' ? 'Copy failed' : 'Copy Prompt'}
              </>
            )}
          </button>
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
