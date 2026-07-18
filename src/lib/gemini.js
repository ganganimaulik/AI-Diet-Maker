/**
 * Shared Gemini API helpers.
 *
 * Used by:
 *   - src/app/api/generate/route.ts (ES import, streaming)
 *   - whatsapp-worker.js            (CommonJS require, non-streaming)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

/**
 * Collapse a Gemini candidate `parts` array into { text, thought } strings.
 * Thought parts (part.thought truthy) go into `thought`; the rest into `text`.
 * Falls back to joining all part texts when neither bucket got content.
 */
function extractPartsText(parts) {
  const list = parts || [];
  let text = '';
  let thought = '';
  for (const part of list) {
    if (part.thought) {
      thought += part.text || '';
    } else if (part.text) {
      text += part.text;
    }
  }
  if (!text && !thought && list.length > 0) {
    text = list.map((p) => p.text || '').join('');
  }
  return { text, thought };
}

/**
 * Extract { text, thought } from a full (non-streaming) or chunked (streaming)
 * Gemini API response body.
 */
function extractResponseText(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  return extractPartsText(parts);
}

/**
 * Build the REST request payload shared by AI Studio and Vertex endpoints.
 */
function buildGenerationPayload(prompt, thinkingEnabled, thinkingBudget) {
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
    }
  };
  if (thinkingEnabled) {
    payload.generationConfig.thinkingConfig = {
      thinkingBudget: thinkingBudget
    };
  }
  return payload;
}

/**
 * Google AI Studio endpoint URL.
 */
function buildStudioEndpoint(model, apiKey, { stream = false } = {}) {
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  const suffix = stream ? '&alt=sse' : '';
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}${suffix}`;
}

/**
 * Vertex AI (Gemini Enterprise) endpoint URL for API-key auth.
 */
function buildEnterpriseEndpoint(projectId, location, model, apiKey, { stream = false } = {}) {
  const loc = location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  const suffix = stream ? '&alt=sse' : '';
  return `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${model}:${method}?key=${apiKey}${suffix}`;
}

/**
 * Turn a non-OK Gemini REST response body into a readable error message.
 */
function parseGeminiErrorText(errorText, fallbackMessage) {
  let errorMessage = fallbackMessage;
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = (errorJson.error && errorJson.error.message) || errorMessage;
  } catch {
    errorMessage = errorText || errorMessage;
  }
  return errorMessage;
}

module.exports = {
  extractPartsText,
  extractResponseText,
  buildGenerationPayload,
  buildStudioEndpoint,
  buildEnterpriseEndpoint,
  parseGeminiErrorText
};
