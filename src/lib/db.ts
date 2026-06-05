import mongoose, { Schema, Document } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Global is used here to maintain a cached connection across hot-reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
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
// SCHEMAS & INTERFACES
// -------------------------------------------------------------

// 1. Config Schema (Diet Maker Page settings)
export interface IIngredient {
  name: string;
  weight: string;
  isAuto: boolean;
}

export interface ICustomSplit {
  id: string;
  name: string;
  value: string;
}

export interface IMeal {
  id: string;
  name: string;
  mealsPerDay: number;
  ingredients: IIngredient[];
  water: string;
  prepMethod: string;
}

export interface IConfig {
  apiKey: string;
  model: string;
  customModel: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  global: {
    dailyCalorieTarget: number;
    totalOliveOil: number;
    oliveOilSplitPercent: number;
  };
  meals: IMeal[];
  customSplits: ICustomSplit[];
  dailyVariables: {
    [key: string]: IIngredient[];
  };
  generationRange: 'all' | 'single';
  selectedGenerationDay: string;
  updatedAt: Date;
}

const IngredientSchema = new Schema({
  name: { type: String, required: true },
  weight: { type: String, default: '' },
  isAuto: { type: Boolean, default: false }
}, { _id: false });

const CustomSplitSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  value: { type: String, required: true }
}, { _id: false });

const MealSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  mealsPerDay: { type: Number, default: 1 },
  ingredients: [IngredientSchema],
  water: { type: String, default: '' },
  prepMethod: { type: String, default: '' }
}, { _id: false });

const ConfigSchema = new Schema<IConfig>({
  apiKey: { type: String, default: '' },
  model: { type: String, default: 'gemini-3.5-flash' },
  customModel: { type: String, default: 'gemini-3.5-flash' },
  thinkingEnabled: { type: Boolean, default: true },
  thinkingBudget: { type: Number, default: 2048 },
  global: {
    dailyCalorieTarget: { type: Number, default: 1600 },
    totalOliveOil: { type: Number, default: 18 },
    oliveOilSplitPercent: { type: Number, default: 50 }
  },
  meals: [MealSchema],
  customSplits: [CustomSplitSchema],
  dailyVariables: {
    type: Map,
    of: [IngredientSchema],
    default: {}
  },
  generationRange: { type: String, enum: ['all', 'single'], default: 'all' },
  selectedGenerationDay: { type: String, default: 'MONDAY' }
}, { timestamps: true });

// 2. WhatsApp Client State Schema
export interface IWhatsAppState {
  status: 'disconnected' | 'connecting' | 'qr_code' | 'ready';
  qr: string; // Base64 data URL
  connectedPhone: string;
  connectedName: string;
  updatedAt: Date;
}

const WhatsAppStateSchema = new Schema<IWhatsAppState>({
  status: { type: String, enum: ['disconnected', 'connecting', 'qr_code', 'ready'], default: 'disconnected' },
  qr: { type: String, default: '' },
  connectedPhone: { type: String, default: '' },
  connectedName: { type: String, default: '' }
}, { timestamps: true });

// 3. Cached Contacts Schema
export interface IContact {
  id: string; // e.g. "919876543210@c.us" or group ID
  name: string;
  isGroup: boolean;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false }
}, { timestamps: true });

// 4. Scheduler Schema
export interface IScheduler {
  isEnabled: boolean;
  targetTime: string; // "07:30" (24h format HH:MM)
  recipientType: 'contact' | 'group';
  recipientId: string; // "919876543210@c.us"
  recipientName: string;
  lastSentDate: string; // "YYYY-MM-DD"
  lastError: string;
  retryCount: number;
  nextRetryTime: number; // Timestamp ms
  triggerTest: boolean; // Flag to run manual check
  updatedAt: Date;
}

const SchedulerSchema = new Schema<IScheduler>({
  isEnabled: { type: Boolean, default: false },
  targetTime: { type: String, default: '07:30' },
  recipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  recipientId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  lastSentDate: { type: String, default: '' },
  lastError: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextRetryTime: { type: Number, default: 0 },
  triggerTest: { type: Boolean, default: false }
}, { timestamps: true });

// Compile models
export const Config = mongoose.models.Config || mongoose.model<IConfig>('Config', ConfigSchema);
export const WhatsAppState = mongoose.models.WhatsAppState || mongoose.model<IWhatsAppState>('WhatsAppState', WhatsAppStateSchema);
export const Contact = mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);
export const Scheduler = mongoose.models.Scheduler || mongoose.model<IScheduler>('Scheduler', SchedulerSchema);
