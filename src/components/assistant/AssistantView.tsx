'use client';
import { useEffect, useRef, useState } from 'react';
import { renderChatMarkdown } from '@/lib/markdown';
import { useAssistant } from '@/hooks/useAssistant';
import ChatBubble, { describeStep } from './ChatBubble';

/** Openers for an empty thread, each answerable straight from the database. */
const SUGGESTIONS = [
  "What's in today's plan?",
  'Which days failed verification, and why?',
  'How close is my sodium:potassium ratio to target?',
  'Suggest a swap to raise potassium without adding calories'
];

interface AssistantViewProps {
  assistant: ReturnType<typeof useAssistant>;
}

export default function AssistantView({ assistant }: AssistantViewProps) {
  const {
    threads,
    threadId,
    messages,
    isSending,
    isLoadingThread,
    error,
    streamingText,
    activeTool,
    completedSteps,
    sendMessage,
    openThread,
    startNewThread,
    deleteThread,
    stop
  } = assistant;

  const [draft, setDraft] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Follow the answer as it streams, but only while the user is already at the
  // bottom — yanking the view back while they scroll up to re-read is hostile.
  const isPinnedRef = useRef(true);
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node || !isPinnedRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streamingText, activeTool, isSending]);

  const handleScroll = () => {
    const node = transcriptRef.current;
    if (!node) return;
    isPinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  /** Grow the composer with what is typed, up to the CSS max-height. */
  const resizeComposer = () => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  };

  const submit = (text: string) => {
    const question = text.trim();
    if (!question || isSending) return;
    isPinnedRef.current = true;
    setDraft('');
    if (composerRef.current) composerRef.current.style.height = '';
    sendMessage(question);
  };

  // Enter sends, Shift+Enter breaks the line — but only on a real keyboard,
  // where Enter is not also the phone keyboard's newline key.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (window.matchMedia('(max-width: 767px)').matches) return;
    event.preventDefault();
    submit(draft);
  };

  const isEmpty = messages.length === 0 && !streamingText && !isSending;

  return (
    <main className="assistant-grid animate-fadeIn">
      <aside className={`glass-panel assistant-threads ${isHistoryOpen ? 'open' : ''}`}>
        <div className="assistant-threads__header">
          <h2 className="panel-title">Conversations</h2>
          <button type="button" className="btn-add" onClick={() => { startNewThread(); setIsHistoryOpen(false); }}>
            + New
          </button>
        </div>

        {threads.length === 0 ? (
          <p className="assistant-threads__empty">No conversations yet.</p>
        ) : (
          <ul className="assistant-threads__list">
            {threads.map(thread => (
              <li key={thread.threadId} className={thread.threadId === threadId ? 'active' : ''}>
                <button
                  type="button"
                  className="assistant-threads__item"
                  onClick={() => { openThread(thread.threadId); setIsHistoryOpen(false); }}
                >
                  <span className="assistant-threads__title">{thread.title}</span>
                  <span className="assistant-threads__meta">
                    {new Date(thread.lastMessageAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' · '}
                    {thread.messageCount} msg
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  aria-label={`Delete conversation ${thread.title}`}
                  onClick={() => deleteThread(thread.threadId)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="glass-panel assistant-chat">
        <div className="assistant-chat__header">
          <button
            type="button"
            className="assistant-chat__history-btn"
            onClick={() => setIsHistoryOpen(open => !open)}
            aria-expanded={isHistoryOpen}
            aria-label="Conversation history"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span className="assistant-chat__history-label">History</span>
          </button>

          <h2 className="panel-title">
            <span aria-hidden="true">💬</span> Diet Assistant
          </h2>

          <span className="assistant-chat__badge" title="The assistant can read your data but never change it">
            read-only
          </span>
        </div>

        <div className="assistant-transcript" ref={transcriptRef} onScroll={handleScroll}>
          {isLoadingThread && <div className="assistant-loading"><div className="spinner" /></div>}

          {isEmpty && !isLoadingThread && (
            <div className="assistant-empty">
              <p className="assistant-empty__lead">
                Ask about your meals, your targets, or any day&apos;s generated plan. I read your
                configuration and plans straight from the database — and I can only read them.
              </p>
              <div className="assistant-empty__suggestions">
                {SUGGESTIONS.map(suggestion => (
                  <button key={suggestion} type="button" className="suggestion-chip" onClick={() => submit(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <ChatBubble key={`${message.createdAt}-${index}`} message={message} />
          ))}

          {(isSending || streamingText) && (
            <div className="chat-row chat-row--assistant">
              <div className="chat-bubble chat-bubble--assistant">
                {completedSteps.map((step, index) => (
                  <div key={`${step.name}-${index}`} className="chat-step chat-step--done">
                    <span className="chat-step__tick" aria-hidden="true">✓</span>
                    {describeStep(step)}
                  </div>
                ))}

                {activeTool && (
                  <div className="chat-step chat-step--active">
                    <span className="chat-step__pulse" aria-hidden="true" />
                    {describeStep(activeTool)}…
                  </div>
                )}

                {streamingText ? (
                  <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: renderChatMarkdown(streamingText) }} />
                ) : (
                  !activeTool && <div className="chat-step chat-step--active"><span className="chat-step__pulse" aria-hidden="true" />Thinking…</div>
                )}
              </div>
            </div>
          )}

          {error && <div className="assistant-error">⚠️ {error}</div>}
        </div>

        <div className="assistant-composer">
          <textarea
            ref={composerRef}
            className="assistant-composer__input"
            placeholder="Ask about your diet…"
            value={draft}
            rows={1}
            onChange={e => { setDraft(e.target.value); resizeComposer(); }}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          {isSending ? (
            <button type="button" className="btn-cancel assistant-composer__btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary assistant-composer__btn"
              disabled={!draft.trim()}
              onClick={() => submit(draft)}
            >
              Send
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
