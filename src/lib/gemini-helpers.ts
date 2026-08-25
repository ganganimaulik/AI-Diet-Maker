/**
 * TypeScript wrapper around the shared gemini.js module.
 * The core logic lives in gemini.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gemini = require('./gemini.js');

export interface GeminiPart {
  text?: string;
  thought?: boolean;
}

export interface GeminiExtract {
  text: string;
  thought: string;
}

export interface GeminiPayload {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig: {
    temperature: number;
    maxOutputTokens?: number;
    thinkingConfig?: {
      thinkingLevel: string;
    };
  };
}

export const normalizeThinkingLevel: (thinkingLevel?: string) => string = gemini.normalizeThinkingLevel;
export const extractPartsText: (parts: GeminiPart[]) => GeminiExtract = gemini.extractPartsText;
export const extractResponseText: (data: unknown) => GeminiExtract = gemini.extractResponseText;
export const buildGenerationPayload: (
  prompt: string,
  thinkingLevel: string,
  opts?: { maxOutputTokens?: number }
) => GeminiPayload = gemini.buildGenerationPayload;
export const buildStudioEndpoint: (
  model: string,
  apiKey: string,
  opts?: { stream?: boolean }
) => string = gemini.buildStudioEndpoint;
export const buildEnterpriseEndpoint: (
  projectId: string,
  location: string,
  model: string,
  apiKey: string,
  opts?: { stream?: boolean }
) => string = gemini.buildEnterpriseEndpoint;
export const parseGeminiErrorText: (errorText: string, fallbackMessage: string) => string = gemini.parseGeminiErrorText;
