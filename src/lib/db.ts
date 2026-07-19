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
  totalOliveOil?: number;
  oliveOilSplitPercent?: number;
  disabled?: boolean;
}

export interface IConfig {
  apiKey: string;
  provider?: string;
  enterpriseAuthMethod?: string;
  enterpriseApiKey?: string;
  enterpriseProjectId?: string;
  enterpriseLocation?: string;
  enterpriseServiceAccountJson?: string;
  model: string;
  customModel: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  global: {
    dailyCalorieTarget: number;
    totalOliveOil: number;
    oliveOilSplitPercent: number;
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
  generationRange: 'all' | 'single';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const models = require('./models.js');

export const Config: Model<IConfig> = models.Config;
export const WhatsAppState: Model<IWhatsAppState> = models.WhatsAppState;
export const Contact: Model<IContact> = models.Contact;
export const Scheduler: Model<IScheduler> = models.Scheduler;
export const CachedResponse: Model<ICachedResponse> = models.CachedResponse;
