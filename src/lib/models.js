/**
 * Shared mongoose schemas & models.
 *
 * Used by:
 *   - src/lib/db.ts       (ES import, for Next.js API routes)
 *   - whatsapp-worker.js  (CommonJS require)
 *
 * Keep this file as plain JS so it works in both contexts without a build step.
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

// 1. Config Schema (Diet Maker Page settings)
const IngredientSchema = new Schema({
  name: { type: String, required: true },
  weight: { type: String, default: '' },
  isAuto: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  personalOnly: { type: Boolean, default: false },
  split: { type: String, default: '' },
  maxGrams: { type: String, default: '' },
  minGrams: { type: String, default: '' },
  mealId: { type: String, default: '' }
}, { _id: false });

// name/value intentionally not required: a freshly added split starts empty
// (the prompt compiler skips splits with an empty value).
const CustomSplitSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, default: '' },
  value: { type: String, default: '' },
  mealId: { type: String, default: '' }
}, { _id: false });

const MealSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  mealsPerDay: { type: Number, default: 1 },
  ingredients: [IngredientSchema],
  water: { type: String, default: '' },
  prepMethod: { type: String, default: '' },
  cookQuantityMode: { type: String, enum: ['daily', 'per-meal'], default: 'daily' },
  totalOliveOil: { type: Number, default: 0 },
  oliveOilSplitPercent: { type: Number, default: 50 },
  disabled: { type: Boolean, default: false }
}, { _id: false });

const ConfigSchema = new Schema({
  apiKey: { type: String, default: '' },
  provider: { type: String, default: 'google-ai-studio' },
  enterpriseAuthMethod: { type: String, default: 'api-key' },
  enterpriseApiKey: { type: String, default: '' },
  enterpriseProjectId: { type: String, default: '' },
  enterpriseLocation: { type: String, default: 'global' },
  enterpriseServiceAccountJson: { type: String, default: '' },
  model: { type: String, default: 'gemini-3.6-flash' },
  customModel: { type: String, default: 'gemini-3.6-flash' },
  thinkingEnabled: { type: Boolean, default: true },
  thinkingBudget: { type: Number, default: 2048 },
  global: {
    dailyCalorieTarget: { type: Number, default: 1600 },
    totalOliveOil: { type: Number, default: 18 },
    oliveOilSplitPercent: { type: Number, default: 50 },
    idealSodiumPotassiumRatioMin: { type: Number, default: 0.70 },
    idealSodiumPotassiumRatioMax: { type: Number, default: 0.80 }
  },
  meals: [MealSchema],
  customSplits: [CustomSplitSchema],
  dailyVariables: {
    type: Map,
    of: [IngredientSchema],
    default: {}
  },
  dailySplits: {
    type: Map,
    of: [CustomSplitSchema],
    default: {}
  },
  selectedGenerationDay: { type: String, default: 'MONDAY' },
  huggingFaceToken: { type: String, default: '' },
  huggingFaceSpace: { type: String, default: 'ganganimaulik/diet-maker-worker' }
}, { timestamps: true });

// 2. WhatsApp Client State Schema
const WhatsAppStateSchema = new Schema({
  status: { type: String, enum: ['disconnected', 'connecting', 'qr_code', 'ready'], default: 'disconnected' },
  qr: { type: String, default: '' },
  connectedPhone: { type: String, default: '' },
  connectedName: { type: String, default: '' },
  // Consecutive auth failures across worker restarts; the stored session is
  // wiped only after several in a row (a single failure is usually a deploy race)
  authFailureCount: { type: Number, default: 0 }
}, { timestamps: true });

// 3. Cached Contacts Schema
const ContactSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false }
}, { timestamps: true });

// 4. Scheduler Schema
const SchedulerSchema = new Schema({
  isEnabled: { type: Boolean, default: false },
  targetTime: { type: String, default: '14:00' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  recipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  recipientId: { type: String, default: '' },
  recipientName: { type: String, default: '' },
  userRecipientType: { type: String, enum: ['contact', 'group'], default: 'contact' },
  userRecipientId: { type: String, default: '' },
  userRecipientName: { type: String, default: '' },
  lastSentDate: { type: String, default: '' },
  lastSentTime: { type: String, default: '' },
  lastError: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  nextRetryTime: { type: Number, default: 0 },
  triggerTest: { type: Boolean, default: false },
  triggerCookTest: { type: Boolean, default: false },
  triggerMyselfTest: { type: Boolean, default: false }
}, { timestamps: true });

// 5. Cached Response Schema (AI diet plan cache per day)
const CachedResponseSchema = new Schema({
  day: { type: String, required: true },
  configHash: { type: String, required: true },
  responseText: { type: String, default: '' },
  thinkingText: { type: String, default: '' },
  generatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Ensure one cached response per day
CachedResponseSchema.index({ day: 1 }, { unique: true });

// Compile models (reuse existing compilations across hot reloads)
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);
const WhatsAppState = mongoose.models.WhatsAppState || mongoose.model('WhatsAppState', WhatsAppStateSchema);
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);
const Scheduler = mongoose.models.Scheduler || mongoose.model('Scheduler', SchedulerSchema);
const CachedResponse = mongoose.models.CachedResponse || mongoose.model('CachedResponse', CachedResponseSchema);

module.exports = {
  Config,
  WhatsAppState,
  Contact,
  Scheduler,
  CachedResponse
};
