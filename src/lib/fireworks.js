/**
 * Shared Fireworks.ai API helpers.
 *
 * Used by:
 *   - src/app/api/generate/route.ts (ES import, streaming)
 *   - whatsapp-worker.js            (CommonJS require, non-streaming)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const FIREWORKS_API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';

// Fireworks defaults max_tokens to 2000, which truncates a full day plan long
// before it is finished (reasoning tokens draw on the same budget). Always send
// an explicit budget, and let callers check finishReason for the rest.
const DEFAULT_MAX_TOKENS = 16384;

// reasoning_effort values exposed by Fireworks' OpenAI-compatible endpoint.
// 'default' means "omit the field" and let the model decide. Individual models
// support only a subset; use getReasoningEffortsForModel() for UI controls.
const REASONING_EFFORTS = [
  'default',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'none'
];

const DEFAULT_REASONING_EFFORTS = ['default'];
const DEEPSEEK_V4_REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'none'];
const KIMI_K3_REASONING_EFFORTS = ['default', 'low', 'high', 'max'];
const GLM_5P3_REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'max'];
const QWEN_3P8_MAX_REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'none'];
const QWEN_3P7_REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'none'];

/**
 * Return only the reasoning_effort values documented for one Fireworks model.
 * Unknown/custom models stay on provider default rather than risking a 400 for
 * a model-specific value. Model ids are compacted so Fireworks ids and common
 * custom aliases (dots, dashes, and slashes) resolve identically.
 */
function getReasoningEffortsForModel(model) {
  const compactModel = String(model || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (compactModel.includes('deepseekv4')) {
    return [...DEEPSEEK_V4_REASONING_EFFORTS];
  }
  if (compactModel.includes('kimik3')) {
    return [...KIMI_K3_REASONING_EFFORTS];
  }
  if (compactModel.includes('glm5p3flash') || compactModel.includes('glm53flash')) {
    return [...DEFAULT_REASONING_EFFORTS];
  }
  if (compactModel.includes('glm5p3') || compactModel.includes('glm53')) {
    return [...GLM_5P3_REASONING_EFFORTS];
  }
  if (compactModel.includes('qwen3p8max') || compactModel.includes('qwen38max')) {
    return [...QWEN_3P8_MAX_REASONING_EFFORTS];
  }
  if (compactModel.includes('qwen3p7') || compactModel.includes('qwen37')) {
    return [...QWEN_3P7_REASONING_EFFORTS];
  }

  // Llama Maverick, MiniMax M3, GLM 5.3 Flash, and unknown custom models do
  // not expose a compatible documented effort ladder through this endpoint.
  return [...DEFAULT_REASONING_EFFORTS];
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Build Fireworks.ai chat completion payload.
 *
 * `maxTokens` of 0/blank falls back to DEFAULT_MAX_TOKENS; `reasoningEffort` is
 * only sent when the user picked something other than the provider default.
 */
function buildFireworksPayload(model, prompt, { temperature = 0.1, stream = false, maxTokens = 0, reasoningEffort = '' } = {}) {
  const requestedMaxTokens = Number(maxTokens);
  const payload = {
    model: model,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    max_tokens: requestedMaxTokens > 0 ? requestedMaxTokens : DEFAULT_MAX_TOKENS,
    stream: stream
  };
  if (reasoningEffort && reasoningEffort !== 'default') {
    payload.reasoning_effort = reasoningEffort;
  }
  return payload;
}

/**
 * Extract { text, thought, finishReason } from a streaming chunk or delta object.
 * DeepSeek R1 and similar reasoning models on Fireworks return reasoning tokens in `reasoning_content`.
 * Models that inline raw <think> tags in `content` instead are handled by
 * createFireworksStreamExtractor(), which carries state across chunks.
 */
function extractFireworksChunk(data) {
  if (!data || !data.choices || !data.choices[0]) {
    return { text: '', thought: '', finishReason: '' };
  }

  const choice = data.choices[0];
  const delta = choice.delta || {};

  return {
    text: delta.content || '',
    thought: delta.reasoning_content || '',
    finishReason: choice.finish_reason || ''
  };
}

/**
 * Length of the longest suffix of `s` that is also a prefix of `tag`
 * (case-insensitive). Used to hold back a tag split across two SSE chunks.
 */
function partialTagLength(s, tag) {
  const lower = s.toLowerCase();
  const lowerTag = tag.toLowerCase();
  const max = Math.min(lower.length, lowerTag.length - 1);
  for (let n = max; n > 0; n--) {
    if (lower.endsWith(lowerTag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Create a stateful extractor for one Fireworks SSE stream.
 *
 * Gives the streaming path the same <think>...</think> separation that
 * extractFireworksResponse() gives the non-streaming path. A tag can straddle a
 * chunk boundary, so the tail of each chunk is buffered until it can no longer
 * become one. Call flush() once the stream ends to drain a held-back partial
 * tag or an unterminated <think> block.
 */
function createFireworksStreamExtractor() {
  let buffer = '';
  let inThink = false;

  const extract = (data) => {
    const chunk = extractFireworksChunk(data);
    let text = '';
    let thought = chunk.thought;

    buffer += chunk.text;

    // Consume every complete tag currently in the buffer.
    for (;;) {
      const tag = inThink ? THINK_CLOSE : THINK_OPEN;
      const idx = buffer.toLowerCase().indexOf(tag);
      if (idx === -1) break;
      const before = buffer.slice(0, idx);
      if (inThink) thought += before;
      else text += before;
      buffer = buffer.slice(idx + tag.length);
      inThink = !inThink;
    }

    // Emit everything that can no longer turn into a tag.
    const held = partialTagLength(buffer, inThink ? THINK_CLOSE : THINK_OPEN);
    const ready = buffer.slice(0, buffer.length - held);
    buffer = buffer.slice(buffer.length - held);
    if (inThink) thought += ready;
    else text += ready;

    return { text, thought, finishReason: chunk.finishReason };
  };

  extract.flush = () => {
    const rest = buffer;
    const wasInThink = inThink;
    buffer = '';
    inThink = false;
    return wasInThink
      ? { text: '', thought: rest, finishReason: '' }
      : { text: rest, thought: '', finishReason: '' };
  };

  return extract;
}

/**
 * Split every <think>...</think> block out of `text` — including a trailing one
 * the model never closed — returning the remaining answer and joined reasoning.
 */
function stripThinkBlocks(text) {
  const thoughts = [];
  let stripped = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, inner) => {
    thoughts.push(inner);
    return '';
  });

  // A block the model never closed (e.g. the response hit max_tokens).
  const unterminated = stripped.match(/<think>([\s\S]*)$/i);
  if (unterminated) {
    thoughts.push(unterminated[1]);
    stripped = stripped.slice(0, unterminated.index);
  }

  return {
    text: stripped.trim(),
    thought: thoughts.join('\n\n').trim()
  };
}

/**
 * Extract { text, thought, finishReason } from a full non-streaming response body.
 */
function extractFireworksResponse(data) {
  if (!data || !data.choices || !data.choices[0]) {
    return { text: '', thought: '', finishReason: '' };
  }

  const choice = data.choices[0];
  const message = choice.message || {};
  let thought = message.reasoning_content || '';
  let text = message.content || '';

  // If reasoning_content was not separated but raw <think> tags are present in content:
  if (!thought && /<think>/i.test(text)) {
    const split = stripThinkBlocks(text);
    text = split.text;
    thought = split.thought;
  }

  return { text, thought, finishReason: choice.finish_reason || '' };
}

/**
 * Turn a non-OK Fireworks API response body into a readable error message.
 */
function parseFireworksErrorText(errorText, fallbackMessage) {
  const fallback = fallbackMessage || 'Failed to generate content from Fireworks API.';
  try {
    const errorJson = JSON.parse(errorText);
    const err = errorJson.error;
    const isErrObject = !!err && typeof err === 'object';
    const candidates = [
      isErrObject ? err.message : err,
      isErrObject ? err.code : '',
      errorJson.message
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
    return fallback;
  } catch {
    return errorText || fallback;
  }
}

module.exports = {
  FIREWORKS_API_URL,
  DEFAULT_MAX_TOKENS,
  REASONING_EFFORTS,
  getReasoningEffortsForModel,
  buildFireworksPayload,
  extractFireworksChunk,
  createFireworksStreamExtractor,
  extractFireworksResponse,
  parseFireworksErrorText
};
