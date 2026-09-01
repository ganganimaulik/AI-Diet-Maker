/**
 * Streaming multi-turn tool-calling loop across the three supported providers.
 *
 * ai-complete.js answers one prompt in one shot. The assistant instead needs to
 * think, call read-only database tools, see what came back, and only then
 * answer — possibly several times in a row. That loop is the same everywhere;
 * only the wire format differs, so the provider-specific parts are kept to two
 * adapters (OpenAI-shaped for Fireworks, Gemini-shaped for the two Google
 * paths) around a shared conversation format.
 *
 * Conversation messages use one neutral shape:
 *   { role: 'system' | 'user' | 'assistant' | 'tool',
 *     content: string,
 *     toolCalls?: [{ id, name, args }],   // assistant only
 *     toolCallId?: string, name?: string } // tool only
 *
 * Used by:
 *   - src/app/api/chat/route.ts (ES import via agent-complete.ts)
 *
 * Keep this file as plain JS so it matches the other shared lib modules.
 */

const { normalizeThinkingLevel } = require('./gemini.js');
const { FIREWORKS_API_URL, parseFireworksErrorText } = require('./fireworks.js');
const { parseGeminiErrorText } = require('./gemini.js');

/** Tool round-trips allowed in one turn before the loop gives up. */
const DEFAULT_MAX_STEPS = 8;

/** Fireworks truncates hard at its own default, so always send a budget. */
const DEFAULT_MAX_TOKENS = 8192;

// -------------------------------------------------------------
// SSE
// -------------------------------------------------------------

/**
 * Yield each parsed `data:` payload of an SSE response.
 * Mirrors the worker's parser: buffer across chunk boundaries, skip [DONE],
 * and cancel the body on abort so the provider connection actually closes.
 */
async function* readSse(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal && signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          yield JSON.parse(payload);
        } catch {
          // Partial or malformed SSE line; the next chunk completes it.
        }
      }
    }
  } finally {
    if (signal && signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// -------------------------------------------------------------
// FIREWORKS (OpenAI-compatible)
// -------------------------------------------------------------

function toOpenAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
        }))
      };
    }
    return { role: message.role, content: message.content || '' };
  });
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }));
}

/**
 * One Fireworks streaming request. Emits text/thinking deltas as they arrive
 * and returns the assistant message, with any tool calls reassembled from the
 * per-index argument fragments the OpenAI stream format sends them in.
 */
async function streamFireworksStep({ model, messages, tools, credentials, reasoningEffort, maxTokens, signal, onEvent }) {
  const key = process.env.FIREWORKS_API_KEY || credentials.fireworksApiKey;
  if (!key) throw new Error('Fireworks API Key is missing.');

  const payload = {
    model,
    messages: toOpenAiMessages(messages),
    temperature: 0.3,
    max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
    stream: true
  };
  if (tools.length > 0) {
    payload.tools = toOpenAiTools(tools);
    payload.tool_choice = 'auto';
  }
  if (reasoningEffort && reasoningEffort !== 'default') {
    payload.reasoning_effort = reasoningEffort;
  }

  const response = await fetch(FIREWORKS_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok) {
    throw new Error(parseFireworksErrorText(await response.text(), 'Fireworks request failed.'));
  }

  let text = '';
  const partials = new Map(); // index -> { id, name, argumentText }
  let finishReason = '';

  for await (const chunk of readSse(response, signal)) {
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta || {};

    if (delta.reasoning_content) onEvent({ type: 'thinking', delta: delta.reasoning_content });
    if (delta.content) {
      text += delta.content;
      onEvent({ type: 'text', delta: delta.content });
    }

    for (const call of delta.tool_calls || []) {
      const index = call.index ?? 0;
      const partial = partials.get(index) || { id: '', name: '', argumentText: '' };
      if (call.id) partial.id = call.id;
      if (call.function && call.function.name) partial.name += call.function.name;
      if (call.function && call.function.arguments) partial.argumentText += call.function.arguments;
      partials.set(index, partial);
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = [...partials.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, partial]) => ({
      id: partial.id || `call_${index}`,
      name: partial.name,
      args: safeParseArgs(partial.argumentText)
    }))
    .filter((call) => call.name);

  return { text, toolCalls, finishReason };
}

/** Tool arguments arrive as a JSON string; a malformed one is a call with no args. */
function safeParseArgs(argumentText) {
  if (!argumentText) return {};
  try {
    const parsed = JSON.parse(argumentText);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// -------------------------------------------------------------
// GEMINI (AI Studio REST, Vertex REST, Vertex SDK)
// -------------------------------------------------------------

/**
 * Convert a JSON Schema fragment to Gemini's Schema proto: enum type names are
 * uppercase, and keywords it does not model (additionalProperties and friends)
 * are dropped rather than sent and rejected.
 */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toGeminiSchema(value);
    }
  }
  return out;
}

function toGeminiFunctionDeclarations(tools) {
  return tools.map((tool) => {
    const declaration = { name: tool.name, description: tool.description };
    // A no-argument function must omit `parameters` entirely; an OBJECT schema
    // with no properties is rejected.
    const hasParameters = tool.parameters && Object.keys(tool.parameters.properties || {}).length > 0;
    if (hasParameters) declaration.parameters = toGeminiSchema(tool.parameters);
    return declaration;
  });
}

/**
 * Split the neutral conversation into Gemini's `systemInstruction` plus
 * `contents`. Gemini has no tool role: a call is a model part and its result
 * is a user part, paired by function name.
 */
function toGeminiContents(messages) {
  const systemParts = [];
  const contents = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push({ text: message.content });
      continue;
    }
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: message.name, response: { result: message.content } } }]
      });
      continue;
    }
    if (message.role === 'assistant') {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls || []) {
        parts.push({ functionCall: { name: call.name, args: call.args || {} } });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({ role: 'user', parts: [{ text: message.content || '' }] });
  }

  return {
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
    contents
  };
}

/** Fold one candidate's parts into text/thinking deltas and function calls. */
function consumeGeminiParts(parts, onEvent, accumulator) {
  for (const part of parts || []) {
    if (part.functionCall) {
      accumulator.toolCalls.push({
        id: `call_${accumulator.toolCalls.length}_${part.functionCall.name}`,
        name: part.functionCall.name,
        args: part.functionCall.args || {}
      });
      continue;
    }
    if (!part.text) continue;
    if (part.thought) {
      onEvent({ type: 'thinking', delta: part.text });
    } else {
      accumulator.text += part.text;
      onEvent({ type: 'text', delta: part.text });
    }
  }
}

function buildGeminiRequestBody({ messages, tools, thinkingLevel, maxTokens }) {
  const { systemInstruction, contents } = toGeminiContents(messages);
  const body = { contents, generationConfig: { temperature: 0.3 } };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (tools.length > 0) body.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];

  const level = normalizeThinkingLevel(thinkingLevel);
  if (level) body.generationConfig.thinkingConfig = { thinkingLevel: level };
  if (Number(maxTokens) > 0) body.generationConfig.maxOutputTokens = Number(maxTokens);
  return body;
}

async function streamGeminiRestStep({ endpoint, messages, tools, thinkingLevel, maxTokens, signal, onEvent }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiRequestBody({ messages, tools, thinkingLevel, maxTokens })),
    signal
  });
  if (!response.ok) {
    throw new Error(parseGeminiErrorText(await response.text(), 'Gemini request failed.'));
  }

  const accumulator = { text: '', toolCalls: [] };
  let finishReason = '';

  for await (const chunk of readSse(response, signal)) {
    const candidate = chunk.candidates && chunk.candidates[0];
    if (!candidate) continue;
    consumeGeminiParts(candidate.content && candidate.content.parts, onEvent, accumulator);
    if (candidate.finishReason) finishReason = candidate.finishReason;
  }

  return { text: accumulator.text, toolCalls: accumulator.toolCalls, finishReason };
}

async function streamVertexSdkStep({
  model,
  messages,
  tools,
  credentials,
  thinkingLevel,
  maxTokens,
  enterpriseAuthMethod,
  enterpriseProjectId,
  enterpriseLocation,
  signal,
  onEvent
}) {
  if (enterpriseAuthMethod === 'service-account' && !credentials.enterpriseServiceAccountJson) {
    throw new Error('Service Account JSON is required when Service Account authentication is selected.');
  }
  if (!enterpriseProjectId) throw new Error('GCP Project ID is required for Gemini Enterprise.');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleGenAI } = require('@google/genai');
  let googleAuthOptions;
  if (enterpriseAuthMethod === 'service-account') {
    try {
      googleAuthOptions = { credentials: JSON.parse(credentials.enterpriseServiceAccountJson) };
    } catch (error) {
      throw new Error(`Invalid Service Account JSON: ${error.message}`);
    }
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    project: enterpriseProjectId,
    location: enterpriseLocation || 'global',
    googleAuthOptions
  });

  const { systemInstruction, contents } = toGeminiContents(messages);
  const config = { temperature: 0.3 };
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (tools.length > 0) config.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];
  if (signal) config.abortSignal = signal;
  if (Number(maxTokens) > 0) config.maxOutputTokens = Number(maxTokens);
  const level = normalizeThinkingLevel(thinkingLevel);
  if (level) config.thinkingConfig = { thinkingLevel: level };

  const stream = await ai.models.generateContentStream({ model, contents, config });

  const accumulator = { text: '', toolCalls: [] };
  let finishReason = '';
  for await (const chunk of stream) {
    const candidate = chunk.candidates && chunk.candidates[0];
    if (!candidate) continue;
    consumeGeminiParts(candidate.content && candidate.content.parts, onEvent, accumulator);
    if (candidate.finishReason) finishReason = String(candidate.finishReason);
  }

  return { text: accumulator.text, toolCalls: accumulator.toolCalls, finishReason };
}

// -------------------------------------------------------------
// PROVIDER DISPATCH
// -------------------------------------------------------------

function buildStudioStreamEndpoint(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
}

function buildEnterpriseStreamEndpoint(projectId, location, model, apiKey) {
  const loc = location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
}

/** Run one model call, whichever provider is configured. */
async function streamStep(options) {
  const { provider, credentials = {}, enterpriseAuthMethod = 'api-key' } = options;

  if (provider === 'fireworks') {
    return streamFireworksStep(options);
  }

  if (provider === 'gemini-enterprise' && enterpriseAuthMethod !== 'api-key') {
    return streamVertexSdkStep(options);
  }

  const isEnterprise = provider === 'gemini-enterprise';
  const key = isEnterprise
    ? process.env.GEMINI_API_KEY || process.env.API_KEY || credentials.enterpriseApiKey
    : process.env.GEMINI_API_KEY || process.env.API_KEY || credentials.apiKey;
  if (!key) throw new Error(isEnterprise ? 'Agent Platform API Key is missing.' : 'Gemini API Key is missing.');
  if (isEnterprise && !options.enterpriseProjectId) {
    throw new Error('GCP Project ID is required for Gemini Enterprise.');
  }

  const endpoint = isEnterprise
    ? buildEnterpriseStreamEndpoint(options.enterpriseProjectId, options.enterpriseLocation, options.model, key)
    : buildStudioStreamEndpoint(options.model, key);

  return streamGeminiRestStep({ ...options, endpoint });
}

// -------------------------------------------------------------
// AGENT LOOP
// -------------------------------------------------------------

/**
 * Run one assistant turn: call the model, execute any tools it asks for, feed
 * the results back, and repeat until it answers in prose or the step budget
 * runs out.
 *
 * @param {object} options
 * @param {string} options.provider
 * @param {string} options.model
 * @param {Array}  options.messages   – neutral conversation, system message first
 * @param {Array}  options.tools      – [{ name, description, parameters }]
 * @param {Function} options.runTool  – (name, args) => Promise<{ ok, result?, error? }>
 * @param {Function} options.onEvent  – receives text/thinking/tool events as they happen
 * @param {number} [options.maxSteps]
 * @returns {Promise<{ text: string, steps: Array, messages: Array }>}
 */
async function runAgentTurn(options) {
  const { messages, runTool, onEvent = () => {}, maxSteps = DEFAULT_MAX_STEPS } = options;
  if (!options.model) throw new Error('No model selected.');

  const conversation = [...messages];
  const steps = [];
  // Text a model writes before asking for a tool ("Let me check…") is streamed
  // to the user, so it has to survive into the stored message too — otherwise
  // the answer visibly loses a sentence the moment it finishes.
  let narration = '';

  for (let step = 0; step < maxSteps; step++) {
    const result = await streamStep({ ...options, messages: conversation, onEvent });

    if (result.toolCalls.length === 0) {
      let finalText = narration + result.text;
      if (isTruncated(result.finishReason)) {
        const note = '\n\n_(Response was cut off by the output token limit.)_';
        finalText += note;
        onEvent({ type: 'text', delta: note });
      }
      conversation.push({ role: 'assistant', content: result.text });
      return { text: finalText, steps, messages: conversation };
    }

    if (result.text.trim()) narration += `${result.text.trim()}\n\n`;
    conversation.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      onEvent({ type: 'tool_call', id: call.id, name: call.name, args: call.args });
      const startedAt = Date.now();
      const outcome = await runTool(call.name, call.args);
      const ms = Date.now() - startedAt;

      const content = outcome.ok
        ? JSON.stringify(outcome.result)
        : JSON.stringify({ error: outcome.error });

      steps.push({ name: call.name, args: call.args, ok: outcome.ok, error: outcome.error || '', ms });
      onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: outcome.ok, error: outcome.error || '', ms });

      conversation.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
    }
  }

  // Budget exhausted: say so rather than returning a silent empty answer.
  const note = `I ran out of lookups (${maxSteps}) before settling on an answer. Try narrowing the question to one day or one meal.`;
  onEvent({ type: 'text', delta: `\n\n${note}` });
  return { text: `${narration}${note}`, steps, messages: conversation };
}

function isTruncated(finishReason) {
  const reason = String(finishReason || '').toUpperCase();
  return reason === 'LENGTH' || reason === 'MAX_TOKENS';
}

module.exports = { runAgentTurn, DEFAULT_MAX_STEPS };
