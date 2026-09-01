// Shared client-side types, defaults and config helpers for the Diet Maker UI.

export interface Ingredient {
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

export interface CustomSplit {
  id: string;
  name: string;
  value: string;
  mealId?: string;
}

export interface Meal {
  id: string;
  name: string;
  mealsPerDay: number;
  ingredients: Ingredient[];
  water: string;
  prepMethod: string;
  cookQuantityMode?: 'daily' | 'per-meal';
  totalOliveOil?: number;
  oliveOilSplitPercent?: number;
  disabled?: boolean;
}

export interface Config {
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
  /** Gemini thinking depth; 'default' = don't send it, else low|medium|high. */
  thinkingLevel: string;
  /** Output token cap; 0 = provider default. */
  maxTokens?: number;
  /** Fireworks reasoning_effort; 'default' = don't send it. */
  reasoningEffort?: string;
  /** Run a second-opinion AI review on top of the arithmetic check. */
  verificationAiReview?: boolean;
  /** Verification provider/model; blank = reuse the generation ones. */
  verificationProvider?: string;
  verificationModel?: string;
  verificationCustomModel?: string;
  verificationThinkingLevel?: string;
  verificationReasoningEffort?: string;
  verificationMaxTokens?: number;
  global: {
    dailyCalorieTarget: number;
    totalOliveOil: number;
    oliveOilSplitPercent: number;
    idealSodiumPotassiumRatioMin?: number;
    idealSodiumPotassiumRatioMax?: number;
  };
  meals: Meal[];
  splits?: {
    oliveOilSplit: string;
    saltSplit: string;
    chickenPrepMethod: string;
  };
  customSplits?: CustomSplit[];
  dailyVariables: {
    [key: string]: Ingredient[];
  };
  dailySplits?: {
    [key: string]: CustomSplit[];
  };
  selectedGenerationDay: string;
  huggingFaceToken?: string;
  huggingFaceSpace?: string;
}

export interface WhatsAppStatus {
  status: string;
  qr: string;
  connectedPhone: string;
  connectedName: string;
}

export interface SchedulerState {
  isEnabled: boolean;
  targetTime: string;
  timezone: string;
  recipientType: 'contact' | 'group';
  recipientId: string;
  recipientName: string;
  userRecipientType: 'contact' | 'group';
  userRecipientId: string;
  userRecipientName: string;
  lastSentDate: string;
  lastSentTime: string;
  lastError: string;
  retryCount: number;
  nextRetryTime: number;
}

export interface ContactEntry {
  id: string;
  name: string;
  isGroup: boolean;
}

export const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** Generation state of a single day. Tracked per day so days can run concurrently. */
export type DayProgress = 'checking' | 'queued' | 'generating' | 'done' | 'error';

/** Streamed / cached response held for one day. */
export interface DayOutput {
  text: string;
  thinking: string;
  isCached: boolean;
}

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Durable server-side generation job returned by /api/generate. */
export interface GenerationJob {
  jobId: string;
  day: string;
  status: GenerationJobStatus;
  responseText: string;
  thinkingText: string;
  error: string;
  cacheable: boolean;
  isCurrentConfig: boolean;
}

/** One finding from either the arithmetic checker or the review model. */
export interface VerificationIssue {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  source: 'math' | 'ai';
}

export interface VerificationTotals {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sodium: number | null;
  potassium: number | null;
  ratio: number | null;
  saltGrams?: number;
  inIdealRange?: boolean | null;
  verdict?: string | null;
}

export interface VerificationFeasibility {
  calorieTargetReachable: boolean;
  bestRatio: number | null;
  ratioReachable: boolean;
  extraPotassiumNeededMg?: number;
  saltReductionNeededG?: number;
}

export interface VerificationAiReview {
  status: 'skipped' | 'ok' | 'failed';
  provider?: string;
  model?: string;
  verdict?: string;
  summary?: string;
  error?: string;
}

/** A day's verification verdict as returned by /api/verify. */
export interface DayVerification {
  day: string;
  ok: boolean;
  checkedAt: string;
  errorCount: number;
  warningCount: number;
  issues: VerificationIssue[];
  computed: VerificationTotals | null;
  stated: VerificationTotals | null;
  feasibility: VerificationFeasibility | null;
  target?: number;
  aiReview: VerificationAiReview | null;
  /** The plan or config changed after this verdict was computed. */
  isStale: boolean;
}

export const DEFAULT_CONFIG: Config = {
  apiKey: '',
  provider: 'gemini-enterprise',
  fireworksApiKey: '',
  enterpriseAuthMethod: 'service-account',
  enterpriseApiKey: '',
  enterpriseProjectId: 'gen-lang-client-0131109551',
  enterpriseLocation: 'global',
  enterpriseServiceAccountJson: '',
  model: 'gemini-3.7-flash',
  customModel: 'gemini-3.7-flash',
  thinkingLevel: 'high',
  maxTokens: 65536,
  reasoningEffort: 'default',
  verificationAiReview: false,
  verificationProvider: '',
  verificationModel: '',
  verificationCustomModel: '',
  verificationThinkingLevel: 'default',
  verificationReasoningEffort: 'default',
  verificationMaxTokens: 0,
  huggingFaceToken: '',
  huggingFaceSpace: 'ganganimaulik/diet-maker-worker',
  global: {
    dailyCalorieTarget: 3200,
    totalOliveOil: 18,
    oliveOilSplitPercent: 50,
    idealSodiumPotassiumRatioMin: 0.79,
    idealSodiumPotassiumRatioMax: 0.80
  },
  meals: [
    {
      id: 'meal-1784100564298',
      name: 'Oats Egg Omelette',
      mealsPerDay: 1,
      cookQuantityMode: 'daily',
      disabled: true,
      ingredients: [
        { name: 'oats', weight: '', isAuto: true },
        { name: 'olive oil', weight: '8', isAuto: false },
        { name: 'eggs', weight: '200', isAuto: false },
        { name: 'tomato', weight: '', isAuto: true, minGrams: '100', maxGrams: '120' }
      ],
      water: '',
      prepMethod: ''
    },
    {
      id: 'meal-oats',
      name: 'Oats Meal 1',
      mealsPerDay: 1,
      cookQuantityMode: 'daily',
      disabled: false,
      ingredients: [
        { name: 'Instant Oats (Raw)', weight: '', isAuto: true, minGrams: '70', maxGrams: '100' },
        { name: 'Whey Protein Isolate - myprotein matcha blueberry', weight: '60', isAuto: false },
        { name: 'Almonds', weight: '15', isAuto: false },
        { name: 'Cashews', weight: '15', isAuto: false },
        { name: 'Walnuts', weight: '5', isAuto: false, disabled: true },
        { name: 'Banana', weight: '', isAuto: true, minGrams: '50', maxGrams: '70' }
      ],
      water: '290g water',
      prepMethod: 'Oats airfryer 200c, 10min'
    },
    {
      id: 'meal-1784098317896',
      name: 'Oats Meal 2',
      mealsPerDay: 1,
      cookQuantityMode: 'daily',
      disabled: true,
      ingredients: [
        { name: 'Instant Oats (Raw)', weight: '', isAuto: true, minGrams: '70', maxGrams: '90' },
        { name: 'Fast & up Whey Protein Isolate', weight: '55', isAuto: false },
        { name: 'banana', weight: '', isAuto: true, minGrams: '120', maxGrams: '125' }
      ],
      water: '',
      prepMethod: ''
    },
    {
      id: 'meal-chicken',
      name: 'Vegitable Meal',
      mealsPerDay: 3,
      cookQuantityMode: 'daily',
      disabled: false,
      ingredients: [
        { name: 'Olive oil', weight: '9', isAuto: false, split: '9g in subji' },
        { name: 'aamchur powder', weight: '2', isAuto: false, split: '2g in subji' }
      ],
      water: '',
      prepMethod: '\n'
    },
    {
      id: 'meal-1784463984639',
      name: 'Chicken meal',
      mealsPerDay: 1,
      cookQuantityMode: 'per-meal',
      disabled: false,
      ingredients: [
        { name: 'chicken breast', weight: '425', isAuto: false },
        { name: 'tomato', weight: '', isAuto: true, minGrams: '100', maxGrams: '120' },
        { name: 'egg', weight: '37', isAuto: false, disabled: true },
        { name: 'Olive oil', weight: '10', isAuto: false }
      ],
      water: '',
      prepMethod: 'gas pe bna dena onion garlic and green chili dal ke. '
    },
    {
      id: 'meal-oats-chilla',
      name: 'Oats Chilla',
      mealsPerDay: 1,
      cookQuantityMode: 'per-meal',
      disabled: true,
      ingredients: [
        { name: 'Instant Oats (Raw)', weight: '75', isAuto: false },
        { name: 'Besan', weight: '50', isAuto: false },
        { name: 'Tomato', weight: '', isAuto: true, minGrams: '50', maxGrams: '80' },
        { name: 'Olive oil', weight: '7', isAuto: false }
      ],
      water: '100g water',
      prepMethod: 'Whisk oats powder, besan, tomato, green chilli, coriander, ajwain and salt with water. Cook crisp on tawa with olive oil.'
    },
    {
      id: 'meal-shake',
      name: 'Shake Meal',
      mealsPerDay: 1,
      cookQuantityMode: 'per-meal',
      disabled: false,
      ingredients: [
        { name: 'Whey Protein Isolate - myprotein matcha blueberry', weight: '40', isAuto: false },
        { name: 'Oats (Raw)', weight: '15', isAuto: false },
        { name: 'Raisins', weight: '15', isAuto: false },
        { name: 'Kimia Dates', weight: '15', isAuto: false },
        { name: 'Banana', weight: '100', isAuto: false }
      ],
      water: '330g water',
      prepMethod: 'Blend all ingredients with water'
    }
  ],
  dailyVariables: {
    MONDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '400' },
      { name: 'Brinjal', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '120' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' },
      { name: 'Eggs', weight: '80', isAuto: false, mealId: 'meal-chicken', disabled: true }
    ],
    TUESDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '400' },
      { name: 'Bottle Gourd', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '129' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' }
    ],
    WEDNESDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' },
      { name: 'Sweet Potato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '280' }
    ],
    THURSDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Spinach', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '100', maxGrams: '150' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '200' }
    ],
    FRIDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '400' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' }
    ],
    SATURDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '90', maxGrams: '100' },
      { name: 'Sweet Potato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '380' }
    ],
    SUNDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '60' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '400' },
      { name: 'Cluster Beans', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '50', maxGrams: '150' },
      { name: 'Tomato', weight: '', isAuto: true, mealId: 'meal-chicken', minGrams: '80', maxGrams: '100' }
    ]
  },
  customSplits: [
    { id: 'salt', name: 'Salt Seasoning Split', value: ' 3g in subji', mealId: 'meal-chicken' },
    { id: '1784465883936', name: 'salt', value: '4g', mealId: 'meal-1784463984639' },
    { id: 'salt-oats-chilla', name: 'Salt in Oats Chilla', value: '1g', mealId: 'meal-oats-chilla' }
  ],
  dailySplits: {},
  selectedGenerationDay: 'MONDAY'
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const normalizeConfig = (loaded: any): Config => {
  const normalized = { ...DEFAULT_CONFIG, ...loaded };
  normalized.global = { ...DEFAULT_CONFIG.global, ...(loaded.global || {}) };
  normalized.meals = Array.isArray(loaded.meals) && loaded.meals.length > 0
    ? loaded.meals.map((m: any) => ({ ...m, disabled: !!m.disabled }))
    : DEFAULT_CONFIG.meals;

  // Ensure dailyVariables has mealId populated, defaulting to 'meal-chicken'
  if (loaded.dailyVariables) {
    const updatedVars: { [key: string]: Ingredient[] } = {};
    for (const day of Object.keys(loaded.dailyVariables)) {
      updatedVars[day] = (loaded.dailyVariables[day] || []).map((ing: any) => ({
        ...ing,
        mealId: ing.mealId || 'meal-chicken'
      }));
    }
    normalized.dailyVariables = updatedVars;
  } else {
    normalized.dailyVariables = DEFAULT_CONFIG.dailyVariables;
  }

  normalized.dailySplits = loaded.dailySplits || {};

  // Migrate old splits or populate customSplits if empty
  if (!loaded.customSplits || !Array.isArray(loaded.customSplits) || loaded.customSplits.length === 0) {
    if (loaded.splits) {
      normalized.customSplits = [
        { id: 'salt', name: 'Salt Seasoning Split', value: loaded.splits.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: loaded.splits.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
      ];
    } else {
      normalized.customSplits = [
        { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
        { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
      ];
    }
  } else {
    normalized.customSplits = loaded.customSplits;
  }

  // Ensure every split is attached to a meal so it shows up in that meal's editor
  const splitFallbackMealId = normalized.meals.some((m: Meal) => m.id === 'meal-chicken')
    ? 'meal-chicken'
    : normalized.meals[0]?.id;
  normalized.customSplits = (normalized.customSplits || []).map((s: CustomSplit) => ({
    ...s,
    mealId: s.mealId && normalized.meals.some((m: Meal) => m.id === s.mealId) ? s.mealId : splitFallbackMealId
  }));
  return normalized;
};

export const stableStringify = (obj: any): string => {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') + '}';
};
/* eslint-enable @typescript-eslint/no-explicit-any */
