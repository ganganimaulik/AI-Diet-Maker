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
  water?: string;
  prepMethod: string;
  cookQuantityMode?: 'daily' | 'per-meal';
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
  /** Verify every generated plan and regenerate it until it passes. */
  verificationAutoRetry?: boolean;
  /** Regenerations allowed after the first attempt (0 = verify once, never retry). */
  verificationMaxRetries?: number;
  /** Chat assistant provider/model; blank = reuse the generation ones. */
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
  meals: Meal[];
  splits?: {
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

/**
 * Generation state of a single day. Tracked per day so days can run
 * concurrently. 'verifying' is part of the same server job as 'generating' —
 * the plan is not finished until its verdict is in.
 */
export type DayProgress = 'checking' | 'queued' | 'generating' | 'verifying' | 'done' | 'error';

/** Streamed / cached response held for one day. */
export interface DayOutput {
  text: string;
  thinking: string;
  isCached: boolean;
}

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Which half of a running job is executing right now. */
export type GenerationJobPhase = 'generating' | 'verifying';

/**
 * One automatic verification pass inside a generation job. A job keeps the
 * whole list, including attempts whose plans were thrown away, so the
 * dashboard can show why a plan was regenerated.
 */
export interface VerificationAttempt {
  attempt: number;
  /** 'passed' | 'failed' (regenerated if retries remained) | 'error' (verification itself could not run) | 'skipped'. */
  status: 'passed' | 'failed' | 'error' | 'skipped';
  errorCount: number;
  warningCount: number;
  issues: VerificationIssue[];
  aiStatus: string;
  aiVerdict: string;
  aiSummary: string;
  error: string;
  generatedAt: string | null;
  checkedAt: string | null;
}

/** Durable server-side generation job returned by /api/generate. */
export interface GenerationJob {
  jobId: string;
  day: string;
  status: GenerationJobStatus;
  phase: GenerationJobPhase;
  responseText: string;
  thinkingText: string;
  error: string;
  cacheable: boolean;
  isCurrentConfig: boolean;
  /** This run verifies each plan and regenerates until it passes. */
  autoVerify: boolean;
  /** 1-based generation pass currently running (0 before the first starts). */
  generationAttempt: number;
  /** Ceiling on generation passes: 1 + the configured retries. */
  maxGenerationAttempts: number;
  /** Verdict on the plan this job finished with; null when never verified. */
  verificationOk: boolean | null;
  verificationAttempts: VerificationAttempt[];
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

/** One read-only database lookup the assistant made while answering. */
export interface ChatToolStep {
  name: string;
  args: unknown;
  ok: boolean;
  error: string;
  ms: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Lookups behind this answer, shown as an expandable trace. */
  steps: ChatToolStep[];
  /** Set when the turn failed; the message stays so the transcript shows why. */
  error: string;
  createdAt: string;
}

export interface ChatThreadSummary {
  threadId: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}

/** Human wording for each assistant tool, shown while it runs. */
export const TOOL_LABELS: Record<string, string> = {
  db_schema: 'Checking what the database holds',
  list_days: 'Checking which days have plans',
  get_diet_config: 'Reading your diet setup',
  get_day_plan: 'Reading the plan',
  db_query: 'Querying the database',
  db_count: 'Counting records'
};

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
  verificationAutoRetry: true,
  verificationMaxRetries: 3,
  agentProvider: '',
  agentModel: '',
  agentCustomModel: '',
  agentThinkingLevel: 'low',
  agentReasoningEffort: 'default',
  agentMaxTokens: 8192,
  huggingFaceToken: '',
  huggingFaceSpace: 'ganganimaulik/diet-maker-worker',
  global: {
    dailyCalorieTarget: 3200,
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
        { name: 'Banana', weight: '', isAuto: true, minGrams: '50', maxGrams: '70' },
        { name: 'Water', weight: '290', isAuto: false }
      ],
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
        { name: 'aamchur powder', weight: '2', isAuto: false, split: '2g in subji' },
        { name: 'Table Salt (NaCl)', weight: '3', isAuto: false, split: '3g in subji' }
      ],
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
        { name: 'Olive oil', weight: '10', isAuto: false },
        { name: 'Table Salt (NaCl)', weight: '4', isAuto: false }
      ],
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
        { name: 'Olive oil', weight: '7', isAuto: false },
        { name: 'Water', weight: '100', isAuto: false },
        { name: 'Table Salt (NaCl)', weight: '1', isAuto: false }
      ],
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
        { name: 'Banana', weight: '100', isAuto: false },
        { name: 'Water', weight: '330', isAuto: false }
      ],
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
  customSplits: [],
  dailySplits: {},
  selectedGenerationDay: 'MONDAY'
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const normalizeConfig = (loaded: any): Config => {
  const normalized = { ...DEFAULT_CONFIG, ...loaded };
  normalized.global = {
    dailyCalorieTarget: loaded.global?.dailyCalorieTarget ?? DEFAULT_CONFIG.global.dailyCalorieTarget,
    idealSodiumPotassiumRatioMin: loaded.global?.idealSodiumPotassiumRatioMin ?? DEFAULT_CONFIG.global.idealSodiumPotassiumRatioMin,
    idealSodiumPotassiumRatioMax: loaded.global?.idealSodiumPotassiumRatioMax ?? DEFAULT_CONFIG.global.idealSodiumPotassiumRatioMax
  };

  const rawMeals = Array.isArray(loaded.meals) && loaded.meals.length > 0
    ? loaded.meals
    : DEFAULT_CONFIG.meals;

  normalized.meals = rawMeals.map((m: any) => {
    const ingredients = Array.isArray(m.ingredients) ? [...m.ingredients] : [];

    // Migrate meal.water to Water ingredient if present. Only gram/ml values
    // migrate cleanly; anything else ("1 liter water", "none", free text) is
    // kept on the meal so the prompt can still mention it if desired — but we
    // deliberately do not invent a bogus ingredient from unparseable text.
    if (m.water && typeof m.water === 'string' && m.water.trim()) {
      const text = m.water.trim();
      // "290g water", "290 ml water", "290 water" → weight 290, name "Water".
      // Reject anything that is not a bare number + optional g/ml + optional name.
      const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:g|ml)?\s*(.*)$/i);
      const weight = match ? match[1] : '';
      const rest = match && match[2] ? match[2].trim() : '';
      // Only migrate when the remainder is empty or clearly a liquid name
      // (single word like "water"/"milk"). Multi-word remainders are likely
      // instructions, not names (e.g. "liter water" from "1 liter water").
      const isSimpleLiquid = !rest || /^[a-z]+$/i.test(rest);
      if (weight && isSimpleLiquid) {
        const capitalized = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : 'Water';
        const exists = ingredients.some(
          (ing: any) => ing.name && ing.name.trim().toLowerCase() === capitalized.toLowerCase()
        );
        if (!exists) {
          ingredients.push({
            name: capitalized,
            weight,
            isAuto: false,
            disabled: false
          });
        }
      }
    }

    return {
      ...m,
      ingredients,
      water: '',
      disabled: !!m.disabled
    };
  });

  // Migrate customSplits into meal ingredients. Two kinds of legacy splits:
  //  - salt/seasoning splits with gram quantities ("3g in subji", "4g") →
  //    become a real ingredient (e.g. "Table Salt (NaCl)", weight in grams,
  //    the allocation text kept as the ingredient's `split` instruction).
  //  - prep-method splits with no gram quantity ("Chicken air fryer 200c,
  //    15 min") → are NOT ingredients; they are folded into the owning meal's
  //    prepMethod so no phantom "Chicken Prep Method 1g" ingredient appears.
  const incomingSplits = Array.isArray(loaded.customSplits) ? loaded.customSplits : [];
  for (const s of incomingSplits) {
    if (!s || !s.value || !String(s.value).trim()) continue;
    const targetMealId = s.mealId || (normalized.meals.some((m: Meal) => m.id === 'meal-chicken') ? 'meal-chicken' : normalized.meals[0]?.id);
    const meal = normalized.meals.find((m: Meal) => m.id === targetMealId);
    if (!meal) continue;

    const value = String(s.value).trim();
    const rawName = (s.name || '').trim();
    const match = value.match(/(\d+(?:\.\d+)?)\s*g/i);
    const weight = match ? match[1] : '';

    // No gram quantity → this is an instruction, not an ingredient. Append it
    // to the meal's prep method instead of creating a bogus "1g" ingredient.
    if (!weight) {
      if (!String(meal.prepMethod || '').includes(value)) {
        meal.prepMethod = [meal.prepMethod, value].filter(Boolean).join('\n');
      }
      continue;
    }

    const isSalt = /salt/i.test(rawName);
    const ingredientName = isSalt ? 'Table Salt (NaCl)' : (rawName || 'Seasoning');
    const splitText = value !== `${weight}g` && value !== `${weight} g` ? value : '';

    const existing = meal.ingredients.find(
      (ing: any) => ing.name && ing.name.trim().toLowerCase() === ingredientName.toLowerCase()
    );
    if (!existing) {
      const newIng: Ingredient = { name: ingredientName, weight, isAuto: false, disabled: false };
      if (splitText) newIng.split = splitText;
      meal.ingredients.push(newIng);
    } else if (!existing.weight) {
      // Existing ingredient has no weight: adopt the split's weight.
      existing.weight = weight;
      if (splitText && !existing.split) existing.split = splitText;
    } else if (String(existing.weight).trim() !== weight) {
      // Weight conflict: keep the existing ingredient's weight but preserve the
      // divergent allocation as its split instruction so no data is lost.
      if (splitText && !existing.split) existing.split = splitText;
      console.warn(
        `[normalizeConfig] "${meal.name}": split "${rawName}" says ${weight}g but existing ` +
        `"${ingredientName}" is ${existing.weight}g — keeping the existing weight.`
      );
    }
  }

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

  // Migrate per-day split overrides (dailySplits) into that day's
  // dailyVariables, so the per-day data is not lost. A day-level salt/seasoning
  // override becomes a daily variable ingredient on the split's owning meal,
  // overriding whatever the migrated meal-level ingredient says.
  const fallbackMealId = normalized.meals.some((m: Meal) => m.id === 'meal-chicken')
    ? 'meal-chicken'
    : normalized.meals[0]?.id;
  if (loaded.dailySplits && typeof loaded.dailySplits === 'object') {
    const splitById = new Map(incomingSplits.map((s: any) => [s.id, s]));
    for (const day of Object.keys(loaded.dailySplits)) {
      const overrides = loaded.dailySplits[day] || [];
      for (const o of overrides) {
        if (!o || !o.value || !String(o.value).trim()) continue;
        const value = String(o.value).trim();
        const match = value.match(/(\d+(?:\.\d+)?)\s*g/i);
        if (!match) continue; // instruction-only override; global migration already folded it into prepMethod
        const parent: any = splitById.get(o.id);
        const rawName = ((o.name || parent?.name || '') as string).trim();
        const isSalt = /salt/i.test(rawName);
        const ingredientName = isSalt ? 'Table Salt (NaCl)' : (rawName || 'Seasoning');
        const mealId = parent?.mealId || fallbackMealId;
        const dayVars = (normalized.dailyVariables[day] = normalized.dailyVariables[day] || []);
        const existing = dayVars.find(
          (ing: Ingredient) => ing.name && ing.name.trim().toLowerCase() === ingredientName.toLowerCase()
            && (ing.mealId || fallbackMealId) === mealId
        );
        const splitText = value !== `${match[1]}g` && value !== `${match[1]} g` ? value : '';
        if (existing) {
          existing.weight = match[1];
          if (splitText) existing.split = splitText;
        } else {
          const newVar: Ingredient = { name: ingredientName, weight: match[1], isAuto: false, disabled: false, mealId };
          if (splitText) newVar.split = splitText;
          dayVars.push(newVar);
        }
      }
    }
  }

  normalized.customSplits = [];
  normalized.dailySplits = {};
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
