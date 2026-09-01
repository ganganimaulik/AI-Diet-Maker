'use client';
import { useState } from 'react';
import { DayProgress, DayVerification, GenerationJob, DAYS_OF_WEEK } from '@/lib/types';
import { CacheEntryStatus } from '@/hooks/useDietCache';
import { renderMarkdown, getCookPlanOnly, parseCookPlanDays } from '@/lib/markdown';
import VerificationReport from './VerificationReport';

export type OutputTab = 'user' | 'cook' | 'thoughts' | 'verify';

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
  dayJobs: Record<string, GenerationJob>;
  isCachedResponse: boolean;
  onGenerate: (forceRegenerate?: boolean) => void;
  onGenerateAllDays: () => void;
  onRegenerateDay: (day: string) => void;
  onCancelDay: (day: string) => void;
  hidden?: boolean;
  provider?: string;
  verifications: Record<string, DayVerification>;
  verifyingDays: Record<string, boolean>;
  verifyErrors: Record<string, string>;
  onVerifyDay: (day: string) => void;
}

function formatProviderLabel(provider?: string): string {
  if (provider === 'fireworks') return 'Fireworks';
  if (provider === 'gemini-enterprise') return 'Gemini Enterprise';
  return 'Gemini';
}

function RegenerateIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 4v6h6M23 20v-6h-6"/>
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
    </svg>
  );
}

function VerifyIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  );
}

function CancelIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12"/>
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

/** Verification marker for a day chip: '' when the day was never verified. */
function dayVerifyClass(verification: DayVerification | undefined, isVerifying: boolean): string {
  if (isVerifying) return 'is-checking';
  if (!verification) return '';
  if (verification.isStale) return 'is-stale-check';
  return verification.ok ? 'is-verified' : 'is-failed';
}

function dayVerifyTitle(verification: DayVerification | undefined, isVerifying: boolean): string {
  if (isVerifying) return ' — verifying…';
  if (!verification) return '';
  if (verification.isStale) return ' — verified against an older plan';
  return verification.ok ? ' — verified' : ` — ${verification.errorCount} verification error(s)`;
}

/** "attempt 2 of 4" label, empty unless the run actually verifies and retries. */
function attemptLabel(job: GenerationJob | undefined): string {
  if (!job || !job.autoVerify || job.maxGenerationAttempts <= 1) return '';
  return ` — attempt ${Math.max(1, job.generationAttempt)} of ${job.maxGenerationAttempts}`;
}

/** Chip colouring for one day, driven by its cache entry and live progress. */
function dayChipState(status: CacheEntryStatus | undefined, progress: DayProgress | undefined, day: string) {
  const abbr = day.substring(0, 3);
  if (progress === 'queued') {
    return { bg: 'rgba(234, 179, 8, 0.18)', color: '#facc15', label: `⏳ ${abbr}`, busy: true };
  }
  if (progress === 'verifying') {
    return { bg: 'rgba(103, 232, 249, 0.18)', color: '#67e8f9', label: `🔍 ${abbr}`, busy: true };
  }
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
  dayJobs,
  isCachedResponse,
  onGenerate,
  onGenerateAllDays,
  onRegenerateDay,
  onCancelDay,
  hidden = false,
  provider,
  verifications,
  verifyingDays,
  verifyErrors,
  onVerifyDay
}: OutputPanelProps) {
  const isCurrentDayQueued = dayProgress[selectedDay] === 'queued';
  const isCurrentDayVerifying = dayProgress[selectedDay] === 'verifying';
  const isCurrentDayBusy = isGenerating
    || isCurrentDayQueued
    || isCurrentDayVerifying
    || dayProgress[selectedDay] === 'checking';
  const currentJob = dayJobs[selectedDay];
  const providerName = formatProviderLabel(provider);
  // Days differ in whether they carry thinking output — fall back to the plan
  // tab instead of rendering an empty panel after switching days.
  const activeTab: OutputTab = outputTab === 'thoughts' && !thinkingText ? 'user' : outputTab;
  const verification = verifications[selectedDay];
  const isVerifyingDay = !!verifyingDays[selectedDay];

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
                    dayProgress[day] === 'verifying'
                      ? `${day}: verifying the generated plan${attemptLabel(dayJobs[day])}…`
                      : busy
                        ? `${day}: generating${attemptLabel(dayJobs[day])}…`
                        : `${day}: ${status?.isValid ? 'Valid cache' : status ? 'Stale cache' : 'Not generated'}${dayVerifyTitle(verifications[day], !!verifyingDays[day])}`
                  }
                >
                  {label}
                  {dayVerifyClass(verifications[day], !!verifyingDays[day]) && (
                    <span className={`day-verify-dot ${dayVerifyClass(verifications[day], !!verifyingDays[day])}`} aria-hidden="true" />
                  )}
                </button>
                {busy ? (
                  <button
                    className="day-chip-regen day-chip-cancel"
                    onClick={() => onCancelDay(day)}
                    title={`Cancel ${day} generation`}
                    aria-label={`Cancel ${day} generation`}
                  >
                    <CancelIcon size={12} />
                  </button>
                ) : (
                  <button
                    className="day-chip-regen"
                    onClick={() => onRegenerateDay(day)}
                    title={
                      hasPlan
                        ? `Regenerate ${day} — ignores the cached plan`
                        : `Generate ${day}`
                    }
                    aria-label={hasPlan ? `Regenerate ${day}` : `Generate ${day}`}
                  >
                    <RegenerateIcon size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick action for the day on screen: generate it, stop it, or redo it fresh */}
        <div className="output-toolbar__actions">
          {isCurrentDayBusy ? (
            <button
              className="btn-cancel btn-cancel--sm"
              onClick={() => onCancelDay(selectedDay)}
              title={`Stop generating ${selectedDay}`}
            >
              <CancelIcon size={12} />
              Cancel {selectedDay.substring(0, 3)}
            </button>
          ) : !outputText ? (
            <button
              className="btn-primary btn-primary--sm"
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
              onClick={() => onRegenerateDay(selectedDay)}
              title={`Regenerate ${selectedDay} — ignores the cached plan`}
            >
              <RegenerateIcon size={13} />
              Regenerate {selectedDay.substring(0, 3)}
            </button>
          )}

          {!!outputText && !isCurrentDayBusy && (
            <button
              className="btn-verify btn-verify--sm"
              disabled={isVerifyingDay}
              onClick={() => {
                setOutputTab('verify');
                onVerifyDay(selectedDay);
              }}
              title={`Re-derive every number in the ${selectedDay} plan and compare it to what the plan claims`}
            >
              {isVerifyingDay ? <div className="spinner spinner--inline"></div> : <VerifyIcon size={12} />}
              Verify {selectedDay.substring(0, 3)}
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
          <button
            role="tab"
            aria-selected={activeTab === 'verify'}
            className={`output-tab ${activeTab === 'verify' ? 'active' : ''} ${verification && !verification.ok ? 'has-failure' : ''}`}
            onClick={() => setOutputTab('verify')}
          >
            <span className="label-short">
              Verify{verification ? (verification.ok ? ' ✓' : ` ✗${verification.errorCount}`) : ''}
            </span>
            <span className="label-long">
              Verification ({selectedDay}){verification ? (verification.ok ? ' ✓' : ` — ${verification.errorCount} error(s)`) : ''}
            </span>
          </button>
        </div>

        {isCurrentDayQueued && (
          <div className="output-status" style={{ color: '#facc15' }}>
            <span style={{ fontSize: '0.85rem' }}>⏳</span>
            <span style={{ opacity: 0.9 }}>{selectedDay} Queued (Waiting in line)...</span>
          </div>
        )}
        {isCurrentDayVerifying && (
          <div className="output-status" style={{ color: '#67e8f9' }}>
            <div className="spinner spinner--xs"></div>
            <span style={{ opacity: 0.9 }}>Verifying {selectedDay}{attemptLabel(currentJob)}...</span>
          </div>
        )}
        {isCurrentDayBusy && !isCurrentDayQueued && !isCurrentDayVerifying && (
          <div className="output-status">
            <div className="spinner spinner--xs"></div>
            <span style={{ opacity: 0.9 }}>
              {currentJob && currentJob.generationAttempt > 1 ? 'Regenerating' : 'Generating'} {selectedDay}
              {attemptLabel(currentJob)}...
            </span>
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
        {activeTab === 'verify' ? (
          <VerificationReport
            day={selectedDay}
            verification={verification}
            isVerifying={isVerifyingDay}
            error={verifyErrors[selectedDay]}
            hasPlan={!!outputText}
            job={currentJob}
            isAutoVerifying={isCurrentDayVerifying}
            onVerify={() => onVerifyDay(selectedDay)}
          />
        ) : isCurrentDayBusy && !outputText && !thinkingText ? (
          <div className="loading-container" style={{ flex: 1 }}>
            {isCurrentDayVerifying ? (
              <>
                <div className="spinner"></div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Verifying the {selectedDay} plan{attemptLabel(currentJob)}...
                </p>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Re-deriving every weight, calorie and mineral from the reference table
                </span>
              </>
            ) : isCurrentDayQueued ? (
              <>
                <div className="queued-hourglass" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⏳</div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Starting {selectedDay} generation...
                </p>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  All requested days are launched in parallel
                </span>
              </>
            ) : (
              <>
                <div className="spinner"></div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {providerName} is calculating plan for {selectedDay}...
                </p>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
              </>
            )}
          </div>
        ) : outputText || thinkingText ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {activeTab === 'thoughts' && thinkingText && (
              <div className="thinking-box">
                <div className="thinking-title">{providerName} Thinking Output ({selectedDay})</div>
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
