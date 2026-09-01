'use client';
import { useState } from 'react';
import { ChatMessage, ChatToolStep, TOOL_LABELS } from '@/lib/types';
import { renderChatMarkdown } from '@/lib/markdown';

/**
 * Human wording for one lookup. The arguments matter as much as the tool name —
 * "Reading the plan" is much less useful than "Reading the plan · MONDAY".
 */
export function describeStep(step: { name: string; args?: unknown }): string {
  const label = TOOL_LABELS[step.name] || step.name;
  const args = (step.args || {}) as Record<string, unknown>;
  if (typeof args.day === 'string') return `${label} · ${args.day}`;
  if (typeof args.collection === 'string') return `${label} · ${args.collection}`;
  return label;
}

function ToolTrace({ steps }: { steps: ChatToolStep[] }) {
  const [isOpen, setIsOpen] = useState(false);
  if (steps.length === 0) return null;

  const failed = steps.filter(step => !step.ok).length;
  const total = steps.reduce((sum, step) => sum + (step.ms || 0), 0);

  return (
    <div className="tool-trace">
      <button type="button" className="tool-trace__toggle" onClick={() => setIsOpen(open => !open)}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={`tool-trace__chevron ${isOpen ? 'open' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {steps.length} database {steps.length === 1 ? 'lookup' : 'lookups'}
        {failed > 0 && <span className="tool-trace__failed"> · {failed} failed</span>}
        {total > 0 && <span className="tool-trace__ms"> · {(total / 1000).toFixed(1)}s</span>}
      </button>

      {isOpen && (
        <ul className="tool-trace__list">
          {steps.map((step, index) => (
            <li key={`${step.name}-${index}`} className={step.ok ? '' : 'failed'}>
              <span className="tool-trace__name">{describeStep(step)}</span>
              {!step.ok && step.error && <span className="tool-trace__error">{step.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ChatBubbleProps {
  message: ChatMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="chat-row chat-row--user">
        <div className="chat-bubble chat-bubble--user">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="chat-row chat-row--assistant">
      <div className="chat-bubble chat-bubble--assistant">
        <ToolTrace steps={message.steps || []} />
        {message.error ? (
          <p className="chat-bubble__error">⚠️ {message.error}</p>
        ) : (
          <div
            className="chat-markdown"
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
}
