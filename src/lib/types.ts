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

export const DEFAULT_CONFIG: Config = {
  apiKey: '',
  provider: 'google-ai-studio',
  enterpriseAuthMethod: 'api-key',
  enterpriseApiKey: '',
  enterpriseProjectId: '',
  enterpriseLocation: 'global',
  enterpriseServiceAccountJson: '',
  model: 'gemini-3.7-flash',
  customModel: 'gemini-3.7-flash',
  thinkingEnabled: true,
  thinkingBudget: 2048,
  huggingFaceToken: '',
  huggingFaceSpace: 'ganganimaulik/diet-maker-worker',
  global: {
    dailyCalorieTarget: 1600,
    totalOliveOil: 18,
    oliveOilSplitPercent: 50,
    idealSodiumPotassiumRatioMin: 0.70,
    idealSodiumPotassiumRatioMax: 0.80
  },
  meals: [
    {
      id: 'meal-oats',
      name: 'Oats Meal',
      mealsPerDay: 1,
      cookQuantityMode: 'daily',
      ingredients: [
        { name: 'Oats (Raw)', weight: '30', isAuto: false },
        { name: 'Whey Protein Isolate', weight: '60', isAuto: false },
        { name: 'Almonds', weight: '5', isAuto: false },
        { name: 'Cashews', weight: '5', isAuto: false },
        { name: 'Walnuts', weight: '5', isAuto: false },
        { name: 'Banana', weight: '60', isAuto: false }
      ],
      water: '190g water',
      prepMethod: 'Oats airfryer 200c, 10min'
    },
    {
      id: 'meal-chicken',
      name: 'Chicken Meal',
      mealsPerDay: 3,
      cookQuantityMode: 'daily',
      ingredients: [
        { name: 'Chicken Breast (Raw)', weight: '425', isAuto: false },
        { name: 'Olive oil', weight: '18', isAuto: false, split: '9g in subji, 9g in chicken' }
      ],
      water: '',
      prepMethod: 'Chicken air fryer 200c, 15 min'
    },
    {
      id: 'meal-shake',
      name: 'Shake Meal',
      mealsPerDay: 1,
      cookQuantityMode: 'daily',
      disabled: true,
      ingredients: [
        { name: 'Whey Protein Isolate', weight: '40', isAuto: false },
        { name: 'Oats (Raw)', weight: '30', isAuto: false },
        { name: 'Raisins', weight: '10', isAuto: false },
        { name: 'Kimia Dates', weight: '10', isAuto: false },
        { name: 'Banana', weight: '100', isAuto: false }
      ],
      water: '',
      prepMethod: 'Blend all ingredients with water'
    }
  ],
  dailyVariables: {
    MONDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '180', isAuto: false, mealId: 'meal-chicken' }
    ],
    TUESDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Potato (Raw)', weight: '150', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '80', isAuto: false, mealId: 'meal-chicken' }
    ],
    WEDNESDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Cluster Beans', weight: '185', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '80', isAuto: false, mealId: 'meal-chicken' }
    ],
    THURSDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Bottle Gourd', weight: '185', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '80', isAuto: false, mealId: 'meal-chicken' }
    ],
    FRIDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Cluster Beans', weight: '180', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '80', isAuto: false, mealId: 'meal-chicken' }
    ],
    SATURDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Potato (Raw)', weight: '150', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Bottle Gourd', weight: '185', isAuto: false, mealId: 'meal-chicken' }
    ],
    SUNDAY: [
      { name: 'Rice', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Potato (Raw)', weight: '', isAuto: true, mealId: 'meal-chicken' },
      { name: 'Brinjal', weight: '180', isAuto: false, mealId: 'meal-chicken' },
      { name: 'Tomato', weight: '80', isAuto: false, mealId: 'meal-chicken' }
    ]
  },
  customSplits: [
    { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste', mealId: 'meal-chicken' },
    { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min', mealId: 'meal-chicken' }
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
