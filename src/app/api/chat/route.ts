import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { dbConnect, ChatThread, Config, type IChatMessage, type IConfig } from '@/lib/db';
import {
  TOOL_SCHEMAS,
  runTool,
  runAgentTurn,
  buildSystemPrompt,
  type AgentEvent,
  type AgentMessage
} from '@/lib/agent';

// A turn is one short model call per tool round-trip, so unlike plan
// generation it comfortably fits in a request — same reasoning as /api/verify,
// which is why this does not go through the worker's job queue.
export const maxDuration = 300;

/** Prior turns replayed into the model. Older ones fall out of context. */
const HISTORY_TURNS = 20;

/** Longest question accepted, so one paste cannot blow out the context. */
const MAX_MESSAGE_CHARS = 8000;

const TITLE_CHARS = 60;

interface PublicChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps: Array<{ name: string; args: unknown; ok: boolean; error: string; ms: number }>;
  error: string;
  createdAt: string;
}

function serializeMessage(message: IChatMessage): PublicChatMessage {
  return {
    role: message.role,
    content: message.content || '',
    steps: (message.steps || []).map((step) => ({
      name: step.name,
      args: step.args ?? null,
      ok: step.ok !== false,
      error: step.error || '',
      ms: step.ms || 0
    })),
    error: message.error || '',
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : new Date().toISOString()
  };
}

/** First line of the opening question, as the thread's name in the sidebar. */
function deriveTitle(message: string): string {
  const firstLine = message.trim().split('\n')[0].trim();
  if (!firstLine) return 'New chat';
  return firstLine.length > TITLE_CHARS ? `${firstLine.slice(0, TITLE_CHARS - 1)}…` : firstLine;
}

/**
 * The assistant reuses the generation provider/model unless it has been given
 * its own, mirroring how the verification settings inherit. Chat wants a fast
 * model far more than a deep one, so the override usually is set.
 */
function resolveAgentSettings(config: IConfig) {
  const provider = config.agentProvider || config.provider || 'google-ai-studio';
  const inheritsProvider = !config.agentProvider || config.agentProvider === config.provider;

  let model = config.agentModel || '';
  if (model === 'custom') model = config.agentCustomModel || '';
  if (!model && inheritsProvider) {
    model = config.model === 'custom' ? config.customModel : config.model;
  }

  return {
    provider,
    model,
    thinkingLevel: config.agentThinkingLevel || 'default',
    reasoningEffort: config.agentReasoningEffort || 'default',
    maxTokens: Number(config.agentMaxTokens) > 0 ? Number(config.agentMaxTokens) : 8192,
    enterpriseAuthMethod: config.enterpriseAuthMethod || 'api-key',
    enterpriseProjectId: config.enterpriseProjectId || '',
    enterpriseLocation: config.enterpriseLocation || 'global',
    credentials: {
      apiKey: config.apiKey,
      fireworksApiKey: config.fireworksApiKey,
      enterpriseApiKey: config.enterpriseApiKey,
      enterpriseServiceAccountJson: config.enterpriseServiceAccountJson
    }
  };
}

/**
 * GET /api/chat            – thread list, newest first
 * GET /api/chat?threadId=x – one thread with its messages
 */
export async function GET(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const threadId = new URL(req.url).searchParams.get('threadId');

    if (threadId) {
      const thread = await ChatThread.findOne({ threadId }).lean();
      if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      return NextResponse.json({
        thread: {
          threadId: thread.threadId,
          title: thread.title,
          lastMessageAt: new Date(thread.lastMessageAt).toISOString(),
          messages: (thread.messages || []).map(serializeMessage)
        }
      });
    }

    const threads = await ChatThread.find({}, { threadId: 1, title: 1, lastMessageAt: 1, messages: 1 })
      .sort({ lastMessageAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      threads: threads.map((thread) => ({
        threadId: thread.threadId,
        title: thread.title,
        lastMessageAt: new Date(thread.lastMessageAt).toISOString(),
        messageCount: (thread.messages || []).length
      }))
    });
  } catch (error) {
    console.error('Error loading chat threads:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/chat  { threadId?, message }
 * Streams the assistant's turn as SSE: tool calls as they run, then the answer
 * token by token. The completed turn is appended to the thread before 'done'.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: 'A message is required.' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is too long (${message.length} characters, limit ${MAX_MESSAGE_CHARS}).` },
      { status: 400 }
    );
  }

  await dbConnect();

  const config = await Config.findOne().lean();
  if (!config) {
    return NextResponse.json({ error: 'No configuration saved yet. Open Settings first.' }, { status: 400 });
  }

  const settings = resolveAgentSettings(config);
  if (!settings.model) {
    return NextResponse.json(
      { error: 'No assistant model is configured. Pick one under Settings → Chat Assistant.' },
      { status: 400 }
    );
  }

  // Append the question before streaming, so a failed turn still leaves the
  // thread in a state the user recognises.
  const requestedThreadId = typeof body.threadId === 'string' ? body.threadId : '';
  const thread = requestedThreadId ? await ChatThread.findOne({ threadId: requestedThreadId }) : null;

  const now = new Date();
  const userMessage = { role: 'user' as const, content: message, steps: [], error: '', createdAt: now };

  let threadId: string;
  let title: string;
  let history: IChatMessage[];

  if (thread) {
    threadId = thread.threadId;
    title = thread.title;
    history = [...thread.messages];
    thread.messages.push(userMessage);
    thread.lastMessageAt = now;
    await thread.save();
  } else {
    threadId = randomUUID();
    title = deriveTitle(message);
    history = [];
    await ChatThread.create({ threadId, title, messages: [userMessage], lastMessageAt: now });
  }

  const conversation: AgentMessage[] = [
    { role: 'system', content: buildSystemPrompt({ timezone: 'Asia/Kolkata' }) },
    ...history
      .slice(-HISTORY_TURNS)
      .filter((entry) => entry.content)
      .map((entry) => ({ role: entry.role, content: entry.content }) as AgentMessage),
    { role: 'user', content: message }
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: 'thread', threadId, title });

      try {
        const turn = await runAgentTurn({
          ...settings,
          messages: conversation,
          tools: TOOL_SCHEMAS,
          runTool,
          signal: req.signal,
          onEvent: (event: AgentEvent) => {
            if (event.type === 'thinking') return; // Not surfaced in chat.
            if (event.type === 'text' && !event.delta) return;
            send(event);
          }
        });

        const assistantMessage = {
          role: 'assistant' as const,
          content: turn.text,
          steps: turn.steps.map((step) => ({
            name: step.name,
            args: step.args,
            ok: step.ok,
            error: step.error,
            ms: step.ms
          })),
          error: '',
          createdAt: new Date()
        };

        await ChatThread.updateOne(
          { threadId },
          { $push: { messages: assistantMessage }, $set: { lastMessageAt: new Date() } }
        );

        send({ type: 'done', message: serializeMessage(assistantMessage as IChatMessage) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'The assistant failed to answer.';
        // The client aborting is a normal end, not something to record.
        if (!req.signal.aborted) {
          const failed = {
            role: 'assistant' as const,
            content: '',
            steps: [],
            error: detail,
            createdAt: new Date()
          };
          await ChatThread.updateOne(
            { threadId },
            { $push: { messages: failed }, $set: { lastMessageAt: new Date() } }
          ).catch(() => {});
          send({ type: 'error', error: detail });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx-style proxies buffering the stream into one late blob.
      'X-Accel-Buffering': 'no'
    }
  });
}

/** DELETE /api/chat?threadId=x */
export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const threadId = new URL(req.url).searchParams.get('threadId');
    if (!threadId) return NextResponse.json({ error: 'threadId is required.' }, { status: 400 });

    await dbConnect();
    const result = await ChatThread.deleteOne({ threadId });
    return NextResponse.json({ success: true, deleted: result.deletedCount || 0 });
  } catch (error) {
    console.error('Error deleting chat thread:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
