'use client';
/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useEffect, useRef } from 'react';

// Type definitions
interface Ingredient {
  name: string;
  weight: string;
  isAuto: boolean;
}

interface CustomSplit {
  id: string;
  name: string;
  value: string;
}

interface Meal {
  id: string;
  name: string;
  mealsPerDay: number;
  ingredients: Ingredient[];
  water: string;
  prepMethod: string;
}

interface Config {
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
  generationRange: 'all' | 'single';
  selectedGenerationDay: string;
  huggingFaceToken?: string;
  huggingFaceSpace?: string;
}

const DEFAULT_CONFIG: Config = {
  apiKey: '',
  provider: 'google-ai-studio',
  enterpriseAuthMethod: 'api-key',
  enterpriseApiKey: '',
  enterpriseProjectId: '',
  enterpriseLocation: 'global',
  enterpriseServiceAccountJson: '',
  model: 'gemini-3.5-flash',
  customModel: 'gemini-3.5-flash',
  thinkingEnabled: true,
  thinkingBudget: 2048,
  huggingFaceToken: '',
  huggingFaceSpace: 'ganganimaulik/diet-maker-worker',
  global: {
    dailyCalorieTarget: 1600,
    totalOliveOil: 18,
    oliveOilSplitPercent: 50
  },
  meals: [
    {
      id: 'meal-oats',
      name: 'Oats Meal',
      mealsPerDay: 1,
      ingredients: [
        { name: 'Oats (Raw)', weight: '35', isAuto: false },
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
      ingredients: [
        { name: 'Chicken Breast (Raw)', weight: '425', isAuto: false }
      ],
      water: '',
      prepMethod: 'Chicken air fryer 200c, 15 min'
    }
  ],
  dailyVariables: {
    MONDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Tomato', weight: '180', isAuto: false }
    ],
    TUESDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '150', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    WEDNESDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Cluster Beans', weight: '185', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    THURSDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Bottle Gourd', weight: '185', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    FRIDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '', isAuto: true },
      { name: 'Cluster Beans', weight: '180', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    SATURDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '150', isAuto: false },
      { name: 'Bottle Gourd', weight: '185', isAuto: false }
    ],
    SUNDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '', isAuto: true },
      { name: 'Brinjal', weight: '180', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ]
  },
  customSplits: [
    { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
    { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
  ],
  dailySplits: {},
  generationRange: 'all',
  selectedGenerationDay: 'MONDAY'
};

const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const normalizeConfig = (loaded: any): Config => {
  const normalized = { ...DEFAULT_CONFIG, ...loaded };
  normalized.global = { ...DEFAULT_CONFIG.global, ...(loaded.global || {}) };
  normalized.meals = Array.isArray(loaded.meals) && loaded.meals.length > 0 ? loaded.meals : DEFAULT_CONFIG.meals;
  normalized.dailyVariables = loaded.dailyVariables || DEFAULT_CONFIG.dailyVariables;
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
  return normalized;
};

export default function Home() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [isMounted, setIsMounted] = useState(false);
  const [currentView, setCurrentView] = useState<'planner' | 'connections'>('planner');
  const [activeTab, setActiveTab] = useState<string>('global');
  const [activeDay, setActiveDay] = useState<string>('MONDAY');
  
  // Drag and drop states for day swap
  const [draggedDay, setDraggedDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  
  // Custom prompt override state
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  
  // UI states
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Output and generation states
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [outputText, setOutputText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [outputTab, setOutputTab] = useState<'user' | 'cook' | 'thoughts'>('user');
  const [copiedStatus, setCopiedStatus] = useState(false);

  // Authentication and Save states
  const [isAuthenticatedState, setIsAuthenticatedState] = useState<boolean | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const isInitialLoaded = useRef(false);

  // WhatsApp bot states
  const [whatsappState, setWhatsappState] = useState({
    status: 'disconnected',
    qr: '',
    connectedPhone: '',
    connectedName: '',
  });
  const [schedulerState, setSchedulerState] = useState({
    isEnabled: false,
    targetTime: '07:30',
    timezone: 'Asia/Kolkata',
    recipientType: 'contact' as 'contact' | 'group',
    recipientId: '',
    recipientName: '',
    lastSentDate: '',
    lastError: '',
    retryCount: 0,
    nextRetryTime: 0,
  });
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; isGroup: boolean }>>([]);
  const [searchContact, setSearchContact] = useState('');
  const [showContactsDropdown, setShowContactsDropdown] = useState(false);
  const [isSavingScheduler, setIsSavingScheduler] = useState(false);
  const [testSendStatus, setTestSendStatus] = useState({ status: 'idle', message: '' });

  // Hugging Face Space status states
  const [hfStatus, setHfStatus] = useState('NOT_CONFIGURED');
  const [hfDetails, setHfDetails] = useState<any>(null);
  const [showHfToken, setShowHfToken] = useState(false);
  const [wakingUp, setWakingUp] = useState(false);
  const [isResettingWhatsapp, setIsResettingWhatsapp] = useState(false);

  // Database Save Config Function
  const saveConfig = async (configToSave = config) => {
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configToSave)
      });
      if (!res.ok) {
        throw new Error('Failed to save configuration.');
      }
      setHasUnsavedChanges(false);
    } catch (e) {
      console.error('Error saving config:', e);
      alert('Failed to save configuration to database.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // WhatsApp Poll Utilities
  const fetchWhatsAppStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        if (data.state) setWhatsappState(data.state);
        if (data.scheduler) {
          setSchedulerState(data.scheduler);
        }
        if (data.hfSpaceStatus) setHfStatus(data.hfSpaceStatus);
        if (data.hfSpaceDetails) setHfDetails(data.hfSpaceDetails);
      }
    } catch (e) {
      console.error('Error fetching WhatsApp status:', e);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/whatsapp/contacts');
      if (res.ok) {
        const data = await res.json();
        if (data.contacts) setContacts(data.contacts);
      }
    } catch (e) {
      console.error('Error fetching contacts:', e);
    }
  };

  const handleWakeUpSpace = async () => {
    if (!config.huggingFaceSpace) return;
    setWakingUp(true);
    try {
      const normalized = config.huggingFaceSpace.replace(/[\/_.]/g, '-').toLowerCase();
      const spaceUrl = `https://${normalized}.hf.space/`;
      
      const headers: Record<string, string> = {};
      if (config.huggingFaceToken) {
        headers['Authorization'] = `Bearer ${config.huggingFaceToken}`;
      }

      await fetch(spaceUrl, { headers, mode: 'no-cors' });
      alert('Wake up request sent! Hugging Face takes about 30-60 seconds to boot up the container. The status badge will update automatically.');
      fetchWhatsAppStatus();
    } catch (e) {
      console.error('Error sending wake up request:', e);
      alert('Failed to send wake up request.');
    } finally {
      setWakingUp(false);
    }
  };

  const handleResetWhatsapp = async () => {
    if (!confirm('Are you sure you want to reset the WhatsApp connection? This will wipe the active session and force the worker to restart and generate a new QR code.')) {
      return;
    }
    setIsResettingWhatsapp(true);
    try {
      const res = await fetch('/api/whatsapp/reset', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || 'WhatsApp session reset successfully. Please wait 10-15 seconds for a new QR code.');
        // Refetch status immediately
        fetchWhatsAppStatus();
      } else {
        alert(data.error || 'Failed to reset WhatsApp session.');
      }
    } catch (e) {
      console.error('Error resetting WhatsApp:', e);
      alert('An error occurred while resetting WhatsApp session.');
    } finally {
      setIsResettingWhatsapp(false);
    }
  };

  // Check login and fetch config on mount
  useEffect(() => {
    const checkAuthAndLoad = async () => {
      try {
        const authRes = await fetch('/api/auth/check');
        const authData = await authRes.json();
        
        if (authData.authenticated) {
          setIsAuthenticatedState(true);
          
          // Fetch configuration from MongoDB
          const configRes = await fetch('/api/config');
          const configData = await configRes.json();
          
          if (configData.config) {
            setConfig(normalizeConfig(configData.config));
          } else {
            // First time setup, save default config to DB
            await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(DEFAULT_CONFIG)
            });
            setConfig(DEFAULT_CONFIG);
          }
          isInitialLoaded.current = true;
          fetchWhatsAppStatus();
          fetchContacts();
        } else {
          setIsAuthenticatedState(false);
        }
      } catch (e) {
        console.error('Error checking auth:', e);
        setIsAuthenticatedState(false);
      } finally {
        setIsMounted(true);
      }
    };
    
    checkAuthAndLoad();
  }, []);

  // Sync configuration updates
  useEffect(() => {
    if (isInitialLoaded.current) {
      setHasUnsavedChanges(true);
    }
  }, [config]);

  // WhatsApp Poll Loop
  useEffect(() => {
    if (isAuthenticatedState !== true) return;

    fetchWhatsAppStatus();
    
    // Poll status every 5 seconds to track QR updates or ready state changes
    const interval = setInterval(() => {
      fetchWhatsAppStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticatedState, activeTab, currentView]);

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      });
      const data = await res.json();
      if (res.ok) {
        setIsAuthenticatedState(true);
        // Load configuration from database
        const configRes = await fetch('/api/config');
        const configData = await configRes.json();
        
        if (configData.config) {
          setConfig(normalizeConfig(configData.config));
        } else {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(DEFAULT_CONFIG)
          });
          setConfig(DEFAULT_CONFIG);
        }
        isInitialLoaded.current = true;
        fetchWhatsAppStatus();
        fetchContacts();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      setLoginError('Network error occurred');
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/login', { method: 'DELETE' });
      setIsAuthenticatedState(false);
      isInitialLoaded.current = false;
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  // Save Scheduler data to MongoDB
  const saveSchedulerDb = async (stateToSave: typeof schedulerState) => {
    const res = await fetch('/api/whatsapp/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateToSave)
    });
    if (!res.ok) {
      throw new Error('Failed to save scheduler settings.');
    }
  };

  // Save Scheduler configuration
  const saveSchedulerSettings = async () => {
    setIsSavingScheduler(true);
    try {
      if (schedulerState.isEnabled && !schedulerState.recipientId) {
        alert('Please select a recipient (contact or group) before enabling the automated scheduler.');
        setIsSavingScheduler(false);
        return;
      }
      await saveSchedulerDb(schedulerState);
      alert('Scheduler settings saved successfully!');
    } catch (e) {
      alert('Failed to save scheduler settings.');
    } finally {
      setIsSavingScheduler(false);
    }
  };

  // Trigger immediate test message delivery
  const handleSendTestMessage = async () => {
    setTestSendStatus({ status: 'sending', message: 'Triggering test send...' });
    try {
      // Auto-save the config first to ensure today's test matches edits
      await saveConfig(config);
      
      // Auto-save scheduler settings first to ensure the recipient JID is updated in the DB
      await saveSchedulerDb(schedulerState);
      
      const res = await fetch('/api/whatsapp/send-test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTestSendStatus({ 
          status: 'success', 
          message: 'Test triggered successfully! The background worker will generate and send the message shortly.' 
        });
        setTimeout(() => setTestSendStatus({ status: 'idle', message: '' }), 5000);
      } else {
        throw new Error(data.error || 'Failed to trigger test send.');
      }
    } catch (e: any) {
      setTestSendStatus({ status: 'error', message: e.message || 'Error triggering test send.' });
    }
  };

  // Helper: Get variant name for days (e.g. Tomato -> "Just Tomato")
  const getDayVariantName = (ingredients: Ingredient[]) => {
    const nonStapleNames = ingredients
      .filter(ing => !ing.isAuto)
      .map(ing => ing.name);
    if (nonStapleNames.length === 0) return 'Staples Only';
    if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
    return nonStapleNames.join(' + ');
  };

  // Compile active prompt from configuration
  const compilePromptText = (c: Config): string => {
    const isSingle = c.generationRange === 'single';
    const activeDays = isSingle ? [c.selectedGenerationDay] : DAYS_OF_WEEK;
    const daysLabel = isSingle ? `only the day ${c.selectedGenerationDay}` : 'Monday through Sunday';
    const dayRefLabel = isSingle ? 'the day' : 'each day';

    const mealsList = c.meals || [];
    let splitsList = c.customSplits || [];
    if (splitsList.length === 0) {
      if (c.splits) {
        splitsList = [
          { id: 'salt', name: 'Salt Seasoning Split', value: c.splits.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
          { id: 'prep', name: 'Chicken Prep Method', value: c.splits.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
        ];
      } else {
        splitsList = [
          { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
          { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
        ];
      }
    }
    
    // Dynamic Olive Oil calculation
    const totalOil = c.global.totalOliveOil || 0;
    const oilPercent = c.global.oliveOilSplitPercent || 50;
    const subjiOil = Math.round(totalOil * oilPercent / 100);
    const chickenOil = totalOil - subjiOil;

    const getSplitsForDayText = (day: string, prefix = '') => {
      const dayOverrides = c.dailySplits?.[day] || [];
      const daySplits = splitsList.map(globalSplit => {
        const override = dayOverrides.find(o => o.id === globalSplit.id);
        return {
          name: globalSplit.name,
          value: override ? override.value : globalSplit.value
        };
      });
      return [
        `Olive Oil Cooking Split: ${subjiOil}g in subji. ${chickenOil}g in chicken`,
        ...daySplits.map(s => `${s.name}: ${s.value}`)
      ].map(s => `${prefix}- ${s}`).join('\n');
    };

    let splitsText = '';
    if (isSingle) {
      splitsText = getSplitsForDayText(c.selectedGenerationDay);
    } else {
      splitsText = activeDays.map(day => {
        return `- ${day}:\n${getSplitsForDayText(day, '  ')}`;
      }).join('\n');
    }

    const mealsTargetText = mealsList
      .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day`)
      .join('\n');

    const mealsDetailsText = mealsList
      .map((meal, idx) => `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (FOR 1 MEAL)]
${meal.ingredients.map(ing => `- ${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join('\n')}
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod}` : ''}
`).join('\n');

    return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
- Total Daily Olive Oil: ${c.global.totalOliveOil}g (MUST include this globally in daily calorie sum calculations)
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${activeDays.map(day => {
  const ingredients = c.dailyVariables[day] || [];
  const variant = getDayVariantName(ingredients);
  const itemsText = ingredients.map(ing => `${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join(', ');
  return `- ${day} (${variant}): ${itemsText}`;
}).join('\n')}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For ${isSingle ? `the selected day (${c.selectedGenerationDay})` : 'each day'}, sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum over all meals of: (sum of calories of all ingredients in that meal) x (meals per day for that meal)
   - Daily variables calories = sum of calories of all variables for that day
   - Global Olive Oil calories = Total Daily Olive Oil x (calorie density of Olive Oil)
3. Subtract that total (meals + variables + olive oil) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. If a day contains multiple \`[AUTO]\` ingredients, split the remaining deficit equally (50-50 in terms of calories) between them, then solve for each weight.
6. For each meal, divide its daily baseline weights and any daily variable weights by the meal's daily frequency to find the per-meal weight.
7. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.
8. Calculate the total daily Sodium (Na) and Potassium (K) in milligrams (mg), and their ratio (Na:K ratio) for each day:
   - Table salt (NaCl) contains approximately 388 mg of sodium per 1 g of salt.
   - Look at the "Salt Seasoning Split" split value config under cooking splits. Identify the portion that is boiled with water where chicken is boiled and then the water is thrown away (e.g., "7g in chicken with 1 liter water"). For this portion, assume that only 10% of the salt/sodium is absorbed and retained by the chicken (meaning only 0.7g of salt is consumed, while the other 90% is discarded with the water). All other salt split allocations (e.g. in subji, in marinate paste) are assumed to be 100% consumed.
   - Estimate natural sodium per 100g of raw ingredients: Raw Chicken Breast ≈ 70mg, White Rice ≈ 5mg, Potato (Raw) ≈ 6mg, Tomato ≈ 5mg, Bottle Gourd ≈ 2mg, Cluster Beans ≈ 2mg, Brinjal ≈ 2mg, Olive Oil ≈ 2mg, Eggs ≈ 140mg, Oats ≈ 2mg, Whey Protein ≈ 160mg, Nuts ≈ 1mg, Banana ≈ 1mg.
   - Estimate natural potassium per 100g of raw ingredients: Raw Chicken Breast ≈ 256mg, White Rice ≈ 115mg, Potato (Raw) ≈ 400mg, Tomato ≈ 237mg, Bottle Gourd ≈ 150mg, Cluster Beans ≈ 230mg, Brinjal ≈ 230mg, Olive Oil ≈ 1mg, Eggs ≈ 130mg, Oats ≈ 429mg, Whey Protein ≈ 350mg, Almonds/Cashews/Walnuts ≈ 600mg, Banana ≈ 358mg.
   - Compute Total Daily Sodium (mg) = Sodium from consumed salt + Natural sodium from all daily ingredients.
   - Compute Total Daily Potassium (mg) = Natural potassium from all daily ingredients.
   - Compute the Sodium-to-Potassium Ratio (Na:K Ratio) = Total Daily Sodium (mg) / Total Daily Potassium (mg) (rounded to 2 decimal places).
   - Evaluate the Na:K Ratio against the ideal range of 0.70 to 0.80:
     - If the ratio is below 0.70, calculate the additional Sodium required to reach a ratio of 0.70: Additional Na (mg) = (0.70 * Total Daily Potassium) - Total Daily Sodium. Also convert this to equivalent additional salt grams: Additional Salt (g) = Additional Na (mg) / 388 (rounded to 2 decimal places).
     - If the ratio is above 0.80, calculate the additional Potassium required to reach a ratio of 0.80: Additional Potassium (mg) = (Total Daily Sodium / 0.80) - Total Daily Potassium (rounded to the nearest whole number).
     - If the ratio is between 0.70 and 0.80 (inclusive), the ratio is ideal.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

At the very top of Part 1 (above any meal breakdowns/tables), you MUST print a bolded summary block for the daily sodium and potassium levels for each day generated. Format it exactly as follows:
### Daily Sodium & Potassium Summary
For ${isSingle ? `the day (${c.selectedGenerationDay})` : 'each day from Monday to Sunday'}:
- **[Day Name] (e.g. MONDAY)**: Total Sodium: **[X] mg** | Total Potassium: **[Y] mg** | Na:K Ratio: **[Z]** ([Ideal / Below Ideal / Above Ideal])
  * (Include a brief breakdown note showing how you calculated this: e.g., "Includes [X_salt]mg sodium from consumed salt and [X_natural]mg natural sodium. Consumed salt includes 100% of [non-water-boiled splits] and only 10% of [water-boiled splits] (water discarded). Total potassium is from natural ingredients.")
  * **Ratio Adjustment Info**: [If ideal: "Ratio is in the ideal range (0.70 - 0.80)." If below 0.70: "Ratio is below ideal. Need an additional [A] mg of Sodium (approx. [B] g of table salt) to reach 0.70." If above 0.80: "Ratio is above ideal. Need an additional [C] mg of Potassium to reach 0.80."]

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal). Sum the total calculated calories at the bottom of the table.
`).join('\n')}

For daily variables and splits:
List out ${daysLabel} using bullet points. Under ${dayRefLabel}, list ALL fixed items and variable items together, displaying the per-meal weight, daily weight, and calculated calorie breakdown. If an item was calculated via \`[AUTO]\`, replace the \`[AUTO]\` tag with the calculated real weights. Show a calculated "Meal Total" for each day.

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals (and include the global Olive Oil calories) to prove it hits your configured target.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output ${isSingle ? `only the day ${c.selectedGenerationDay}` : 'every day from Monday to Sunday'} using the exact line-by-line template below. Map your calculated total daily weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

Exact Output Template to Follow for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal, list its ingredients with daily total weights in grams. Then list liquid configuration and prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name:
ingredient1 name 150g
ingredient2 name 100g
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
  };

  const autoGeneratedPrompt = compilePromptText(config);
  const activePrompt = isCustomMode ? customPrompt : autoGeneratedPrompt;

  // Initialize custom prompt if entering custom mode
  useEffect(() => {
    if (isCustomMode && !customPrompt) {
      setCustomPrompt(autoGeneratedPrompt);
    }
  }, [isCustomMode, autoGeneratedPrompt, customPrompt]);

  // Handlers for dynamic state modifications
  const updateGlobal = (field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      global: { ...prev.global, [field]: value }
    }));
  };

  // Dynamic Meals manipulators
  const addNewMeal = () => {
    const newMeal: Meal = {
      id: `meal-${Date.now()}`,
      name: 'New Meal',
      mealsPerDay: 1,
      ingredients: [
        { name: 'Ingredient 1', weight: '0', isAuto: false }
      ],
      water: '',
      prepMethod: ''
    };
    setConfig(prev => ({
      ...prev,
      meals: [...(prev.meals || []), newMeal]
    }));
    setActiveTab(newMeal.id);
  };

  const deleteMeal = (id: string) => {
    setConfig(prev => {
      const remainingMeals = (prev.meals || []).filter(m => m.id !== id);
      return { ...prev, meals: remainingMeals };
    });
    setActiveTab('global');
  };

  const updateMeal = (id: string, field: keyof Meal, value: any) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === id) {
          return { ...m, [field]: value };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const addMealIngredient = (mealId: string) => {
    const defaultIng: Ingredient = { name: 'New Item', weight: '0', isAuto: false };
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          return { ...m, ingredients: [...m.ingredients, defaultIng] };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const updateMealIngredient = (
    mealId: string,
    idx: number,
    field: keyof Ingredient,
    value: any
  ) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          const updatedIngs = [...m.ingredients];
          const item = { ...updatedIngs[idx] };
          
          if (field === 'isAuto') {
            item.isAuto = value;
            if (value) item.weight = '';
          } else if (field === 'weight') {
            item.weight = value;
            if (value) item.isAuto = false;
          } else {
            item[field] = value as string;
          }
          
          updatedIngs[idx] = item;
          return { ...m, ingredients: updatedIngs };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const removeMealIngredient = (mealId: string, idx: number) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          return {
            ...m,
            ingredients: m.ingredients.filter((_, i) => i !== idx)
          };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  // Ingredients Lists manipulators (for Daily variables)
  const addIngredient = (target: 'daily', dayKey: string) => {
    const defaultIng: Ingredient = { name: 'New Item', weight: '0', isAuto: false };
    setConfig(prev => ({
      ...prev,
      dailyVariables: {
        ...prev.dailyVariables,
        [dayKey]: [...(prev.dailyVariables[dayKey] || []), defaultIng]
      }
    }));
  };

  const updateIngredient = (
    target: 'daily',
    index: number,
    field: keyof Ingredient,
    value: any,
    dayKey: string
  ) => {
    setConfig(prev => {
      const updated = [...(prev.dailyVariables[dayKey] || [])];
      const item = { ...updated[index] };
      if (field === 'isAuto') {
        item.isAuto = value;
        if (value) item.weight = '';
      } else if (field === 'weight') {
        item.weight = value;
        if (value) item.isAuto = false;
      } else {
        item[field] = value as string;
      }
      updated[index] = item;
      return {
        ...prev,
        dailyVariables: { ...prev.dailyVariables, [dayKey]: updated }
      };
    });
  };

  const removeIngredient = (target: 'daily', index: number, dayKey: string) => {
    setConfig(prev => ({
      ...prev,
      dailyVariables: {
        ...prev.dailyVariables,
        [dayKey]: (prev.dailyVariables[dayKey] || []).filter((_, idx) => idx !== index)
      }
    }));
  };

  const swapDayVariables = (dayA: string, dayB: string) => {
    setConfig(prev => {
      const varsA = prev.dailyVariables[dayA] || [];
      const varsB = prev.dailyVariables[dayB] || [];
      
      const dailySplits = { ...(prev.dailySplits || {}) };
      const splitsA = dailySplits[dayA] || [];
      const splitsB = dailySplits[dayB] || [];
      
      dailySplits[dayA] = splitsB;
      dailySplits[dayB] = splitsA;
      
      setHasUnsavedChanges(true);
      return {
        ...prev,
        dailyVariables: {
          ...prev.dailyVariables,
          [dayA]: varsB,
          [dayB]: varsA
        },
        dailySplits
      };
    });
  };

  // Custom Splits manipulators
  const updateCustomSplit = (id: string, field: 'name' | 'value', val: string) => {
    setConfig(prev => {
      const splitsList = prev.customSplits || [];
      const updated = splitsList.map(s => s.id === id ? { ...s, [field]: val } : s);
      
      const dailySplits = { ...(prev.dailySplits || {}) };
      if (field === 'name') {
        for (const day in dailySplits) {
          dailySplits[day] = dailySplits[day].map(s => s.id === id ? { ...s, name: val } : s);
        }
      }
      setHasUnsavedChanges(true);
      return { ...prev, customSplits: updated, dailySplits };
    });
  };

  const addCustomSplit = () => {
    const newSplit = {
      id: Date.now().toString(),
      name: 'New Split/Instruction',
      value: 'Enter instructions here'
    };
    setConfig(prev => ({
      ...prev,
      customSplits: [...(prev.customSplits || []), newSplit]
    }));
  };

  const removeCustomSplit = (id: string) => {
    setConfig(prev => {
      const dailySplits = { ...(prev.dailySplits || {}) };
      for (const day in dailySplits) {
        dailySplits[day] = dailySplits[day].filter(s => s.id !== id);
      }
      setHasUnsavedChanges(true);
      return {
        ...prev,
        customSplits: (prev.customSplits || []).filter(s => s.id !== id),
        dailySplits
      };
    });
  };

  const updateDailySplit = (dayKey: string, splitId: string, value: string) => {
    setConfig(prev => {
      const dailySplits = { ...(prev.dailySplits || {}) };
      const daySplits = [...(dailySplits[dayKey] || [])];
      
      const existingIdx = daySplits.findIndex(s => s.id === splitId);
      const globalSplit = (prev.customSplits || []).find(s => s.id === splitId);
      const name = globalSplit ? globalSplit.name : '';
      
      if (existingIdx >= 0) {
        daySplits[existingIdx] = { ...daySplits[existingIdx], value };
      } else {
        daySplits.push({ id: splitId, name, value });
      }
      
      dailySplits[dayKey] = daySplits;
      setHasUnsavedChanges(true);
      return { ...prev, dailySplits };
    });
  };

  const resetDailySplit = (dayKey: string, splitId: string) => {
    setConfig(prev => {
      const dailySplits = { ...(prev.dailySplits || {}) };
      if (dailySplits[dayKey]) {
        dailySplits[dayKey] = dailySplits[dayKey].filter(s => s.id !== splitId);
        if (dailySplits[dayKey].length === 0) {
          delete dailySplits[dayKey];
        }
      }
      setHasUnsavedChanges(true);
      return { ...prev, dailySplits };
    });
  };



  // Run AI Generation
  const handleGenerate = async () => {
    if (config.provider === 'gemini-enterprise') {
      if (config.enterpriseAuthMethod === 'api-key' && !config.enterpriseApiKey) {
        setErrorMsg('API Key is missing. Please enter your Agent Platform API Key in Settings.');
        setCurrentView('connections');
        return;
      }
      if (config.enterpriseAuthMethod === 'service-account' && !config.enterpriseServiceAccountJson) {
        setErrorMsg('Service Account JSON is missing. Please enter your Service Account JSON in Settings.');
        setCurrentView('connections');
        return;
      }
      if (!config.enterpriseProjectId) {
        setErrorMsg('GCP Project ID is missing. Please enter your GCP Project ID in Settings.');
        setCurrentView('connections');
        return;
      }
    } else {
      if (!config.apiKey) {
        setErrorMsg('API Key is missing. Please enter your Gemini API Key in Settings.');
        setCurrentView('connections');
        return;
      }
    }

    setIsGenerating(true);
    setErrorMsg('');
    setOutputText('');
    setThinkingText('');

    try {
      const selectedModel = config.model === 'custom' ? config.customModel : config.model;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey
        },
        body: JSON.stringify({
          prompt: activePrompt,
          model: selectedModel,
          thinkingEnabled: config.thinkingEnabled,
          thinkingBudget: config.thinkingBudget,
          provider: config.provider || 'google-ai-studio',
          enterpriseAuthMethod: config.enterpriseAuthMethod || 'api-key',
          enterpriseApiKey: config.enterpriseApiKey,
          enterpriseProjectId: config.enterpriseProjectId,
          enterpriseLocation: config.enterpriseLocation || 'global',
          enterpriseServiceAccountJson: config.enterpriseServiceAccountJson
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Server responded with an error.');
      }

      setOutputText(data.text);
      if (data.thought) {
        setThinkingText(data.thought);
        setOutputTab('thoughts');
      } else {
        setOutputTab('user');
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'An error occurred while connecting to the Gemini API.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy to Clipboard
  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStatus(true);
      setTimeout(() => setCopiedStatus(false), 2000);
    });
  };

  // Simple custom Markdown rendering to HTML
  const getPart1AndPart2 = (md: string) => {
    if (!md) return { part1: '', part2: '' };
    
    // Find where PART 2 starts
    const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
    const match = md.match(splitRegex);
    
    if (match && match.index !== undefined) {
      const part1 = md.substring(0, match.index).trim();
      let part2 = md.substring(match.index + match[0].length).trim();
      
      // Clean up leading horizontal rule if present
      if (part2.startsWith('---')) {
        part2 = part2.substring(3).trim();
      }
      
      // Clean up trailing horizontal rule from part1
      let cleanedPart1 = part1;
      if (cleanedPart1.endsWith('---')) {
        cleanedPart1 = cleanedPart1.substring(0, cleanedPart1.length - 3).trim();
      }
      
      return { part1: cleanedPart1, part2 };
    }
    
    // Fallback: split by last horizontal rule
    const sections = md.split('---');
    if (sections.length > 1) {
      const part2 = sections[sections.length - 1].trim();
      const part1 = sections.slice(0, sections.length - 1).join('---').trim();
      return { part1, part2 };
    }
    
    return { part1: md, part2: '' };
  };

  const renderMarkdown = (md: string) => {
    if (!md) return '';
    
    const { part1 } = getPart1AndPart2(md);
    const lines = part1.split('\n');
    const html: string[] = [];
    let inList = false;
    let inTable = false;
    let tableRows: string[] = [];

    const parseInline = (text: string) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: monospace;">$1</code>');
    };

    const renderTable = (rows: string[]) => {
      if (rows.length === 0) return '';
      const tHtml = ['<table>'];
      let hasHeader = false;
      
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.includes('---') && r === 1) continue;
        
        const cells = row
          .split('|')
          .map(c => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        
        if (r === 0) {
          tHtml.push('<thead><tr>');
          cells.forEach(cell => tHtml.push(`<th>${parseInline(cell)}</th>`));
          tHtml.push('</tr></thead><tbody>');
          hasHeader = true;
        } else {
          tHtml.push('<tr>');
          cells.forEach(cell => tHtml.push(`<td>${parseInline(cell)}</td>`));
          tHtml.push('</tr>');
        }
      }
      if (hasHeader) tHtml.push('</tbody>');
      tHtml.push('</table>');
      return tHtml.join('\n');
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        continue;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        if (!inList) { html.push('<ul>'); inList = true; }
        html.push(`<li>${parseInline(line.substring(2))}</li>`);
        continue;
      }

      if (/^\d+\.\s/.test(line)) {
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        if (inList) { html.push('</ul>'); inList = false; }
        const headingContent = line.replace(/^\d+\.\s/, '');
        const num = line.match(/^(\d+)\.\s/)?.[1] || '1';
        html.push(`<h4 style="margin-top: 1.25rem; font-size: 1.05rem; font-weight: 700; color: #c084fc;">${num}. ${parseInline(headingContent)}</h4>`);
        continue;
      }

      if (line.startsWith('### ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h3>${parseInline(line.substring(4))}</h3>`);
        continue;
      }

      if (line.startsWith('## ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h2>${parseInline(line.substring(3))}</h2>`);
        continue;
      }

      if (line.startsWith('# ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h1>${parseInline(line.substring(2))}</h1>`);
        continue;
      }

      if (line.startsWith('|')) {
        if (inList) { html.push('</ul>'); inList = false; }
        inTable = true;
        tableRows.push(line);
        continue;
      }

      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      html.push(`<p style="margin-bottom: 0.5rem;">${parseInline(line)}</p>`);
    }

    if (inList) html.push('</ul>');
    if (inTable) html.push(renderTable(tableRows));

    return html.join('\n');
  };

  const getCookPlanOnly = (md: string) => {
    return getPart1AndPart2(md).part2;
  };

  if (isAuthenticatedState === null || !isMounted) {
    return (
      <div className="loading-container" style={{ minHeight: '100vh' }}>
        <div className="spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>Checking credentials & loading configuration...</p>
      </div>
    );
  }

  if (isAuthenticatedState === false) {
    return (
      <div className="login-overlay">
        <form onSubmit={handleLogin} className="login-card">
          <div className="login-logo">🔒</div>
          <h2 style={{ marginBottom: '0.5rem', fontWeight: 800 }}>AI Diet Maker</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Enter the password to access your diet dashboard
          </p>
          
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              style={{ padding: '0.75rem 1rem' }}
              placeholder="••••••••"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              required
            />
          </div>
          
          {loginError && (
            <div style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {loginError}
            </div>
          )}
          
          <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem' }}>
            Unlock Dashboard
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header" style={{ paddingBottom: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div className="header-title-container">
            <h1 className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🥗</span> AI Diet Maker
            </h1>
            <p className="header-subtitle">Strict meal prep calculator, solved via Gemini Thinking Models</p>
          </div>

          <nav className="header-nav" style={{ marginLeft: '1.5rem' }}>
            <button 
              className={`header-nav-btn ${currentView === 'planner' ? 'active' : ''}`}
              onClick={() => {
                setCurrentView('planner');
                if (activeTab === 'whatsapp') {
                  setActiveTab('global');
                }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
              Diet Planner
            </button>
            <button 
              className={`header-nav-btn ${currentView === 'connections' ? 'active' : ''}`}
              onClick={() => setCurrentView('connections')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Settings & Connections
            </button>
          </nav>
        </div>

        <div className="header-status-container">
          <div 
            className="clickable-status-pill"
            onClick={() => setCurrentView('connections')}
            title="Configure WhatsApp connection"
          >
            <span className={`whatsapp-status-badge ${whatsappState.status}`}>
              {whatsappState.status === 'ready' && '🟢 WhatsApp Ready'}
              {whatsappState.status === 'connecting' && '🔵 WhatsApp Connecting'}
              {whatsappState.status === 'qr_code' && '🟡 WhatsApp Scan QR'}
              {whatsappState.status === 'disconnected' && '🔴 WhatsApp Offline'}
            </span>
          </div>

          <div 
            className="clickable-status-pill" 
            onClick={() => setCurrentView('connections')}
            title="Configure Gemini API credentials"
          >
            {((config.provider === 'gemini-enterprise' && (
                (config.enterpriseAuthMethod === 'api-key' && config.enterpriseApiKey) ||
                (config.enterpriseAuthMethod === 'service-account' && config.enterpriseServiceAccountJson) ||
                (config.enterpriseAuthMethod === 'adc')
              ) && config.enterpriseProjectId) ||
              (config.provider !== 'gemini-enterprise' && config.apiKey)) ? (
              <span className="api-key-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '0.15rem' }}>
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                API Active
              </span>
            ) : (
              <span className="api-key-badge missing">
                ⚠️ API Credentials Needed
              </span>
            )}
          </div>

          <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {currentView === 'planner' ? (
        <main className="dashboard-grid">
          {/* Left Column: Configuration Panels */}
          <section className="glass-panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Diet Builder
              </h2>
            </div>

            {hasUnsavedChanges && (
              <div className="save-config-bar">
                <span style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  ⚠️ You have unsaved changes
                </span>
                <button 
                  className="btn-secondary" 
                  style={{ background: '#f59e0b', color: '#000', border: 'none', padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 700 }}
                  disabled={isSavingConfig}
                  onClick={() => saveConfig()}
                >
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            )}

            <div className="section-tabs" style={{ overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '0.5rem', scrollbarWidth: 'none' }}>
              <button className={`section-tab-btn ${activeTab === 'global' ? 'active' : ''}`} onClick={() => setActiveTab('global')}>
                🎯 Targets & Splits
              </button>
              {(config.meals || []).map(meal => (
                <button
                  key={meal.id}
                  className={`section-tab-btn ${activeTab === meal.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(meal.id)}
                >
                  🍲 {meal.name}
                </button>
              ))}
              <button 
                className="section-tab-btn" 
                onClick={addNewMeal}
                style={{ border: '1px dashed var(--accent-purple)', color: 'var(--accent-purple)', flex: 'none', minWidth: '110px' }}
              >
                ➕ Add Meal
              </button>
              <button className={`section-tab-btn ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => setActiveTab('daily')}>
                📅 Daily Variables
              </button>
              <button className={`section-tab-btn ${activeTab === 'prompt' ? 'active' : ''}`} onClick={() => setActiveTab('prompt')}>
                📝 System Prompt
              </button>
            </div>

            {/* Targets & Splits Subpanel */}
            {activeTab === 'global' && (
              <div>
                <h3 style={{ fontSize: '0.95rem', color: '#fff', marginBottom: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🎯 Daily Calorie & Olive Oil Targets
                </h3>
                <div className="input-row">
                  <div className="form-group">
                    <label className="form-label">Calorie Target (kcal)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={config.global.dailyCalorieTarget}
                      onChange={e => updateGlobal('dailyCalorieTarget', parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Total Olive Oil (g)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={config.global.totalOliveOil || 18}
                      onChange={e => updateGlobal('totalOliveOil', parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Olive Oil for Subji (%)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={config.global.oliveOilSplitPercent || 50}
                        onChange={e => updateGlobal('oliveOilSplitPercent', parseInt(e.target.value) || 50)}
                        style={{ flex: 1, accentColor: 'var(--accent-purple)' }}
                      />
                      <span style={{ fontSize: '0.85rem', width: '40px' }}>{config.global.oliveOilSplitPercent || 50}%</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                      Remaining {(100 - (config.global.oliveOilSplitPercent || 50))}% goes to chicken
                    </p>
                  </div>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

                <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
                  Cook Seasoning & Instructions Splits
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                  {(config.customSplits || []).map((split) => (
                    <div key={split.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <input
                        type="text"
                        className="form-input"
                        style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        value={split.name}
                        onChange={e => updateCustomSplit(split.id, 'name', e.target.value)}
                        placeholder="Title (e.g. Olive Oil split)"
                      />
                      <input
                        type="text"
                        className="form-input"
                        style={{ flex: 2, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        value={split.value}
                        onChange={e => updateCustomSplit(split.id, 'value', e.target.value)}
                        placeholder="Instruction split"
                      />
                      <button className="btn-remove" onClick={() => removeCustomSplit(split.id)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                <button className="btn-add" style={{ marginTop: '0.25rem' }} onClick={addCustomSplit}>
                  + Add Custom Cook Split / Instruction
                </button>
              </div>
            )}

            {/* Dynamic Meal Config Subpanel */}
            {(() => {
              const selectedMeal = (config.meals || []).find(m => m.id === activeTab);
              if (!selectedMeal) return null;
              return (
                <div>
                  <div className="input-row" style={{ marginBottom: '1.25rem' }}>
                    <div className="form-group">
                      <label className="form-label">Meal Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={selectedMeal.name}
                        onChange={e => updateMeal(selectedMeal.id, 'name', e.target.value)}
                        placeholder="e.g. Oats Meal, Pasta Meal"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Meals Per Day (Frequency)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={selectedMeal.mealsPerDay}
                        onChange={e => updateMeal(selectedMeal.id, 'mealsPerDay', parseInt(e.target.value) || 1)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>Meal Ingredients</label>
                    {config.meals.length > 1 && (
                      <button 
                        className="btn-remove" 
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.08)' }}
                        onClick={() => deleteMeal(selectedMeal.id)}
                      >
                        Delete Meal
                      </button>
                    )}
                  </div>

                  <div className="ingredients-list">
                    {selectedMeal.ingredients.map((ing, idx) => (
                      <div key={idx} className="ingredient-item">
                        <input
                          type="text"
                          className="form-input"
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                          value={ing.name}
                          onChange={e => updateMealIngredient(selectedMeal.id, idx, 'name', e.target.value)}
                        />
                        <input
                          type="number"
                          className="form-input"
                          style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                          placeholder="g"
                          disabled={ing.isAuto}
                          value={ing.weight}
                          onChange={e => updateMealIngredient(selectedMeal.id, idx, 'weight', e.target.value)}
                        />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>grams</span>
                        <label className="auto-checkbox-container">
                          <input
                            type="checkbox"
                            checked={ing.isAuto}
                            onChange={e => updateMealIngredient(selectedMeal.id, idx, 'isAuto', e.target.checked)}
                          />
                          AUTO
                        </label>
                        <button className="btn-remove" onClick={() => removeMealIngredient(selectedMeal.id, idx)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  <button className="btn-add" onClick={() => addMealIngredient(selectedMeal.id)}>
                    + Add Ingredient to {selectedMeal.name}
                  </button>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

                  <div className="form-group">
                    <label className="form-label">Liquid Configuration (e.g. water, milk, or &quot;none&quot;)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedMeal.water}
                      onChange={e => updateMeal(selectedMeal.id, 'water', e.target.value)}
                      placeholder="e.g. 190g water"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Preparation Method & Cooking Instructions</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedMeal.prepMethod}
                      onChange={e => updateMeal(selectedMeal.id, 'prepMethod', e.target.value)}
                      placeholder="e.g. Cook in airfryer 200c for 10 min"
                    />
                  </div>
                </div>
              );
            })()}

            {/* Daily Variables Config Subpanel */}
            {activeTab === 'daily' && (
              <div>
                <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
                  Select Day of Week <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'none', marginLeft: '0.5rem' }}>(Drag & Drop to Swap)</span>
                </label>
                
                <div className="day-selector-grid">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day}
                      draggable
                      className={`day-btn ${activeDay === day ? 'active' : ''} ${dragOverDay === day ? 'drag-over' : ''}`}
                      onClick={() => setActiveDay(day)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', day);
                        setDraggedDay(day);
                      }}
                      onDragEnd={() => {
                        setDraggedDay(null);
                        setDragOverDay(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (draggedDay && draggedDay !== day) {
                          setDragOverDay(day);
                        }
                      }}
                      onDragLeave={() => {
                        setDragOverDay(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceDay = e.dataTransfer.getData('text/plain') || draggedDay;
                        if (sourceDay && sourceDay !== day) {
                          swapDayVariables(sourceDay, day);
                        }
                        setDraggedDay(null);
                        setDragOverDay(null);
                      }}
                    >
                      {day.substring(0, 3)}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>
                    Ingredients for {activeDay} ({getDayVariantName(config.dailyVariables[activeDay] || [])})
                  </h4>
                </div>

                <div className="ingredients-list">
                  {(config.dailyVariables[activeDay] || []).map((ing, idx) => (
                    <div key={idx} className="ingredient-item">
                      <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        value={ing.name}
                        onChange={e => updateIngredient('daily', idx, 'name', e.target.value, activeDay)}
                      />
                      <input
                        type="number"
                        className="form-input"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        placeholder="g"
                        disabled={ing.isAuto}
                        value={ing.weight}
                        onChange={e => updateIngredient('daily', idx, 'weight', e.target.value, activeDay)}
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>grams</span>
                      <label className="auto-checkbox-container">
                        <input
                          type="checkbox"
                          checked={ing.isAuto}
                          onChange={e => updateIngredient('daily', idx, 'isAuto', e.target.checked, activeDay)}
                        />
                        AUTO
                      </label>
                      <button className="btn-remove" onClick={() => removeIngredient('daily', idx, activeDay)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                <button className="btn-add" onClick={() => addIngredient('daily', activeDay)}>
                  + Add Ingredient to {activeDay}
                </button>

                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

                <h4 style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                  Cook Seasoning & Instructions Splits for {activeDay}
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(config.customSplits || []).map((globalSplit) => {
                    const daySplits = config.dailySplits?.[activeDay] || [];
                    const override = daySplits.find(s => s.id === globalSplit.id);
                    const currentValue = override ? override.value : globalSplit.value;
                    const isCustomized = !!override;
                    
                    return (
                      <div key={globalSplit.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>{globalSplit.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '4px',
                              fontWeight: 600,
                              background: isCustomized ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                              color: isCustomized ? '#c084fc' : 'var(--text-muted)'
                            }}>
                              {isCustomized ? 'Customized' : 'Global Default'}
                            </span>
                            {isCustomized && (
                              <button
                                onClick={() => resetDailySplit(activeDay, globalSplit.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#c084fc',
                                  fontSize: '0.7rem',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  padding: 0
                                }}
                              >
                                Reset to default
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="text"
                          className="form-input"
                          style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                          value={currentValue}
                          onChange={e => updateDailySplit(activeDay, globalSplit.id, e.target.value)}
                          placeholder={`Default: ${globalSplit.value}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Prompt Preview Subpanel */}
            {activeTab === 'prompt' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Active LLM Prompt Text</label>
                  <div 
                    className={`switch-container ${isCustomMode ? 'checked' : ''}`}
                    onClick={() => setIsCustomMode(!isCustomMode)}
                  >
                    <div className="switch-control" style={{ transform: 'scale(0.8)' }}></div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Edit Prompt Directly</span>
                  </div>
                </div>

                <textarea
                  className={`prompt-preview-body ${isCustomMode ? 'editable' : ''}`}
                  style={{ height: '350px' }}
                  value={activePrompt}
                  disabled={!isCustomMode}
                  onChange={e => setCustomPrompt(e.target.value)}
                />
                {!isCustomMode && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                    {'Auto-compiling from form fields above. Enable "Edit Prompt Directly" to tweak instructions manually.'}
                  </p>
                )}
              </div>
            )}

            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '10px', marginTop: '1.5rem' }}>
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontSize: '0.8rem' }}>Generation Scope</label>
              <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="generationRange"
                    checked={config.generationRange === 'all'}
                    onChange={() => setConfig(prev => ({ ...prev, generationRange: 'all' }))}
                  />
                  All Days (Full Week)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="generationRange"
                    checked={config.generationRange === 'single'}
                    onChange={() => setConfig(prev => ({ ...prev, generationRange: 'single' }))}
                  />
                  Single Day Only
                </label>
              </div>

              {config.generationRange === 'single' && (
                <div className="form-group" style={{ margin: 0, marginTop: '0.75rem' }}>
                  <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Choose Day</label>
                  <select
                    className="form-input"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                    value={config.selectedGenerationDay}
                    onChange={e => setConfig(prev => ({ ...prev, selectedGenerationDay: e.target.value }))}
                  >
                    {DAYS_OF_WEEK.map(day => {
                      const ingredients = config.dailyVariables[day] || [];
                      const variant = getDayVariantName(ingredients);
                      return (
                        <option key={day} value={day}>
                          {day} ({variant})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem' }}>
              <button
                className="btn-primary"
                disabled={isGenerating}
                onClick={handleGenerate}
              >
                {isGenerating ? (
                  <>
                    <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                    Calculating & Generating...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                    </svg>
                    Generate Diet Plan
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Right Column: AI Outputs */}
          <section className="glass-panel" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
            <div className="output-header-tabs">
              {thinkingText && (
                <button 
                  className={`output-tab ${outputTab === 'thoughts' ? 'active' : ''}`} 
                  onClick={() => setOutputTab('thoughts')}
                >
                  Thinking Process
                </button>
              )}
              <button 
                className={`output-tab ${outputTab === 'user' ? 'active' : ''}`} 
                onClick={() => setOutputTab('user')}
              >
                Part 1: For Myself
              </button>
              <button 
                className={`output-tab ${outputTab === 'cook' ? 'active' : ''}`} 
                onClick={() => setOutputTab('cook')}
              >
                Part 2: For Cook
              </button>
            </div>

            {errorMsg && (
              <div style={{ background: 'rgba(244, 63, 94, 0.1)', borderLeft: '4px solid var(--accent-rose)', color: '#fda4af', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Generation Error</div>
                {errorMsg}
              </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {isGenerating ? (
                <div className="loading-container" style={{ flex: 1 }}>
                  <div className="spinner"></div>
                  <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Gemini is solving calculations...</p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
                </div>
              ) : outputText ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  {outputTab === 'thoughts' && thinkingText && (
                    <div className="thinking-box" style={{ flex: 1 }}>
                      <div className="thinking-title">Gemini Thinking Output</div>
                      <div className="thinking-text" style={{ maxHeight: 'none', height: '430px' }}>
                        {thinkingText}
                      </div>
                    </div>
                  )}

                  {outputTab === 'user' && (
                    <div 
                      className="markdown-content" 
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(outputText) }} 
                    />
                  )}

                  {outputTab === 'cook' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Each day can be copied individually below</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '500px', paddingRight: '0.25rem' }}>
                        {parseCookPlanDays(getCookPlanOnly(outputText)).map((dayObj, idx) => (
                          <div key={idx} className="glass-panel" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderColor: 'rgba(255,255,255,0.04)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <h4 style={{ margin: 0, color: '#c084fc', fontSize: '0.9rem', fontWeight: 700 }}>
                                {dayObj.heading.replace('###', '').trim()}
                              </h4>
                              <DayCopyButton 
                                text={(() => {
                                  const colonIndex = dayObj.heading.indexOf(':');
                                  const variant = colonIndex !== -1 ? dayObj.heading.substring(colonIndex + 1).trim() : '';
                                  return variant ? `${variant}\n${dayObj.content}` : dayObj.content;
                                })()} 
                              />
                            </div>
                            <pre style={{ 
                              background: 'rgba(0,0,0,0.2)', 
                              padding: '0.75rem', 
                              borderRadius: '6px', 
                              fontSize: '0.8rem', 
                              fontFamily: 'var(--font-mono)', 
                              color: 'var(--text-secondary)',
                              whiteSpace: 'pre-wrap',
                              lineHeight: '1.5',
                              margin: 0
                            }}>
                              {dayObj.content}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="placeholder-container" style={{ flex: 1 }}>
                  <div className="placeholder-icon">📋</div>
                  <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '1rem' }}>No Plan Generated Yet</h3>
                  <p style={{ fontSize: '0.85rem', maxWidth: '300px' }}>
                    {'Configure your targets and variables in the left builder and click "Generate Diet Plan".'}
                  </p>
                </div>
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="settings-dashboard-grid animate-fadeIn">
          {/* Gemini API & Model Setup Panel */}
          <section className="settings-group-card">
            <h3 className="settings-group-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-purple)', marginRight: '0.25rem' }}>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
              </svg>
              Gemini API & LLM Settings
            </h3>
            
            <div className="form-group">
              <label className="form-label">API Provider</label>
              <select
                className="form-input"
                value={config.provider || 'google-ai-studio'}
                onChange={e => setConfig(prev => ({ ...prev, provider: e.target.value }))}
              >
                <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
                <option value="gemini-enterprise">Gemini Enterprise Agent Platform (Vertex AI)</option>
              </select>
            </div>

            {(!config.provider || config.provider === 'google-ai-studio') ? (
              <div className="form-group">
                <label className="form-label">Gemini API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="form-input"
                    placeholder="AIzaSy..."
                    value={config.apiKey}
                    onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  />
                  <button className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                  Your key is saved locally in localStorage and never sent anywhere except directly to Google.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255, 255, 255, 0.01)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.03)', marginBottom: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">GCP Project ID</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="my-gcp-project-id"
                    value={config.enterpriseProjectId || ''}
                    onChange={e => setConfig(prev => ({ ...prev, enterpriseProjectId: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Authentication Method</label>
                  <select
                    className="form-input"
                    value={config.enterpriseAuthMethod || 'api-key'}
                    onChange={e => setConfig(prev => ({ ...prev, enterpriseAuthMethod: e.target.value }))}
                  >
                    <option value="api-key">API Key (Express Mode)</option>
                    <option value="service-account">Service Account JSON</option>
                    <option value="adc">Application Default Credentials (ADC)</option>
                  </select>
                </div>

                {config.enterpriseAuthMethod === 'api-key' && (
                  <div className="form-group">
                    <label className="form-label">Agent Platform API Key</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        className="form-input"
                        placeholder="Agent Platform API Key..."
                        value={config.enterpriseApiKey || ''}
                        onChange={e => setConfig(prev => ({ ...prev, enterpriseApiKey: e.target.value }))}
                      />
                      <button type="button" className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                )}

                {config.enterpriseAuthMethod === 'service-account' && (
                  <div className="form-group">
                    <label className="form-label">Service Account Key (JSON)</label>
                    <textarea
                      className="form-input"
                      style={{ height: '120px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
                      placeholder='{ "type": "service_account", ... }'
                      value={config.enterpriseServiceAccountJson || ''}
                      onChange={e => {
                        const val = e.target.value;
                        let updatedProjId = config.enterpriseProjectId;
                        try {
                          const parsed = JSON.parse(val);
                          if (parsed.project_id && !config.enterpriseProjectId) {
                            updatedProjId = parsed.project_id;
                          }
                        } catch (err) {}
                        setConfig(prev => ({
                          ...prev,
                          enterpriseServiceAccountJson: val,
                          enterpriseProjectId: updatedProjId
                        }));
                      }}
                    />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                      Paste the contents of your Google Cloud Service Account JSON key.
                    </p>
                  </div>
                )}

                {config.enterpriseAuthMethod === 'adc' && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
                    ℹ️ Authenticating via Application Default Credentials (ADC). Make sure your environment has GCP credentials configured.
                  </p>
                )}
              </div>
            )}

            <div className="input-row">
              <div className="form-group">
                <label className="form-label">Gemini Model</label>
                <select
                  className="form-input"
                  value={config.model}
                  onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
                >
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                  <option value="gemini-3.1-pro">Gemini 3.1 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  <option value="custom">Custom Model Name</option>
                </select>
              </div>

              {config.model === 'custom' && (
                <div className="form-group">
                  <label className="form-label">Custom Model Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={config.customModel}
                    onChange={e => setConfig(prev => ({ ...prev, customModel: e.target.value }))}
                    placeholder="gemini-3.5-flash"
                  />
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '0.5rem' }}>
              <div 
                className={`switch-container ${config.thinkingEnabled ? 'checked' : ''}`}
                onClick={() => setConfig(prev => ({ ...prev, thinkingEnabled: !prev.thinkingEnabled }))}
              >
                <div className="switch-control"></div>
                <span className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Thinking Mode</span>
              </div>
            </div>

            {config.thinkingEnabled && (
              <div className="form-group">
                <label className="form-label">Thinking Budget ({config.thinkingBudget} tokens)</label>
                <input
                  type="range"
                  min="1024"
                  max="8192"
                  step="1024"
                  value={config.thinkingBudget}
                  onChange={e => setConfig(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
                />
                <p style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>1024 (Low)</span>
                  <span>4096 (Med)</span>
                  <span>8192 (High)</span>
                </p>
              </div>
            )}

            <button 
              className="btn-primary" 
              style={{ marginTop: '1.5rem', background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.2)' }}
              disabled={isSavingConfig}
              onClick={() => saveConfig()}
            >
              {isSavingConfig ? 'Saving Settings...' : 'Save API Settings'}
            </button>
          </section>

          {/* WhatsApp Bot Connection, Scheduler & Logs Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* WhatsApp Connection Card */}
            <section className="settings-group-card">
              <h3 className="settings-group-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-green)', marginRight: '0.25rem' }}>
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
                <span>WhatsApp Bot Connection</span>
                <span className={`whatsapp-status-badge ${whatsappState.status}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}>
                  {whatsappState.status === 'ready' && 'Ready'}
                  {whatsappState.status === 'connecting' && 'Connecting'}
                  {whatsappState.status === 'qr_code' && 'Scan QR'}
                  {whatsappState.status === 'disconnected' && 'Offline'}
                </span>
              </h3>

              {whatsappState.status === 'qr_code' && (
                <div style={{ textAlign: 'center', margin: '0.5rem 0' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Scan this QR code with WhatsApp on your phone:
                  </p>
                  <div className="whatsapp-qr-container">
                    <img src={whatsappState.qr} alt="WhatsApp QR Code" className="whatsapp-qr-img" />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    QR code refreshes automatically.
                  </span>
                </div>
              )}

              {whatsappState.status === 'ready' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(16, 185, 129, 0.05)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                  <span style={{ fontSize: '1.75rem' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff' }}>{whatsappState.connectedName}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Number: {whatsappState.connectedPhone}</div>
                  </div>
                </div>
              )}

              {whatsappState.status === 'disconnected' && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>
                  The WhatsApp background worker is starting up. If this message remains after 30 seconds, please check the Hugging Face space log.
                </p>
              )}

              {whatsappState.status === 'connecting' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                  <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Initializing WhatsApp Web session...</span>
                </div>
              )}

              <div style={{ marginTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '1rem' }}>
                <button
                  className="btn-secondary"
                  style={{ 
                    width: '100%', 
                    padding: '0.6rem 1rem', 
                    fontSize: '0.85rem', 
                    borderColor: 'rgba(244, 63, 94, 0.3)',
                    color: '#fca5a5',
                    background: 'rgba(244, 63, 94, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem'
                  }}
                  disabled={isResettingWhatsapp}
                  onClick={handleResetWhatsapp}
                >
                  {isResettingWhatsapp ? (
                    <>
                      <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: '#fca5a5' }}></div>
                      Resetting Connection...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                      </svg>
                      Reset WhatsApp Connection
                    </>
                  )}
                </button>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem', textAlign: 'center', lineHeight: '1.3' }}>
                  ⚠️ If you logged out from WhatsApp on your phone or need to switch accounts, use this reset button to clear the session and generate a new QR code.
                </p>
              </div>
            </section>

            {/* Hugging Face Space & Keep-Alive Settings Card */}
            <section className="settings-group-card animate-fadeIn">
              <h3 className="settings-group-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-purple)', marginRight: '0.25rem' }}>
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
                <span>Hugging Face Space & Keep-Alive</span>
                <span className={`whatsapp-status-badge ${
                  hfStatus === 'RUNNING' ? 'ready' : 
                  hfStatus === 'SLEEPING' ? 'disconnected' : 
                  (hfStatus === 'BUILDING' || hfStatus === 'STARTING') ? 'connecting' : 'qr_code'
                }`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}>
                  {hfStatus === 'RUNNING' && '🟢 Running'}
                  {hfStatus === 'SLEEPING' && '🔴 Sleeping'}
                  {(hfStatus === 'BUILDING' || hfStatus === 'STARTING') && '🟡 Building...'}
                  {hfStatus === 'UNAUTHORIZED' && '🔒 Unauthorized'}
                  {hfStatus === 'NOT_CONFIGURED' && '⚪ Not Configured'}
                  {hfStatus !== 'RUNNING' && hfStatus !== 'SLEEPING' && hfStatus !== 'BUILDING' && hfStatus !== 'STARTING' && hfStatus !== 'UNAUTHORIZED' && hfStatus !== 'NOT_CONFIGURED' && `⚠️ ${hfStatus}`}
                </span>
              </h3>

              <div className="form-group">
                <label className="form-label">Space Repository ID</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="username/space-name"
                  value={config.huggingFaceSpace || ''}
                  onChange={e => {
                    const val = e.target.value;
                    setConfig(prev => ({ ...prev, huggingFaceSpace: val }));
                    setHasUnsavedChanges(true);
                  }}
                />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                  Format: `username/space-name` (e.g., `ganganimaulik/diet-maker-worker`).
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Hugging Face Read Token (Optional)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type={showHfToken ? 'text' : 'password'}
                    className="form-input"
                    placeholder="hf_..."
                    value={config.huggingFaceToken || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setConfig(prev => ({ ...prev, huggingFaceToken: val }));
                      setHasUnsavedChanges(true);
                    }}
                  />
                  <button type="button" className="btn-secondary" onClick={() => setShowHfToken(!showHfToken)}>
                    {showHfToken ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                  Required only if your Hugging Face Space is <strong>Private</strong>. Access tokens can be generated in your Hugging Face account settings.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button 
                  className="btn-primary" 
                  style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                  onClick={() => saveConfig()}
                  disabled={isSavingConfig}
                >
                  {isSavingConfig ? 'Saving...' : 'Save Settings'}
                </button>
                
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem', border: '1px solid var(--accent-purple)' }}
                  onClick={handleWakeUpSpace}
                  disabled={wakingUp || !config.huggingFaceSpace}
                >
                  {wakingUp ? 'Waking Up...' : 'Wake Up Space'}
                </button>
              </div>

              {hfDetails && (
                <div style={{ 
                  marginTop: '1rem', 
                  fontSize: '0.8rem', 
                  padding: '0.75rem', 
                  borderRadius: '8px', 
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.03)',
                  color: 'var(--text-secondary)'
                }}>
                  <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Space Specifications:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <span>💻 Hardware: {hfDetails.hardware}</span>
                    <span>🛠️ SDK: {hfDetails.sdk}</span>
                  </div>
                </div>
              )}

              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '1rem', lineHeight: '1.4' }}>
                ℹ️ Free Hugging Face Spaces sleep after 48 hours of inactivity. When you open this dashboard, it will automatically check the status and trigger a wake-up request if the Space is sleeping.
              </p>
            </section>

            {/* Daily Scheduler Card */}
            <section className="settings-group-card">
              <h3 className="settings-group-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-cyan)', marginRight: '0.25rem' }}>
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                Daily Auto-Send Scheduler
              </h3>
              
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <div 
                  className={`switch-container ${schedulerState.isEnabled ? 'checked' : ''}`}
                  onClick={() => setSchedulerState(prev => ({ ...prev, isEnabled: !prev.isEnabled }))}
                >
                  <div className="switch-control"></div>
                  <span className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Automated Sending</span>
                </div>
              </div>

              <div className="input-row" style={{ marginBottom: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Send Time (Daily)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={schedulerState.targetTime}
                    onChange={e => setSchedulerState(prev => ({ ...prev, targetTime: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <select
                    className="form-input"
                    value={schedulerState.timezone || 'Asia/Kolkata'}
                    onChange={e => setSchedulerState(prev => ({ ...prev, timezone: e.target.value }))}
                  >
                    <option value="Asia/Kolkata">India (IST) - GMT+5:30</option>
                    <option value="UTC">Coordinated Universal Time (UTC)</option>
                    <option value="America/New_York">US East (EST/EDT)</option>
                    <option value="America/Chicago">US Central (CST/CDT)</option>
                    <option value="America/Denver">US Mountain (MST/MDT)</option>
                    <option value="America/Los_Angeles">US West (PST/PDT)</option>
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Europe/Paris">Paris (CET/CEST)</option>
                    <option value="Asia/Singapore">Singapore (SGT)</option>
                    <option value="Asia/Dubai">Dubai (GST)</option>
                    <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                  </select>
                </div>

                <div className="form-group contact-picker-input">
                  <label className="form-label">Recipient (Contact or Group)</label>
                  
                  {schedulerState.recipientId ? (
                    <div className="selected-contact-card">
                      <div className="selected-contact-info">
                        <span className="selected-contact-name">
                          {schedulerState.recipientName || 'Selected Recipient'}
                          <span className="selected-contact-type">
                            {schedulerState.recipientType === 'group' ? 'Group' : 'Contact'}
                          </span>
                        </span>
                        <span className="selected-contact-id">
                          {schedulerState.recipientId}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="selected-contact-clear"
                        onClick={() => {
                          const newState = {
                            ...schedulerState,
                            recipientId: '',
                            recipientName: '',
                            recipientType: 'contact' as const
                          };
                          setSchedulerState(newState);
                          saveSchedulerDb(newState).catch(e => console.error('Failed to auto-save:', e));
                          setSearchContact('');
                        }}
                        title="Clear selection"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Search contact or group by name or number..."
                        value={searchContact}
                        onChange={e => {
                          setSearchContact(e.target.value);
                          setShowContactsDropdown(true);
                        }}
                        onFocus={() => setShowContactsDropdown(true)}
                        onBlur={() => setTimeout(() => setShowContactsDropdown(false), 200)}
                      />
                      
                      {showContactsDropdown && (
                        <div className="contacts-dropdown">
                          {contacts
                            .filter(c => c.name.toLowerCase().includes(searchContact.toLowerCase()) || c.id.includes(searchContact))
                            .map(contact => (
                              <div 
                                key={contact.id} 
                                className="contact-option"
                                onMouseDown={() => {
                                  const newState = {
                                    ...schedulerState,
                                    recipientId: contact.id,
                                    recipientName: contact.name,
                                    recipientType: (contact.isGroup ? 'group' : 'contact') as 'group' | 'contact'
                                  };
                                  setSchedulerState(newState);
                                  saveSchedulerDb(newState).catch(e => console.error('Failed to auto-save:', e));
                                  setSearchContact('');
                                  setShowContactsDropdown(false);
                                }}
                              >
                                <span>{contact.name}</span>
                                <span className="contact-option-type">{contact.isGroup ? 'Group' : 'Contact'}</span>
                              </div>
                            ))}
                            
                          {searchContact.trim() && (
                            <div 
                              className="contact-option"
                              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', color: 'var(--accent-cyan)' }}
                              onMouseDown={() => {
                                const inputVal = searchContact.trim();
                                const isGroup = inputVal.endsWith('@g.us') || inputVal.includes('-');
                                const newState = {
                                  ...schedulerState,
                                  recipientId: inputVal,
                                  recipientName: inputVal.split('@')[0],
                                  recipientType: (isGroup ? 'group' : 'contact') as 'group' | 'contact'
                                };
                                setSchedulerState(newState);
                                saveSchedulerDb(newState).catch(e => console.error('Failed to auto-save:', e));
                                setSearchContact('');
                                setShowContactsDropdown(false);
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>➕ Use manual ID:</span>
                                <strong style={{ fontFamily: 'var(--font-mono)' }}>{searchContact}</strong>
                              </span>
                              <span className="contact-option-type" style={{ color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.15)' }}>Manual</span>
                            </div>
                          )}

                          {contacts.filter(c => c.name.toLowerCase().includes(searchContact.toLowerCase()) || c.id.includes(searchContact)).length === 0 && !searchContact.trim() && (
                            <div className="contact-option" style={{ cursor: 'default', color: 'var(--text-muted)' }}>
                              <span>No contacts found. Scan QR/connect first.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button 
                  className="btn-primary" 
                  style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                  onClick={saveSchedulerSettings}
                  disabled={isSavingScheduler}
                >
                  {isSavingScheduler ? 'Saving...' : 'Save Settings'}
                </button>
                
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem', border: '1px solid var(--accent-purple)' }}
                  onClick={handleSendTestMessage}
                  disabled={testSendStatus.status === 'sending' || whatsappState.status !== 'ready' || !schedulerState.recipientId}
                >
                  {testSendStatus.status === 'sending' ? 'Sending Test...' : 'Send Test Now'}
                </button>
              </div>

              {!schedulerState.recipientId && whatsappState.status === 'ready' && (
                <div style={{ 
                  marginTop: '1rem', 
                  fontSize: '0.8rem', 
                  padding: '0.5rem 0.75rem', 
                  borderRadius: '6px',
                  color: 'var(--accent-rose)',
                  background: 'rgba(244, 63, 94, 0.08)',
                  border: '1px solid rgba(244, 63, 94, 0.15)'
                }}>
                  ⚠️ Select a recipient (contact or group) above to enable test sending.
                </div>
              )}

              {testSendStatus.message && (
                <div style={{ 
                  marginTop: '1rem', 
                  fontSize: '0.8rem', 
                  padding: '0.5rem 0.75rem', 
                  borderRadius: '6px',
                  color: testSendStatus.status === 'success' ? '#6ee7b7' : testSendStatus.status === 'error' ? '#fca5a5' : 'var(--text-secondary)',
                  background: testSendStatus.status === 'success' ? 'rgba(16, 185, 129, 0.1)' : testSendStatus.status === 'error' ? 'rgba(244, 63, 94, 0.1)' : 'rgba(255,255,255,0.03)'
                }}>
                  {testSendStatus.message}
                </div>
              )}
            </section>

            {/* Scheduler Status Logs Card */}
            <section className="settings-group-card">
              <h3 className="settings-group-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-rose)', marginRight: '0.25rem' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Scheduler Status Logs
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Last Sent Date</div>
                  <div style={{ fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>{schedulerState.lastSentDate || 'Never'}</div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Retry Attempts</div>
                  <div style={{ fontWeight: 700, color: schedulerState.retryCount > 0 ? 'var(--accent-rose)' : '#fff', marginTop: '0.25rem' }}>
                    {schedulerState.retryCount}
                  </div>
                </div>

                {schedulerState.retryCount > 0 && (
                  <div style={{ gridColumn: 'span 2', background: 'rgba(244, 63, 94, 0.05)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(244, 63, 94, 0.15)' }}>
                    <div style={{ color: 'var(--accent-rose)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Next Auto Retry</div>
                    <div style={{ fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>
                      {new Date(schedulerState.nextRetryTime).toLocaleString()}
                    </div>
                  </div>
                )}

                {schedulerState.lastError && (
                  <div style={{ gridColumn: 'span 2', background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', color: '#fda4af' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Last Error Log</div>
                    <div style={{ marginTop: '0.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                      {schedulerState.lastError}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      )}

      <footer className="footer">
        <p>AI Diet Maker © 2026. Made with Google Gemini API.</p>
      </footer>
    </div>
  );
}

// Sub-components and helpers for copying individual days
function DayCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  
  return (
    <button 
      className="btn-secondary" 
      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} 
      onClick={handleCopy}
    >
      {copied ? (
        <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Day
        </span>
      )}
    </button>
  );
}

function parseCookPlanDays(cookPlan: string) {
  if (!cookPlan) return [];
  
  const dayRegex = /###\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)[^\n]*/i;
  const lines = cookPlan.split('\n');
  const days: { day: string, heading: string, content: string[] }[] = [];
  let currentDay: typeof days[0] | null = null;
  
  for (const line of lines) {
    const match = line.match(dayRegex);
    if (match) {
      const dayName = match[1].toUpperCase();
      currentDay = {
        day: dayName,
        heading: line.trim(),
        content: []
      };
      days.push(currentDay);
    } else if (currentDay) {
      currentDay.content.push(line);
    }
  }
  
  return days.map(d => ({
    day: d.day,
    heading: d.heading,
    content: d.content.join('\n').trim()
  })).filter(d => d.content.length > 0);
}
