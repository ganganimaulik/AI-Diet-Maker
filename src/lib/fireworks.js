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

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Build Fireworks.ai chat completion payload.
 */
function buildFireworksPayload(model, prompt, { temperature = 0.1, stream = false, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  return {
    model: model,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    max_tokens: maxTokens,
    stream: stream
  };
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
  buildFireworksPayload,
  extractFireworksChunk,
  createFireworksStreamExtractor,
  extractFireworksResponse,
  parseFireworksErrorText
};
