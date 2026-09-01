/**
 * TypeScript wrapper around the shared assistant modules.
 * The tool layer, provider loop and system prompt live in plain JS so they
 * stay consistent with the other shared lib modules (and remain requireable
 * from whatsapp-worker.js if the assistant is ever wired into WhatsApp).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const agentTools = require('./agent-tools.js');
const agentComplete = require('./agent-complete.js');
const agentPrompt = require('./agent-prompt.js');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Provider-neutral tool declaration handed to the model. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** One message in the neutral conversation format the agent loop consumes. */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolCallId?: string;
  name?: string;
}

/** One completed tool call, kept on the stored message for transcript replay. */
export interface AgentStep {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error: string;
  ms: number;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; error: string; ms: number };

export interface RunAgentTurnOptions {
  provider: string;
  model: string;
  messages: AgentMessage[];
  tools: ToolSchema[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  onEvent?: (event: AgentEvent) => void;
  credentials?: {
    apiKey?: string;
    fireworksApiKey?: string;
    enterpriseApiKey?: string;
    enterpriseServiceAccountJson?: string;
  };
  thinkingLevel?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  enterpriseAuthMethod?: string;
  enterpriseProjectId?: string;
  enterpriseLocation?: string;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface RunAgentTurnResult {
  text: string;
  steps: AgentStep[];
  messages: AgentMessage[];
}

/** Read-only database tools, declarations only. */
export const TOOL_SCHEMAS: ToolSchema[] = agentTools.TOOL_SCHEMAS;

/** Execute one read-only tool call. Requires an open mongoose connection. */
export const runTool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome> = agentTools.runTool;

export const buildSystemPrompt: (options?: { now?: Date; timezone?: string }) => string = agentPrompt.buildSystemPrompt;

export const runAgentTurn: (options: RunAgentTurnOptions) => Promise<RunAgentTurnResult> = agentComplete.runAgentTurn;

export const DEFAULT_MAX_STEPS: number = agentComplete.DEFAULT_MAX_STEPS;
