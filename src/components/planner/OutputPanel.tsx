'use client';
import { useState } from 'react';
import { DAYS_OF_WEEK } from '@/lib/types';
import { CacheEntryStatus } from '@/hooks/useDietCache';
import { renderMarkdown, getCookPlanOnly, parseCookPlanDays } from '@/lib/markdown';

export type OutputTab = 'user' | 'cook' | 'thoughts';

interface OutputPanelProps {
  selectedDay: string;
  onSelectDay: (day: string) => void;
  cacheStatus: Record<string, CacheEntryStatus>;
  outputText: string;
  thinkingText: string;
  outputTab: OutputTab;
  setOutputTab: (tab: OutputTab) => void;
  errorMsg: string;
  isGenerating: boolean;
  isBatchGenerating: boolean;
  batchProgress: Record<string, 'pending' | 'generating' | 'done' | 'error'>;
  isCachedResponse: boolean;
  onGenerate: (forceRegenerate?: boolean) => void;
  onGenerateAllDays: () => void;
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
  selectedDay,
  onSelectDay,
  cacheStatus,
  outputText,
  thinkingText,
  outputTab,
  setOutputTab,
  errorMsg,
  isGenerating,
  isBatchGenerating,
  batchProgress,
  isCachedResponse,
  onGenerate,
  onGenerateAllDays,
  hidden = false
}: OutputPanelProps) {
  const isBusy = isGenerating || isBatchGenerating;

  return (
    <section className="glass-panel" style={{ display: hidden ? 'none' : 'flex', minHeight: '500px', flexDirection: 'column' }}>
      {/* Day Switcher Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '0.75rem',
        marginBottom: '0.75rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginRight: '0.25rem' }}>
            Day:
          </span>
          {DAYS_OF_WEEK.map(day => {
            const status = cacheStatus[day];
            const isCurrent = day === selectedDay;
            const progress = batchProgress[day];

            let badgeBg = 'rgba(255,255,255,0.03)';
            let badgeColor = 'var(--text-muted)';
            let label = day.substring(0, 3);

            if (progress === 'generating') {
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
                onClick={() => onSelectDay(day)}
                style={{
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.75rem',
                  borderRadius: '6px',
                  border: isCurrent ? '1.5px solid #c084fc' : '1px solid rgba(255,255,255,0.06)',
                  background: isCurrent ? (status?.isValid ? 'rgba(34, 197, 94, 0.2)' : 'rgba(192, 132, 252, 0.25)') : badgeBg,
                  color: isCurrent ? '#fff' : badgeColor,
                  cursor: 'pointer',
                  fontWeight: isCurrent ? 700 : 500,
                  transition: 'all 0.15s ease'
                }}
                title={`${day}: ${status?.isValid ? 'Valid cache' : status ? 'Stale cache' : 'Not generated'}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Quick action button inside header if not generated or for quick generation */}
        {!outputText && !isBusy && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className="btn-primary"
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
              onClick={() => onGenerate(false)}
            >
              Generate {selectedDay}
            </button>
          </div>
        )}
      </div>

      {/* Part 1 / Part 2 / Thinking Tabs */}
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
            Part 1: For Myself ({selectedDay})
          </button>
          <button
            className={`output-tab ${outputTab === 'cook' ? 'active' : ''}`}
            onClick={() => setOutputTab('cook')}
          >
            Part 2: For Cook ({selectedDay})
          </button>
        </div>
        {isGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', color: '#c084fc', fontSize: '0.85rem', fontWeight: 600 }}>
            <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', boxShadow: 'none', margin: 0 }}></div>
            <span style={{ opacity: 0.9 }}>Generating {selectedDay}...</span>
          </div>
        )}
        {isBatchGenerating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', color: '#c084fc', fontSize: '0.85rem', fontWeight: 600 }}>
            <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', boxShadow: 'none', margin: 0 }}></div>
            <span style={{ opacity: 0.9 }}>Generating All 7 Days...</span>
          </div>
        )}
        {isCachedResponse && !isBusy && outputText && (
          <div className="cache-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <path d="M22 4L12 14.01l-3-3"/>
            </svg>
            {selectedDay} Cached
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
        {isBusy && !outputText && !thinkingText ? (
          <div className="loading-container" style={{ flex: 1 }}>
            <div className="spinner"></div>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
              {isBatchGenerating ? 'Generating all 7 days in parallel...' : `Gemini is calculating plan for ${selectedDay}...`}
            </p>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
          </div>
        ) : outputText || thinkingText ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {outputTab === 'thoughts' && thinkingText && (
              <div className="thinking-box" style={{ flex: 1 }}>
                <div className="thinking-title">Gemini Thinking Output ({selectedDay})</div>
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
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Copy-pasteable cook instructions for {selectedDay}
                  </span>
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
          <div className="placeholder-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div className="placeholder-icon" style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
            <h3 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>
              No Plan Generated for {selectedDay} Yet
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '360px', textAlign: 'center', marginBottom: '1.25rem' }}>
              Click below to generate a calculated diet plan for {selectedDay}, or generate all 7 days at once.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                className="btn-primary"
                disabled={isBusy}
                onClick={() => onGenerate(false)}
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
              >
                Generate {selectedDay} Plan
              </button>
              <button
                className="btn-secondary"
                disabled={isBusy}
                onClick={onGenerateAllDays}
                style={{
                  padding: '0.5rem 1.25rem',
                  fontSize: '0.85rem',
                  background: 'rgba(192, 132, 252, 0.15)',
                  border: '1px solid rgba(192, 132, 252, 0.3)',
                  color: '#e9d5ff'
                }}
              >
                ⚡ Generate All 7 Days (Parallel)
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
