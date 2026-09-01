'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, ChatThreadSummary, ChatToolStep } from '@/lib/types';

/** A tool call that has started but not yet returned. */
export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Chat state against /api/chat.
 *
 * The answer arrives as SSE rather than one JSON body because a turn can spend
 * several seconds reading the database before it writes a word — showing which
 * lookups are running is the difference between "thinking" and "hung".
 */
export function useAssistant(isAuthenticated: boolean | null) {
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
      { role: 'user', content: question, steps: [], error: '', createdAt: new Date().toISOString() }
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: threadId || undefined, message: question }),
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
            { role: 'assistant', content: partial, steps: [], error: '', createdAt: new Date().toISOString() }
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
            { role: 'assistant', content: partial, steps: [], error: '', createdAt: new Date().toISOString() }
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
    setError
  };
}
