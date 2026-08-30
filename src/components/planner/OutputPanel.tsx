'use client';
import { useState } from 'react';
import { DayProgress, DAYS_OF_WEEK } from '@/lib/types';
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
  dayProgress: Record<string, DayProgress>;
  isCachedResponse: boolean;
  onGenerate: (forceRegenerate?: boolean) => void;
  onGenerateAllDays: () => void;
  onRegenerateDay: (day: string) => void;
  hidden?: boolean;
}

function RegenerateIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 4v6h6M23 20v-6h-6"/>
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
    </svg>
  );
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Day
        </>
      )}
    </button>
  );
}

/** Chip colouring for one day, driven by its cache entry and live progress. */
function dayChipState(status: CacheEntryStatus | undefined, progress: DayProgress | undefined, day: string) {
  const abbr = day.substring(0, 3);
  const busy = progress === 'generating' || progress === 'checking';
  if (busy) return { bg: 'rgba(192, 132, 252, 0.2)', color: '#c084fc', label: `⌛ ${abbr}`, busy };
  if (progress === 'error') return { bg: 'rgba(244, 63, 94, 0.2)', color: '#fda4af', label: `❌ ${abbr}`, busy };
  if (status?.isValid) return { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', label: `✓ ${abbr}`, busy };
  if (status) return { bg: 'rgba(245, 158, 11, 0.15)', color: '#fcd34d', label: `! ${abbr}`, busy };
  return { bg: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', label: abbr, busy };
}

function formatErrorMessage(msg: string): string {
  if (!msg) return '';
  try {
    const parsed = JSON.parse(msg);
    if (parsed && typeof parsed === 'object') {
      if (parsed.error && typeof parsed.error === 'object') {
        const status = parsed.error.status ? `[${parsed.error.status}] ` : '';
        const code = parsed.error.code ? `(${parsed.error.code}) ` : '';
        const details = parsed.error.message || JSON.stringify(parsed.error);
        return `${status}${code}${details}`.trim();
      }
      if (parsed.message) return parsed.message;
    }
  } catch {
    // Plain string error
  }
  return msg;
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
  dayProgress,
  isCachedResponse,
  onGenerate,
  onGenerateAllDays,
  onRegenerateDay,
  hidden = false
}: OutputPanelProps) {
  const isCurrentDayBusy = isGenerating || dayProgress[selectedDay] === 'checking';
  // Days differ in whether they carry thinking output — fall back to the plan
  // tab instead of rendering an empty panel after switching days.
  const activeTab: OutputTab = outputTab === 'thoughts' && !thinkingText ? 'user' : outputTab;

  return (
    <section className="glass-panel output-panel" style={{ display: hidden ? 'none' : 'flex' }}>
      {/* Day switcher toolbar — scrolls sideways on phones, wraps on desktop */}
      <div className="output-toolbar">
        <div className="day-chip-row">
          <span className="day-chip-row__label">Day:</span>
          {DAYS_OF_WEEK.map(day => {
            const status = cacheStatus[day];
            const isCurrent = day === selectedDay;
            const { bg, color, label, busy } = dayChipState(status, dayProgress[day], day);
            const hasPlan = !!status;

            return (
              <div
                key={day}
                className={`day-chip-group ${isCurrent ? 'is-current' : ''}`}
                style={{
                  background: isCurrent ? (status?.isValid ? 'rgba(34, 197, 94, 0.2)' : 'rgba(192, 132, 252, 0.25)') : bg,
                  color: isCurrent ? '#fff' : color
                }}
              >
                <button
                  className="day-chip"
                  onClick={() => onSelectDay(day)}
                  title={
                    busy
                      ? `${day}: generating…`
                      : `${day}: ${status?.isValid ? 'Valid cache' : status ? 'Stale cache' : 'Not generated'}`
                  }
                >
                  {label}
                </button>
                <button
                  className="day-chip-regen"
                  disabled={busy}
                  onClick={() => onRegenerateDay(day)}
                  title={
                    busy
                      ? `${day} is already generating…`
                      : hasPlan
                        ? `Regenerate ${day} — ignores the cached plan`
                        : `Generate ${day}`
                  }
                  aria-label={hasPlan ? `Regenerate ${day}` : `Generate ${day}`}
                >
                  <RegenerateIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Quick action for the day on screen: generate it, or redo it fresh */}
        <div className="output-toolbar__actions">
          {!outputText && !isCurrentDayBusy ? (
            <button
              className="btn-primary btn-primary--sm"
              disabled={isCurrentDayBusy}
              onClick={() => errorMsg ? onRegenerateDay(selectedDay) : onGenerate(false)}
            >
              {errorMsg ? (
                <>
                  <RegenerateIcon size={12} />
                  Retry {selectedDay.substring(0, 3)}
                </>
              ) : (
                `Generate ${selectedDay}`
              )}
            </button>
          ) : (
            <button
              className="btn-regenerate btn-regenerate--sm"
              disabled={isCurrentDayBusy}
              onClick={() => onRegenerateDay(selectedDay)}
              title={`Regenerate ${selectedDay} — ignores the cached plan`}
            >
              <RegenerateIcon size={13} />
              Regenerate {selectedDay.substring(0, 3)}
            </button>
          )}
        </div>
      </div>

      {/* Part 1 / Part 2 / Thinking Tabs */}
      <div className="output-header-tabs">
        <div className="output-tab-list" role="tablist">
          {thinkingText && (
            <button
              role="tab"
              aria-selected={activeTab === 'thoughts'}
              className={`output-tab ${activeTab === 'thoughts' ? 'active' : ''}`}
              onClick={() => setOutputTab('thoughts')}
            >
              <span className="label-short">Thinking</span>
              <span className="label-long">Thinking Process</span>
            </button>
          )}
          <button
            role="tab"
            aria-selected={activeTab === 'user'}
            className={`output-tab ${activeTab === 'user' ? 'active' : ''}`}
            onClick={() => setOutputTab('user')}
          >
            <span className="label-short">For Me</span>
            <span className="label-long">Part 1: For Myself ({selectedDay})</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'cook'}
            className={`output-tab ${activeTab === 'cook' ? 'active' : ''}`}
            onClick={() => setOutputTab('cook')}
          >
            <span className="label-short">For Cook</span>
            <span className="label-long">Part 2: For Cook ({selectedDay})</span>
          </button>
        </div>

        {isCurrentDayBusy && (
          <div className="output-status">
            <div className="spinner spinner--xs"></div>
            <span style={{ opacity: 0.9 }}>Generating {selectedDay}...</span>
          </div>
        )}
        {isBatchGenerating && !isCurrentDayBusy && (
          <div className="output-status">
            <div className="spinner spinner--xs"></div>
            <span style={{ opacity: 0.9 }}>Generating All 7 Days...</span>
          </div>
        )}
        {isCachedResponse && !isCurrentDayBusy && outputText && (
          <div className="cache-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <path d="M22 4L12 14.01l-3-3"/>
            </svg>
            {selectedDay} Cached
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="error-banner">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <div className="error-banner__title" style={{ margin: 0 }}>Generation Error ({selectedDay})</div>
            <button
              className="btn-regenerate btn-regenerate--sm"
              disabled={isCurrentDayBusy}
              onClick={() => onRegenerateDay(selectedDay)}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              <RegenerateIcon size={12} />
              Retry {selectedDay}
            </button>
          </div>
          <div style={{ wordBreak: 'break-word', fontSize: '0.85rem' }}>
            {formatErrorMessage(errorMsg)}
          </div>
        </div>
      )}

      <div className="output-body">
        {isCurrentDayBusy && !outputText && !thinkingText ? (
          <div className="loading-container" style={{ flex: 1 }}>
            <div className="spinner"></div>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
              Gemini is calculating plan for {selectedDay}...
            </p>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
          </div>
        ) : outputText || thinkingText ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {activeTab === 'thoughts' && thinkingText && (
              <div className="thinking-box">
                <div className="thinking-title">Gemini Thinking Output ({selectedDay})</div>
                <div className="thinking-text">
                  {thinkingText}
                </div>
              </div>
            )}

            {activeTab === 'user' && (
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(outputText) }}
              />
            )}

            {activeTab === 'cook' && (
              <div className="cook-plan">
                <div className="cook-plan__head">
                  <span>Copy-pasteable cook instructions for {selectedDay}</span>
                </div>

                <div className="cook-plan__list">
                  {parseCookPlanDays(getCookPlanOnly(outputText)).map((dayObj, idx) => (
                    <div key={idx} className="cook-day-card">
                      <div className="cook-day-card__head">
                        <h4 className="cook-day-card__title">
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
                      <pre>{dayObj.content}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="placeholder-container">
            <div className="placeholder-icon">{errorMsg ? '⚠️' : '📋'}</div>
            <h3 className="placeholder-title">
              {errorMsg ? `Generation Failed for ${selectedDay}` : `No Plan Generated for ${selectedDay} Yet`}
            </h3>
            <p className="placeholder-text">
              {errorMsg
                ? `An error occurred while calculating the diet plan for ${selectedDay}. Click below to retry.`
                : `Tap below to generate a calculated diet plan for ${selectedDay}, or generate all 7 days at once.`}
            </p>

            <div className="placeholder-actions">
              <button
                className="btn-primary"
                disabled={isCurrentDayBusy}
                onClick={() => errorMsg ? onRegenerateDay(selectedDay) : onGenerate(false)}
              >
                {errorMsg ? <RegenerateIcon size={14} /> : null}
                {errorMsg ? `Retry ${selectedDay} Plan` : `Generate ${selectedDay} Plan`}
              </button>
              <button
                className="btn-secondary btn-batch"
                disabled={isBatchGenerating}
                onClick={onGenerateAllDays}
              >
                ⚡ Generate All 7 Days
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
