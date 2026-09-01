/**
 * TypeScript wrapper around the shared ai-complete.js module.
 * The provider logic lives in ai-complete.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const aiComplete = require('./ai-complete.js');

export interface CompleteOnceOptions {
  provider: string;
  model: string;
  prompt: string;
  credentials?: {
    fireworksApiKey?: string;
    apiKey?: string;
    enterpriseApiKey?: string;
    enterpriseServiceAccountJson?: string;
  };
  thinkingLevel?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  enterpriseAuthMethod?: string;
  enterpriseProjectId?: string;
  enterpriseLocation?: string;
  signal?: AbortSignal;
}

export interface CompleteOnceResult {
  text: string;
  thought: string;
  finishReason: string;
}

export const completeOnce: (options: CompleteOnceOptions) => Promise<CompleteOnceResult> = aiComplete.completeOnce;
