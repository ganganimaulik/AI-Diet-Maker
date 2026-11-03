'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BuilderOperation, BuilderProposal, ChatMessage, ChatThreadSummary, ChatToolStep } from '@/lib/types';
import { BuilderLocation, BuilderSnapshot } from '@/lib/builder-history';
import { applyBuilderOperations } from '@/lib/builder-ops';

/** A tool call that has started but not yet returned. */
export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** What the assistant needs from the Diet Builder on the planner page. */
export interface AssistantBuilder {
  /** The builder as it is on screen, sent with each question so answers and drafts match it. */
  snapshot: BuilderSnapshot;
  /** Whether the builder differs from the saved config. */
  hasUnsavedChanges: boolean;
  /** Puts an approved change into the builder as one undoable, unsaved edit. */
  apply: (operations: BuilderOperation[]) => void;
  /** Brings the builder up where a change lives. */
  show: (location: BuilderLocation) => void;
}

/** The builder tab that shows a proposal's first edit. */
function locateProposal(proposal: BuilderProposal): BuilderLocation {
  const first = proposal.operations[0];
  if (!first || first.action === 'update_targets' || first.action === 'remove_meal') return { tab: 'global' };
  if (typeof first.day === 'string') return { tab: 'daily', day: first.day };
  const mealId = first.action === 'add_meal' ? first.id : first.meal;
  return { tab: typeof mealId === 'string' ? mealId : 'global' };
}

/**
 * Chat state against /api/chat.
 *
 * The answer arrives as SSE rather than one JSON body because a turn can spend
 * several seconds reading the database before it writes a word — showing which
 * lookups are running is the difference between "thinking" and "hung".
 *
 * Changes the assistant drafts arrive as proposals on its answer. They reach
 * the Diet Builder only through applyProposal, which runs when the user
 * presses Apply on one.
 */
export function useAssistant(isAuthenticated: boolean | null, builder: AssistantBuilder) {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [error, setError] = useState('');

  /** Text of the in-flight answer, before it becomes a stored message. */
  const [streamingText, setStreamingText] = useState('');
  const [activeTool, setActiveTool] = useState<PendingToolCall | null>(null);
  const [completedSteps, setCompletedSteps] = useState<ChatToolStep[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors streamingText so end-of-stream handling can read it without
      nesting a state update inside another updater (double-invoked in
      StrictMode, which would append the answer twice). */
  const streamingTextRef = useRef('');
  /** The latest builder, for callbacks that run long after the render that made them. */
  const builderRef = useRef(builder);
  useEffect(() => {
    builderRef.current = builder;
  });

  const appendStreamingText = (delta: string) => {
    streamingTextRef.current += delta;
    setStreamingText(streamingTextRef.current);
  };

  const clearStreamingText = () => {
    streamingTextRef.current = '';
    setStreamingText('');
  };

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/chat');
      if (!res.ok) return;
      const data = await res.json();
      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch (e) {
      console.error('Error loading chat threads:', e);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated !== true) return;
    // The state update happens after the fetch resolves, not in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchThreads();
  }, [isAuthenticated, fetchThreads]);

  /** Abort any in-flight turn when the view unmounts. */
  useEffect(() => () => abortRef.current?.abort(), []);

  const openThread = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setIsLoadingThread(true);
    setError('');
    clearStreamingText();
    setActiveTool(null);
    setCompletedSteps([]);
    try {
      const res = await fetch(`/api/chat?threadId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not open that conversation.');
        return;
      }
      setThreadId(data.thread.threadId);
      setMessages(data.thread.messages || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that conversation.');
    } finally {
      setIsLoadingThread(false);
    }
  }, []);

  const startNewThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId('');
    setMessages([]);
    setError('');
    clearStreamingText();
    setActiveTool(null);
    setCompletedSteps([]);
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chat?threadId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return;
      setThreads(prev => prev.filter(thread => thread.threadId !== id));
      if (id === threadId) startNewThread();
    } catch (e) {
      console.error('Error deleting chat thread:', e);
    }
  }, [threadId, startNewThread]);

  /** Stop the current turn. The question stays in the thread server-side. */
  const stop = useCallback(() => abortRef.current?.abort(), []);

  const sendMessage = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || isSending) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    clearStreamingText();
    setActiveTool(null);
    setCompletedSteps([]);
    setIsSending(true);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: question, steps: [], proposals: [], error: '', createdAt: new Date().toISOString() }
    ]);

    try {
      const { snapshot, hasUnsavedChanges } = builderRef.current;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadId || undefined,
          message: question,
          builder: { snapshot, hasUnsavedChanges }
        }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || 'The assistant could not be reached.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answered = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed.slice(5).trim());
          } catch {
            continue;
          }

          if (event.type === 'thread') {
            setThreadId(String(event.threadId || ''));
          } else if (event.type === 'text') {
            appendStreamingText(String(event.delta || ''));
          } else if (event.type === 'tool_call') {
            setActiveTool({
              id: String(event.id || ''),
              name: String(event.name || ''),
              args: (event.args as Record<string, unknown>) || {}
            });
          } else if (event.type === 'tool_result') {
            setActiveTool(null);
            setCompletedSteps(prev => [
              ...prev,
              {
                name: String(event.name || ''),
                args: null,
                ok: event.ok !== false,
                error: String(event.error || ''),
                ms: Number(event.ms) || 0
              }
            ]);
          } else if (event.type === 'done') {
            answered = true;
            setMessages(prev => [...prev, event.message as ChatMessage]);
            clearStreamingText();
            setCompletedSteps([]);
          } else if (event.type === 'error') {
            answered = true;
            setError(String(event.error || 'The assistant failed to answer.'));
            clearStreamingText();
          }
        }
      }

      // Stream ended without a terminal event — a dropped connection or a
      // platform timeout. Keep whatever text arrived rather than losing it.
      if (!answered) {
        const partial = streamingTextRef.current;
        clearStreamingText();
        if (partial) {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: partial, steps: [], proposals: [], error: '', createdAt: new Date().toISOString() }
          ]);
        } else {
          setError('The answer stream ended early. Try asking again.');
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        const partial = streamingTextRef.current;
        clearStreamingText();
        if (partial) {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: partial, steps: [], proposals: [], error: '', createdAt: new Date().toISOString() }
          ]);
        }
      } else {
        setError(e instanceof Error ? e.message : 'The assistant could not be reached.');
        clearStreamingText();
      }
    } finally {
      setIsSending(false);
      setActiveTool(null);
      abortRef.current = null;
      fetchThreads();
    }
  }, [isSending, threadId, fetchThreads]);

  /** Mirrors a recorded decision into the open conversation. */
  const markProposal = (id: string, decision: Pick<BuilderProposal, 'status' | 'decidedAt'>) => {
    setMessages(prev => prev.map(message => (
      message.proposals?.some(proposal => proposal.id === id)
        ? { ...message, proposals: message.proposals.map(proposal => (proposal.id === id ? { ...proposal, ...decision } : proposal)) }
        : message
    )));
  };

  /**
   * Stores the user's decision on a draft. Resolves '' once it is recorded,
   * else the reason it was not; a draft already decided in another tab shows
   * that decision instead.
   */
  const recordDecision = useCallback(async (proposal: BuilderProposal, status: 'applied' | 'rejected'): Promise<string> => {
    try {
      const res = await fetch('/api/chat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, proposalId: proposal.id, status })
      });
      const data = await res.json().catch(() => null);
      if (data?.proposal) markProposal(proposal.id, { status: data.proposal.status, decidedAt: data.proposal.decidedAt });
      if (!res.ok) return (data && data.error) || 'Could not record your decision. Try again.';
      return '';
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not record your decision. Try again.';
    }
  }, [threadId]);

  /**
   * The human-in-the-loop step, run only by the user's Apply click: puts a
   * drafted change into the Diet Builder as one undoable, unsaved edit. The
   * draft is first checked against the builder as it is now, so a change
   * that no longer fits is refused before the go-ahead is recorded, never
   * applied halfway. Resolves '' on success, else the reason.
   */
  const applyProposal = useCallback(async (proposal: BuilderProposal): Promise<string> => {
    try {
      applyBuilderOperations(builderRef.current.snapshot, proposal.operations);
    } catch (e) {
      return `Can't apply this to the Diet Builder as it is now. ${e instanceof Error ? e.message : ''}`.trim();
    }
    const problem = await recordDecision(proposal, 'applied');
    if (problem) return problem;
    builderRef.current.apply(proposal.operations);
    return '';
  }, [recordDecision]);

  const rejectProposal = useCallback(
    (proposal: BuilderProposal) => recordDecision(proposal, 'rejected'),
    [recordDecision]
  );

  const showProposal = useCallback((proposal: BuilderProposal) => {
    builderRef.current.show(locateProposal(proposal));
  }, []);

  return {
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
    stop,
    setError,
    applyProposal,
    rejectProposal,
    showProposal,
    builderHasUnsavedChanges: builder.hasUnsavedChanges
  };
}
