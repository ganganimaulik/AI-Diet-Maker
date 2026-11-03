import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { dbConnect, ChatThread, Config, type IChatMessage, type IChatProposal, type IConfig } from '@/lib/db';
import type { BuilderSnapshot } from '@/lib/builder-history';
import type { BuilderProposal } from '@/lib/types';
import {
  TOOL_SCHEMAS,
  PROPOSAL_TOOL_SCHEMAS,
  PROPOSE_TOOL_NAME,
  runTool,
  runAgentTurn,
  buildSystemPrompt,
  createProposalDrafts,
  formatChange,
  isBuilderSnapshot,
  type AgentEvent,
  type AgentMessage,
  type OnScreenBuilder
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

/** Longest builder state accepted with a question; a real one is about 10 KB. */
const MAX_BUILDER_CHARS = 200_000;

/** Change lines replayed per earlier draft, so a sweeping one cannot crowd out the conversation. */
const MAX_REPLAYED_CHANGES = 12;

interface PublicChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps: Array<{ name: string; args: unknown; ok: boolean; error: string; ms: number }>;
  proposals: BuilderProposal[];
  error: string;
  createdAt: string;
}

function serializeProposal(proposal: IChatProposal): BuilderProposal {
  return {
    id: proposal.id,
    title: proposal.title || '',
    reason: proposal.reason || '',
    operations: proposal.operations || [],
    changes: (proposal.changes || []).map((change) => ({
      kind: change.kind || 'change',
      where: change.where || '',
      field: change.field || '',
      before: change.before || '',
      after: change.after || ''
    })),
    status: proposal.status || 'pending',
    decidedAt: proposal.decidedAt ? new Date(proposal.decidedAt).toISOString() : null
  };
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
    proposals: (message.proposals || []).map(serializeProposal),
    error: message.error || '',
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : new Date().toISOString()
  };
}

/**
 * A stored message as the model reads it on later turns. Each draft carries
 * the user's decision, so the model knows which changes are in the builder
 * and which were turned down.
 */
function replayContent(message: IChatMessage): string {
  const decisions = (message.proposals || []).map((proposal) => {
    const outcome = proposal.status === 'applied'
      ? 'the user applied it to the Diet Builder'
      : proposal.status === 'rejected'
        ? 'the user rejected it'
        : 'still waiting for the user to apply or reject it';
    const changes = (proposal.changes || [])
      .slice(0, MAX_REPLAYED_CHANGES)
      .map((change) => `- ${formatChange(change)}`);
    return [`[Drafted change "${proposal.title}": ${outcome}]`, ...changes].join('\n');
  });
  return [message.content, ...decisions].filter(Boolean).join('\n\n');
}

/** The Diet Builder as the browser sent it, or null to fall back to the saved config. */
function readOnScreenBuilder(value: unknown): OnScreenBuilder | null {
  if (!value || typeof value !== 'object') return null;
  const { snapshot, hasUnsavedChanges } = value as { snapshot?: unknown; hasUnsavedChanges?: unknown };
  if (!isBuilderSnapshot(snapshot) || JSON.stringify(snapshot).length > MAX_BUILDER_CHARS) return null;
  return { snapshot, hasUnsavedChanges: hasUnsavedChanges === true };
}

const savedBuilder = (config: IConfig): BuilderSnapshot => ({
  global: config.global,
  meals: config.meals,
  dailyVariables: config.dailyVariables
});

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
 * POST /api/chat  { threadId?, message, builder?: { snapshot, hasUnsavedChanges } }
 * Streams the assistant's turn as SSE: tool calls as they run, then the answer
 * token by token. The completed turn, with any changes it drafted, is appended
 * to the thread before 'done'.
 *
 * `builder` is the Diet Builder as it is on screen. The assistant reads it as
 * the current setup and checks its drafts against it, so both match what the
 * user is looking at even before they save.
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

  const builder = readOnScreenBuilder(body.builder);
  const drafts = createProposalDrafts(builder ? builder.snapshot : savedBuilder(config));

  const now = new Date();
  const userMessage = { role: 'user' as const, content: message, steps: [], proposals: [], error: '', createdAt: now };

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
      .map((entry) => ({ role: entry.role, content: replayContent(entry) }) as AgentMessage)
      .filter((entry) => entry.content),
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
          tools: [...TOOL_SCHEMAS, ...PROPOSAL_TOOL_SCHEMAS],
          runTool: (name, args) => (name === PROPOSE_TOOL_NAME ? drafts.run(args) : runTool(name, args, { builder })),
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
          proposals: drafts.proposals.map((proposal) => ({ ...proposal, decidedAt: null })),
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
            proposals: [],
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

/**
 * PATCH /api/chat  { threadId, proposalId, status: 'applied' | 'rejected' }
 * Records the user's decision on a drafted change. The browser puts an applied
 * change into the builder itself, and only after this succeeds. A proposal is
 * decided once, so a second tab cannot apply it again.
 */
export async function PATCH(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const threadId = typeof body.threadId === 'string' ? body.threadId : '';
    const proposalId = typeof body.proposalId === 'string' ? body.proposalId : '';
    const status = body.status === 'applied' || body.status === 'rejected' ? body.status : '';
    if (!threadId || !proposalId || !status) {
      return NextResponse.json(
        { error: 'threadId, proposalId and a status of applied or rejected are required.' },
        { status: 400 }
      );
    }

    await dbConnect();
    const decidedAt = new Date();
    const result = await ChatThread.updateOne(
      { threadId, messages: { $elemMatch: { proposals: { $elemMatch: { id: proposalId, status: 'pending' } } } } },
      {
        $set: {
          'messages.$[message].proposals.$[proposal].status': status,
          'messages.$[message].proposals.$[proposal].decidedAt': decidedAt
        }
      },
      { arrayFilters: [{ 'message.proposals.id': proposalId }, { 'proposal.id': proposalId }] }
    );

    if (result.modifiedCount === 0) {
      const thread = await ChatThread.findOne({ threadId }, { messages: 1 }).lean();
      const existing = (thread?.messages || [])
        .flatMap((entry) => entry.proposals || [])
        .find((proposal) => proposal.id === proposalId);
      if (!existing) return NextResponse.json({ error: 'That change no longer exists.' }, { status: 404 });
      return NextResponse.json(
        {
          error: `This change was already ${existing.status}.`,
          proposal: {
            id: existing.id,
            status: existing.status,
            decidedAt: existing.decidedAt ? new Date(existing.decidedAt).toISOString() : null
          }
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ proposal: { id: proposalId, status, decidedAt: decidedAt.toISOString() } });
  } catch (error) {
    console.error('Error recording a proposal decision:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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
