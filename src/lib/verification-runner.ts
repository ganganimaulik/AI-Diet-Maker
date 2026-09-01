/**
 * TypeScript wrapper around the shared verification-runner.js module.
 * The pipeline lives in verification-runner.js so whatsapp-worker.js can
 * require() it for the automatic post-generation verification.
 */

import type { IVerificationResult } from '@/lib/db';
import type { VerificationFeasibility, VerificationIssue } from '@/lib/verify-plan';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('./verification-runner.js');

export interface AiReview {
  status: 'skipped' | 'ok' | 'failed';
  provider?: string;
  model?: string;
  verdict?: string;
  summary?: string;
  error?: string;
}

export interface RunPlanVerificationOptions {
  /** Run the review model on top of the arithmetic pass. */
  aiReview?: boolean;
  /** Hash of the config the plan was generated under. */
  configHash?: string;
  /** Stamp of the exact plan being judged. */
  planGeneratedAt?: Date | null;
  signal?: AbortSignal;
}

/** The record stored as one day's VerificationResult. */
export type VerificationRecord = Omit<IVerificationResult, 'aiReview'> & { aiReview: AiReview };

export const runPlanVerification: (
  config: unknown,
  day: string,
  planText: string,
  options?: RunPlanVerificationOptions
) => Promise<VerificationRecord> = runner.runPlanVerification;

/** Corrective block appended to the prompt when a rejected plan is regenerated. */
export const buildRetryFeedback: (
  day: string,
  rejectedAttempt: number,
  issues: Array<VerificationIssue & { source?: 'math' | 'ai' }>,
  feasibility?: VerificationFeasibility | null
) => string = runner.buildRetryFeedback;
