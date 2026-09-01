/**
 * Single-shot (non-streaming) completion across the three supported providers.
 *
 * Plan generation streams from the always-on worker; the verification pass is a
 * short request/response with no progress to show, so it lives here instead and
 * can run straight from an API route.
 *
 * Used by:
 *   - src/app/api/verify/route.ts (ES import via ai-complete.ts)
 *
 * Keep this file as plain JS so whatsapp-worker.js can require() it too.
 */

const {
  buildGenerationPayload,
  buildStudioEndpoint,
  buildEnterpriseEndpoint,
  extractResponseText,
  extractPartsText,
  normalizeThinkingLevel,
  parseGeminiErrorText
} = require('./gemini.js');

const {
  FIREWORKS_API_URL,
  buildFireworksPayload,
  extractFireworksResponse,
  parseFireworksErrorText
} = require('./fireworks.js');

/**
 * Run one prompt through a provider and return its text.
 *
 * @param {object} options
 * @param {string} options.provider            – 'fireworks' | 'google-ai-studio' | 'gemini-enterprise'
 * @param {string} options.model               – Resolved model id (custom already substituted)
 * @param {string} options.prompt
 * @param {object} options.credentials         – { fireworksApiKey, apiKey, enterpriseApiKey, enterpriseServiceAccountJson }
 * @param {string} [options.thinkingLevel]     – Gemini only
 * @param {string} [options.reasoningEffort]   – Fireworks only
 * @param {number} [options.maxTokens]         – 0 = provider default
 * @param {string} [options.enterpriseAuthMethod]
 * @param {string} [options.enterpriseProjectId]
 * @param {string} [options.enterpriseLocation]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ text: string, thought: string, finishReason: string }>}
 */
async function completeOnce({
  provider,
  model,
  prompt,
  credentials = {},
  thinkingLevel = 'default',
  reasoningEffort = 'default',
  maxTokens = 0,
  enterpriseAuthMethod = 'api-key',
  enterpriseProjectId = '',
  enterpriseLocation = 'global',
  signal
}) {
  if (!model) throw new Error('No model selected.');

  if (provider === 'fireworks') {
    const key = process.env.FIREWORKS_API_KEY || credentials.fireworksApiKey;
    if (!key) throw new Error('Fireworks API Key is missing.');

    const response = await fetch(FIREWORKS_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFireworksPayload(model, prompt, { temperature: 0, stream: false, maxTokens, reasoningEffort })),
      signal
    });
    if (!response.ok) {
      throw new Error(parseFireworksErrorText(await response.text(), 'Fireworks request failed.'));
    }
    return extractFireworksResponse(await response.json());
  }

  if (provider === 'gemini-enterprise' && enterpriseAuthMethod !== 'api-key') {
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

    const generationConfig = { temperature: 0 };
    if (signal) generationConfig.abortSignal = signal;
    if (Number(maxTokens) > 0) generationConfig.maxOutputTokens = Number(maxTokens);
    const level = normalizeThinkingLevel(thinkingLevel);
    if (level) generationConfig.thinkingConfig = { thinkingLevel: level };

    const result = await ai.models.generateContent({ model, contents: prompt, config: generationConfig });
    const candidate = result.candidates && result.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    return { ...extractPartsText(parts), finishReason: String((candidate && candidate.finishReason) || '') };
  }

  const isEnterprise = provider === 'gemini-enterprise';
  const key = isEnterprise
    ? (process.env.GEMINI_API_KEY || process.env.API_KEY || credentials.enterpriseApiKey)
    : (process.env.GEMINI_API_KEY || process.env.API_KEY || credentials.apiKey);
  if (!key) throw new Error(isEnterprise ? 'Agent Platform API Key is missing.' : 'Gemini API Key is missing.');
  if (isEnterprise && !enterpriseProjectId) throw new Error('GCP Project ID is required for Gemini Enterprise.');

  const endpoint = isEnterprise
    ? buildEnterpriseEndpoint(enterpriseProjectId, enterpriseLocation, model, key, { stream: false })
    : buildStudioEndpoint(model, key, { stream: false });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGenerationPayload(prompt, thinkingLevel, { maxOutputTokens: maxTokens })),
    signal
  });
  if (!response.ok) {
    throw new Error(parseGeminiErrorText(await response.text(), 'Gemini request failed.'));
  }
  return extractResponseText(await response.json());
}

module.exports = { completeOnce };
