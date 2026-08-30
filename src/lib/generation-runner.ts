/**
 * TypeScript wrapper around the shared generation-runner.js module.
 * The lifecycle logic lives in generation-runner.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

import type { Model } from 'mongoose';
import type { IGenerationJob } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('./generation-runner.js');

export const LEASE_DURATION_MS: number = runner.LEASE_DURATION_MS;
export const HEARTBEAT_INTERVAL_MS: number = runner.HEARTBEAT_INTERVAL_MS;

export const requeueStaleJobs: (
  model: Model<IGenerationJob>,
  now?: Date
) => Promise<number> = runner.requeueStaleJobs;
