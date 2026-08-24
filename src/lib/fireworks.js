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

/**
 * Build Fireworks.ai chat completion payload.
 */
function buildFireworksPayload(model, prompt, { temperature = 0.1, stream = false } = {}) {
  return {
    model: model,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: temperature,
    stream: stream
  };
}

/**
 * Extract { text, thought } from a streaming chunk or delta object.
 * DeepSeek R1 and similar reasoning models on Fireworks return reasoning tokens in `reasoning_content`.
 */
function extractFireworksChunk(data) {
  if (!data || !data.choices || !data.choices[0]) {
    return { text: '', thought: '' };
  }

  const delta = data.choices[0].delta || {};
  let thought = delta.reasoning_content || '';
  let text = delta.content || '';

  return { text, thought };
}

/**
 * Extract { text, thought } from a full non-streaming response body.
 */
function extractFireworksResponse(data) {
  if (!data || !data.choices || !data.choices[0]) {
    return { text: '', thought: '' };
  }

  const message = data.choices[0].message || {};
  let thought = message.reasoning_content || '';
  let text = message.content || '';

  // If reasoning_content was not separated but raw <think> tags are present in content:
  if (!thought && text.includes('<think>')) {
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thought = thinkMatch[1].trim();
      text = text.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    }
  }

  return { text, thought };
}

/**
 * Turn a non-OK Fireworks API response body into a readable error message.
 */
function parseFireworksErrorText(errorText, fallbackMessage) {
  let errorMessage = fallbackMessage || 'Failed to generate content from Fireworks API.';
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = (errorJson.error && (errorJson.error.message || errorJson.error)) ||
                   errorJson.message ||
                   errorMessage;
  } catch {
    errorMessage = errorText || errorMessage;
  }
  return errorMessage;
}

module.exports = {
  FIREWORKS_API_URL,
  buildFireworksPayload,
  extractFireworksChunk,
  extractFireworksResponse,
  parseFireworksErrorText
};
