'use client';
import { useState } from 'react';
import { renderMarkdown, getCookPlanOnly, parseCookPlanDays } from '@/lib/markdown';

export type OutputTab = 'user' | 'cook' | 'thoughts';

interface OutputPanelProps {
  outputText: string;
  thinkingText: string;
  outputTab: OutputTab;
  setOutputTab: (tab: OutputTab) => void;
  errorMsg: string;
  isGenerating: boolean;
  isCachedResponse: boolean;
  hidden?: boolean;
}

function DayCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      className={`cook-copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Day
        </>
      )}
    </button>
  );
}

export default function OutputPanel({
  outputText,
  thinkingText,
  outputTab,
  setOutputTab,
  errorMsg,
  isGenerating,
  isCachedResponse,
  hidden = false
}: OutputPanelProps) {
  return (
    <section className="glass-panel" style={{ display: hidden ? 'none' : 'flex', minHeight: '500px', flexDirection: 'column' }}>
      <div className="output-header-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          {thinkingText && (
            <button
              className={`output-tab ${outputTab === 'thoughts' ? 'active' : ''}`}
              onClick={() => setOutputTab('thoughts')}
            >
              Thinking Process
            </button>
          )}
          <button
            className={`output-tab ${outputTab === 'user' ? 'active' : ''}`}
            onClick={() => setOutputTab('user')}
          >
            Part 1: For Myself
          </button>
          <button
            className={`output-tab ${outputTab === 'cook' ? 'active' : ''}`}
            onClick={() => setOutputTab('cook')}
          >
            Part 2: For Cook
          </button>
        </div>
        {isGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', color: '#c084fc', fontSize: '0.85rem', fontWeight: 600 }}>
            <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', boxShadow: 'none', margin: 0 }}></div>
            <span style={{ opacity: 0.9 }}>Streaming...</span>
          </div>
        )}
        {isCachedResponse && !isGenerating && outputText && (
          <div className="cache-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <path d="M22 4L12 14.01l-3-3"/>
            </svg>
            Cached
          </div>
        )}
      </div>

      {errorMsg && (
        <div style={{ background: 'rgba(244, 63, 94, 0.1)', borderLeft: '4px solid var(--accent-rose)', color: '#fda4af', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Generation Error</div>
          {errorMsg}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {isGenerating && !outputText && !thinkingText ? (
          <div className="loading-container" style={{ flex: 1 }}>
            <div className="spinner"></div>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Gemini is solving calculations...</p>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
          </div>
        ) : outputText || thinkingText ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {outputTab === 'thoughts' && thinkingText && (
              <div className="thinking-box" style={{ flex: 1 }}>
                <div className="thinking-title">Gemini Thinking Output</div>
                <div className="thinking-text" style={{ maxHeight: 'none', height: '430px' }}>
                  {thinkingText}
                </div>
              </div>
            )}

            {outputTab === 'user' && (
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(outputText) }}
              />
            )}

            {outputTab === 'cook' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Each day can be copied individually below</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '500px', paddingRight: '0.25rem' }}>
                  {parseCookPlanDays(getCookPlanOnly(outputText)).map((dayObj, idx) => (
                    <div key={idx} style={{
                      padding: '1.25rem',
                      background: 'rgba(255,255,255,0.015)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '12px',
                      transition: 'all var(--transition-fast)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                        <h4 style={{ margin: 0, color: '#c084fc', fontSize: '0.9rem', fontWeight: 700 }}>
                          {dayObj.heading.replace('###', '').trim()}
                        </h4>
                        <DayCopyButton
                          text={(() => {
                            const colonIndex = dayObj.heading.indexOf(':');
                            const variant = colonIndex !== -1 ? dayObj.heading.substring(colonIndex + 1).trim() : '';
                            return variant ? `${variant}\n${dayObj.content}` : dayObj.content;
                          })()}
                        />
                      </div>
                      <pre style={{
                        background: 'rgba(0,0,0,0.2)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                        lineHeight: '1.6',
                        margin: 0
                      }}>
                        {dayObj.content}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="placeholder-container" style={{ flex: 1 }}>
            <div className="placeholder-icon">📋</div>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '1rem' }}>No Plan Generated Yet</h3>
            <p style={{ fontSize: '0.85rem', maxWidth: '300px' }}>
              {'Configure your targets and variables in the left builder and click "Generate Diet Plan".'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
