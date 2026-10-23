import mongoose, { Model } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

/**
 * Global is used here to maintain a cached connection across hot-reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
const cached: MongooseCache = globalThis.mongoose || { conn: null, promise: null };

if (!globalThis.mongoose) {
  globalThis.mongoose = cached;
}

export async function dbConnect() {
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local or settings.');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI!, opts).then((mongooseInstance) => {
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

// -------------------------------------------------------------
// INTERFACES
// The mongoose schemas themselves live in models.js so they can be
// shared with whatsapp-worker.js via CommonJS require().
// -------------------------------------------------------------

export interface IIngredient {
  name: string;
  weight: string;
  isAuto: boolean;
  disabled?: boolean;
  personalOnly?: boolean;
  split?: string;
  maxGrams?: string;
  minGrams?: string;
  mealId?: string;
}

export interface ICustomSplit {
  id: string;
  name: string;
  value: string;
  mealId?: string;
}

export interface IMeal {
  id: string;
  name: string;
  mealsPerDay: number;
  ingredients: IIngredient[];
  water: string;
  prepMethod: string;
  cookQuantityMode?: 'daily' | 'per-meal';
  disabled?: boolean;
}

export interface IConfig {
  apiKey: string;
  provider?: string;
  fireworksApiKey?: string;
  enterpriseAuthMethod?: string;
  enterpriseApiKey?: string;
  enterpriseProjectId?: string;
  enterpriseLocation?: string;
  enterpriseServiceAccountJson?: string;
  model: string;
  customModel: string;
  thinkingLevel: string;
  maxTokens?: number;
  reasoningEffort?: string;
  /** 'deterministic' computes the plan locally instead of calling a model. */
  generationEngine?: 'llm' | 'deterministic';
  verificationAiReview?: boolean;
  verificationProvider?: string;
  verificationModel?: string;
  verificationCustomModel?: string;
  verificationThinkingLevel?: string;
  verificationReasoningEffort?: string;
  verificationMaxTokens?: number;
  /** Verify each generated plan and regenerate it until it passes. */
  verificationAutoRetry?: boolean;
  /** Regenerations allowed after the first attempt. */
  verificationMaxRetries?: number;
  /** Chat assistant settings; blank provider/model reuses the generation ones. */
  agentProvider?: string;
  agentModel?: string;
  agentCustomModel?: string;
  agentThinkingLevel?: string;
  agentReasoningEffort?: string;
  agentMaxTokens?: number;
  global: {
    dailyCalorieTarget: number;
    idealSodiumPotassiumRatioMin?: number;
    idealSodiumPotassiumRatioMax?: number;
  };
  meals: IMeal[];
  customSplits: ICustomSplit[];
  dailyVariables: {
    [key: string]: IIngredient[];
  };
  dailySplits?: {
    [key: string]: ICustomSplit[];
  };
  selectedGenerationDay: string;
  huggingFaceToken?: string;
  huggingFaceSpace?: string;
  updatedAt: Date;
}

export interface IWhatsAppState {
  status: 'disconnected' | 'connecting' | 'qr_code' | 'ready';
  qr: string; // Base64 data URL
  connectedPhone: string;
  connectedName: string;
  updatedAt: Date;
}

export interface IContact {
  id: string; // e.g. "919876543210@c.us" or group ID
  name: string;
  isGroup: boolean;
  updatedAt: Date;
}

export interface IScheduler {
  isEnabled: boolean;
  targetTime: string; // "14:00" (24h format HH:MM)
  timezone: string; // "Asia/Kolkata"
  recipientType: 'contact' | 'group';
  recipientId: string; // "919876543210@c.us"
  recipientName: string;
  userRecipientType: 'contact' | 'group';
  userRecipientId: string;
  userRecipientName: string;
  lastSentDate: string; // "YYYY-MM-DD"
  lastSentTime: string; // "HH:MM"
  lastError: string;
  retryCount: number;
  nextRetryTime: number; // Timestamp ms
  triggerTest: boolean; // Flag to run manual check
  triggerCookTest?: boolean;
  triggerMyselfTest?: boolean;
  updatedAt: Date;
}

export interface ICachedResponse {
  day: string; // MONDAY, TUESDAY, etc.
  configHash: string; // SHA-256 hash of diet-relevant config
  responseText: string; // The generated AI response
  thinkingText: string; // The AI thinking output
  generatedAt: Date;
  updatedAt: Date;
}

/** One day's stored verification verdict (see src/lib/verify-plan.js). */
export interface IVerificationResult {
  day: string;
  configHash: string;
  planGeneratedAt: Date | null;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: Array<{
    severity: 'error' | 'warning';
    category: string;
    message: string;
    source: 'math' | 'ai';
  }>;
  computed: unknown;
  stated: unknown;
  feasibility: unknown;
  target: number;
  aiReview: unknown;
  checkedAt: Date;
}

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Which half of a running job is executing right now. */
export type GenerationJobPhase = 'generating' | 'verifying';

/** One automatic verification pass inside a generation job. */
export interface IGenerationVerificationAttempt {
  attempt: number;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  errorCount: number;
  warningCount: number;
  issues: IVerificationResult['issues'];
  aiStatus: string;
  aiVerdict: string;
  aiSummary: string;
  error: string;
  generatedAt: Date | null;
  checkedAt: Date | null;
}

export interface IGenerationJob {
  jobId: string;
  day: string;
  status: GenerationJobStatus;
  phase: GenerationJobPhase;
  cancelRequested: boolean;
  prompt: string;
  /** Engine this job was queued for; snapshotted from the config. */
  engine: 'llm' | 'deterministic';
  provider: string;
  model: string;
  thinkingLevel: string;
  maxTokens: number;
  reasoningEffort: string;
  enterpriseAuthMethod: string;
  enterpriseProjectId: string;
  enterpriseLocation: string;
  configHash: string;
  cacheable: boolean;
  autoVerify: boolean;
  generationAttempt: number;
  maxGenerationAttempts: number;
  verificationAttempts: IGenerationVerificationAttempt[];
  verificationOk: boolean | null;
  responseText: string;
  thinkingText: string;
  error: string;
  leaseId: string;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One database read the assistant made while answering. */
export interface IChatToolStep {
  name: string;
  args: unknown;
  ok: boolean;
  error: string;
  ms: number;
}

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps: IChatToolStep[];
  error: string;
  createdAt: Date;
}

/**
 * One assistant conversation. Written by the app on the assistant's behalf —
 * the assistant's own database access stays read-only, and it cannot read this
 * collection at all.
 */
export interface IChatThread {
  threadId: string;
  title: string;
  messages: IChatMessage[];
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const models = require('./models.js');

export const Config: Model<IConfig> = models.Config;
export const WhatsAppState: Model<IWhatsAppState> = models.WhatsAppState;
export const Contact: Model<IContact> = models.Contact;
export const Scheduler: Model<IScheduler> = models.Scheduler;
export const CachedResponse: Model<ICachedResponse> = models.CachedResponse;
export const GenerationJob: Model<IGenerationJob> = models.GenerationJob;
export const VerificationResult: Model<IVerificationResult> = models.VerificationResult;
export const ChatThread: Model<IChatThread> = models.ChatThread;
