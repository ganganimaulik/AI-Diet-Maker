/**
 * TypeScript wrapper around the shared fireworks.js module.
 * The core logic lives in fireworks.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fireworks = require('./fireworks.js');

export interface FireworksExtract {
  text: string;
  thought: string;
  finishReason?: string;
}

/** Stateful extractor for one SSE stream; flush() drains the tail buffer. */
export interface FireworksStreamExtractor {
  (data: unknown): FireworksExtract;
  flush: () => FireworksExtract;
}

export interface FireworksPayload {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
}

export const FIREWORKS_API_URL: string = fireworks.FIREWORKS_API_URL;
export const buildFireworksPayload: (
  model: string,
  prompt: string,
  opts?: { temperature?: number; stream?: boolean; maxTokens?: number }
) => FireworksPayload = fireworks.buildFireworksPayload;
export const extractFireworksChunk: (data: unknown) => FireworksExtract = fireworks.extractFireworksChunk;
export const createFireworksStreamExtractor: () => FireworksStreamExtractor = fireworks.createFireworksStreamExtractor;
export const extractFireworksResponse: (data: unknown) => FireworksExtract = fireworks.extractFireworksResponse;
export const parseFireworksErrorText: (errorText: string, fallbackMessage?: string) => string = fireworks.parseFireworksErrorText;
