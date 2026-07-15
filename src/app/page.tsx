'use client';
/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useEffect, useRef } from 'react';
import { getDayVariantName, compilePromptText } from '@/lib/compile-prompt';

// Type definitions
interface Ingredient {
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
  cookQuantityMode?: 'daily' | 'per-meal';
  totalOliveOil?: number;
  oliveOilSplitPercent?: number;
  disabled?: boolean;
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
  return normalized;
};

const stableStringify = (obj: any): string => {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') + '}';
};

export default function Home() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [currentView, setCurrentView] = useState<'planner' | 'connections'>('planner');
  const [activeTab, setActiveTab] = useState<string>('global');
  const [activeDay, setActiveDay] = useState<string>('MONDAY');
  
  // Drag and drop states for day swap
  const [draggedDay, setDraggedDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  
  // Drag and drop states for meal reorder
  const [draggedMealId, setDraggedMealId] = useState<string | null>(null);
  const [dragOverMealId, setDragOverMealId] = useState<string | null>(null);
  
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

  // Cache states
  const [cacheStatus, setCacheStatus] = useState<Record<string, { generatedAt: string; isValid: boolean }>>({});
  const [isCachedResponse, setIsCachedResponse] = useState(false);
  const [isCacheLoading, setIsCacheLoading] = useState(false);

  // Authentication and Save states
  const [isAuthenticatedState, setIsAuthenticatedState] = useState<boolean | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const hasUnsavedChanges = savedConfig
    ? stableStringify(config) !== stableStringify(savedConfig)
    : false;

  // WhatsApp bot states
  const [whatsappState, setWhatsappState] = useState({
    status: 'disconnected',
    qr: '',
    connectedPhone: '',
    connectedName: '',
  });
  const [schedulerState, setSchedulerState] = useState({
    isEnabled: false,
    targetTime: '14:00',
    timezone: 'Asia/Kolkata',
    recipientType: 'contact' as 'contact' | 'group',
    recipientId: '',
    recipientName: '',
    userRecipientType: 'contact' as 'contact' | 'group',
    userRecipientId: '',
    userRecipientName: '',
    lastSentDate: '',
    lastSentTime: '',
    lastError: '',
    retryCount: 0,
    nextRetryTime: 0,
  });
  const [isSchedulerDirty, setIsSchedulerDirtyState] = useState(false);
  const isSchedulerDirtyRef = useRef(false);
  const setIsSchedulerDirty = (value: boolean) => {
    isSchedulerDirtyRef.current = value;
    setIsSchedulerDirtyState(value);
  };
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; isGroup: boolean }>>([]);
  const [searchContact, setSearchContact] = useState('');
  const [showContactsDropdown, setShowContactsDropdown] = useState(false);
  const [searchUserContact, setSearchUserContact] = useState('');
  const [showUserContactsDropdown, setShowUserContactsDropdown] = useState(false);
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
      setSavedConfig(configToSave);
      // Refresh cache status — config hash may have changed, invalidating cached responses
      fetchCacheStatus();
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
          if (!isSchedulerDirtyRef.current) {
            setSchedulerState(data.scheduler);
          } else {
            // Merge background updates into local state without losing user edits
            setSchedulerState(prev => ({
              ...prev,
              lastSentDate: data.scheduler.lastSentDate,
              lastSentTime: data.scheduler.lastSentTime,
              lastError: data.scheduler.lastError,
              retryCount: data.scheduler.retryCount,
              nextRetryTime: data.scheduler.nextRetryTime,
            }));
          }
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
            const normalized = normalizeConfig(configData.config);
            setConfig(normalized);
            setSavedConfig(normalized);
          } else {
            // First time setup, save default config to DB
            await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(DEFAULT_CONFIG)
            });
            setConfig(DEFAULT_CONFIG);
            setSavedConfig(DEFAULT_CONFIG);
          }
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
          const normalized = normalizeConfig(configData.config);
          setConfig(normalized);
          setSavedConfig(normalized);
        } else {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(DEFAULT_CONFIG)
          });
          setConfig(DEFAULT_CONFIG);
          setSavedConfig(DEFAULT_CONFIG);
        }
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
      setSavedConfig(null);
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
      if (schedulerState.isEnabled && !schedulerState.recipientId && !schedulerState.userRecipientId) {
        alert('Please select at least one recipient (Cook or Myself) before enabling the automated scheduler.');
        setIsSavingScheduler(false);
        return;
      }
      if (schedulerState.isEnabled) {
        const [hourStr, minStr] = schedulerState.targetTime.split(':');
        const hour = parseInt(hourStr);
        const minute = parseInt(minStr);
        const totalMinutes = hour * 60 + minute;
        
        const isMorning = totalMinutes >= 0 && totalMinutes <= 9 * 60 + 30;
        const isAfternoon = totalMinutes >= 14 * 60 && totalMinutes <= 23 * 60 + 59;
        
        if (!isMorning && !isAfternoon) {
          alert('Automated messages must be scheduled to send either in the morning (12:00 AM to 9:30 AM) for the same day, or after 2:00 PM (14:00 to 11:59 PM) today for the next day. Please update the send time.');
          setIsSavingScheduler(false);
          return;
        }
      }
      await saveSchedulerDb(schedulerState);
      setIsSchedulerDirty(false);
      alert('Scheduler settings saved successfully!');
    } catch (e) {
      alert('Failed to save scheduler settings.');
    } finally {
      setIsSavingScheduler(false);
    }
  };

  // Trigger immediate test message delivery
  const handleSendTestMessage = async (type: 'myself' | 'cook') => {
    setTestSendStatus({ status: 'sending', message: `Triggering test send for ${type === 'myself' ? 'Myself' : 'Cook'}...` });
    try {
      // Auto-save the config first to ensure today's test matches edits
      await saveConfig(config);
      
      // Auto-save scheduler settings first to ensure the recipient JID is updated in the DB
      await saveSchedulerDb(schedulerState);
      setIsSchedulerDirty(false);
      
      const res = await fetch('/api/whatsapp/send-test', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (res.ok) {
        setTestSendStatus({ 
          status: 'success', 
          message: `Test for ${type === 'myself' ? 'Myself' : 'Cook'} triggered successfully! The background worker will generate and send the message shortly.` 
        });
        setTimeout(() => setTestSendStatus({ status: 'idle', message: '' }), 5000);
      } else {
        throw new Error(data.error || 'Failed to trigger test send.');
      }
    } catch (e: any) {
      setTestSendStatus({ status: 'error', message: e.message || 'Error triggering test send.' });
    }
  };


  const autoGeneratedPrompt = compilePromptText(config, { mode: config.generationRange, selectedDay: config.selectedGenerationDay });
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
      cookQuantityMode: 'daily' as const,
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

  const reorderMeals = (draggedId: string, targetId: string) => {
    setConfig(prev => {
      const meals = [...(prev.meals || [])];
      const draggedIndex = meals.findIndex(m => m.id === draggedId);
      const targetIndex = meals.findIndex(m => m.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev;
      
      const [draggedMeal] = meals.splice(draggedIndex, 1);
      meals.splice(targetIndex, 0, draggedMeal);
      
      return {
        ...prev,
        meals
      };
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
            if (!value) { item.maxGrams = ''; item.minGrams = ''; }
          } else if (field === 'weight') {
            item.weight = value;
            if (value) { item.isAuto = false; item.maxGrams = ''; item.minGrams = ''; }
          } else if (field === 'disabled') {
            item.disabled = value;
          } else {
            (item as any)[field] = value;
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
    setConfig(prev => {
      const defaultMealId = prev.meals[0]?.id || '';
      const defaultIng: Ingredient = {
        name: 'New Item',
        weight: '0',
        isAuto: false,
        personalOnly: false,
        mealId: defaultMealId
      };
      return {
        ...prev,
        dailyVariables: {
          ...prev.dailyVariables,
          [dayKey]: [...(prev.dailyVariables[dayKey] || []), defaultIng]
        }
      };
    });
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
        if (!value) { item.maxGrams = ''; item.minGrams = ''; }
      } else if (field === 'weight') {
        item.weight = value;
        if (value) { item.isAuto = false; item.maxGrams = ''; item.minGrams = ''; }
      } else if (field === 'disabled') {
        item.disabled = value;
      } else {
        (item as any)[field] = value;
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
      return { ...prev, dailySplits };
    });
  };



  // Run AI Generation
  // Fetch cache status for all days
  const fetchCacheStatus = async () => {
    try {
      const res = await fetch('/api/cache');
      if (res.ok) {
        const data = await res.json();
        const statusMap: Record<string, { generatedAt: string; isValid: boolean }> = {};
        for (const entry of data.entries || []) {
          statusMap[entry.day] = { generatedAt: entry.generatedAt, isValid: entry.isValid };
        }
        setCacheStatus(statusMap);
      }
    } catch (e) {
      console.error('Error fetching cache status:', e);
    }
  };

  // Check cache for a specific day; returns { responseText, thinkingText } or null
  const checkCache = async (day: string): Promise<{ responseText: string; thinkingText: string } | null> => {
    try {
      const res = await fetch(`/api/cache?day=${day}`);
      if (res.ok) {
        const data = await res.json();
        if (data.cached && data.cached.isValid && data.cached.responseText) {
          return { responseText: data.cached.responseText, thinkingText: data.cached.thinkingText || '' };
        }
      }
    } catch (e) {
      console.error('Error checking cache:', e);
    }
    return null;
  };

  // Save a response to cache
  const saveToCache = async (day: string, responseText: string, thinkingText: string) => {
    try {
      await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, responseText, thinkingText })
      });
      fetchCacheStatus();
    } catch (e) {
      console.error('Error saving to cache:', e);
    }
  };

  // Clear cache for a specific day or all days
  const clearCache = async (day?: string) => {
    try {
      const url = day ? `/api/cache?day=${day}` : '/api/cache';
      await fetch(url, { method: 'DELETE' });
      setCacheStatus(prev => {
        if (day) {
          const next = { ...prev };
          delete next[day];
          return next;
        }
        return {};
      });
      setIsCachedResponse(false);
    } catch (e) {
      console.error('Error clearing cache:', e);
    }
  };

  // Fetch cache status on mount & after config saves
  useEffect(() => {
    if (isAuthenticatedState) {
      fetchCacheStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticatedState]);

  // Get the cache key for the current generation scope
  const getCurrentCacheDay = (): string => {
    if (config.generationRange === 'single') {
      return config.selectedGenerationDay || 'MONDAY';
    }
    return 'ALL_DAYS';
  };

  // Run AI Generation
  const handleGenerate = async (forceRegenerate = false) => {
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

    const cacheDay = getCurrentCacheDay();

    // Check cache first (unless forcing regeneration)
    if (!forceRegenerate && !isCustomMode) {
      setIsCacheLoading(true);
      const cached = await checkCache(cacheDay);
      setIsCacheLoading(false);
      if (cached) {
        setOutputText(cached.responseText);
        setThinkingText(cached.thinkingText);
        setIsCachedResponse(true);
        setErrorMsg('');
        setOutputTab('user');
        return;
      }
    }

    setIsGenerating(true);
    setErrorMsg('');
    setOutputText('');
    setThinkingText('');
    setIsCachedResponse(false);

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

      if (!res.ok) {
        let errorMessage = 'Server responded with an error.';
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentText = '';
      let currentThought = '';
      let hasSwitchedToThoughts = false;
      let hasSwitchedToUser = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.thought) {
                currentThought += parsed.thought;
                setThinkingText(currentThought);
                if (!hasSwitchedToThoughts) {
                  hasSwitchedToThoughts = true;
                  setOutputTab('thoughts');
                }
              }
              if (parsed.text) {
                currentText += parsed.text;
                setOutputText(currentText);
                if (!hasSwitchedToUser) {
                  hasSwitchedToUser = true;
                  setOutputTab('user');
                }
              }
            } catch (err) {
              console.error('Error parsing SSE line:', err);
            }
          }
        }
      }

      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.thought) {
            currentThought += parsed.thought;
            setThinkingText(currentThought);
            if (!hasSwitchedToThoughts) {
              hasSwitchedToThoughts = true;
              setOutputTab('thoughts');
            }
          }
          if (parsed.text) {
            currentText += parsed.text;
            setOutputText(currentText);
            if (!hasSwitchedToUser) {
              hasSwitchedToUser = true;
              setOutputTab('user');
            }
          }
        } catch (err) {}
      }

      // Save to cache after successful generation (only for non-custom prompts)
      if (currentText && !isCustomMode) {
        saveToCache(cacheDay, currentText, currentThought);
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
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
          <div className="header-title-container">
            <h1 className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.45))' }}>🥗</span> AI Diet Maker
            </h1>
            <p className="header-subtitle">Strict meal prep calculator, solved via Gemini Thinking Models</p>
          </div>

          <nav className="header-nav">
            <button 
              className={`header-nav-btn ${currentView === 'planner' ? 'active' : ''}`}
              onClick={() => {
                setCurrentView('planner');
                if (activeTab === 'whatsapp') {
                  setActiveTab('global');
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
              Diet Planner
            </button>
            <button 
              className={`header-nav-btn ${currentView === 'connections' ? 'active' : ''}`}
              onClick={() => setCurrentView('connections')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Settings &amp; Connections
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
              {whatsappState.status === 'ready' && 'WhatsApp Ready'}
              {whatsappState.status === 'connecting' && 'WhatsApp Connecting'}
              {whatsappState.status === 'qr_code' && 'WhatsApp Scan QR'}
              {whatsappState.status === 'disconnected' && 'WhatsApp Offline'}
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '0.2rem' }}>
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

          <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }} onClick={handleLogout}>
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

            <div className="builder-layout">
              <aside className="builder-sidebar">
                <div className="builder-sidebar-title">Configuration</div>
                <button
                  className={`builder-nav-btn ${activeTab === 'global' ? 'active' : ''}`}
                  onClick={() => setActiveTab('global')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"/>
                      <circle cx="12" cy="12" r="6"/>
                      <circle cx="12" cy="12" r="2"/>
                    </svg>
                    Targets & Splits
                  </span>
                </button>

                <div className="builder-sidebar-title">Meals</div>
                {(config.meals || []).map(meal => (
                  <button
                    key={meal.id}
                    draggable
                    className={`builder-nav-btn ${activeTab === meal.id ? 'active' : ''} ${dragOverMealId === meal.id ? 'drag-over' : ''} ${meal.disabled ? 'disabled' : ''}`}
                    onClick={() => setActiveTab(meal.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', meal.id);
                      setDraggedMealId(meal.id);
                    }}
                    onDragEnd={() => {
                      setDraggedMealId(null);
                      setDragOverMealId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedMealId && draggedMealId !== meal.id) {
                        setDragOverMealId(meal.id);
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverMealId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceMealId = e.dataTransfer.getData('text/plain') || draggedMealId;
                      if (sourceMealId && sourceMealId !== meal.id) {
                        reorderMeals(sourceMealId, meal.id);
                      }
                      setDraggedMealId(null);
                      setDragOverMealId(null);
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                      </svg>
                      {meal.name}
                    </span>
                    {meal.disabled && <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>(disabled)</span>}
                  </button>
                ))}
                
                <button 
                  className="builder-nav-btn" 
                  onClick={addNewMeal}
                  style={{ border: '1px dashed var(--accent-purple)', color: 'var(--accent-purple)', justifyContent: 'center', marginTop: '0.25rem' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '0.2rem' }}>
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Meal
                </button>

                <div className="builder-sidebar-title">Variables & Code</div>
                <button 
                  className={`builder-nav-btn ${activeTab === 'daily' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('daily')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    Daily Variables
                  </span>
                </button>
                <button 
                  className={`builder-nav-btn ${activeTab === 'prompt' ? 'active' : ''}`} 
                  onClick={() => setActiveTab('prompt')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    System Prompt
                  </span>
                </button>
              </aside>

              <div className="builder-content">

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
                    <label className="form-label">Min Ideal Na:K Ratio</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      value={config.global.idealSodiumPotassiumRatioMin === undefined ? 0.70 : config.global.idealSodiumPotassiumRatioMin}
                      onChange={e => updateGlobal('idealSodiumPotassiumRatioMin', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Ideal Na:K Ratio</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      value={config.global.idealSodiumPotassiumRatioMax === undefined ? 0.80 : config.global.idealSodiumPotassiumRatioMax}
                      onChange={e => updateGlobal('idealSodiumPotassiumRatioMax', parseFloat(e.target.value) || 0)}
                    />
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Meal Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={selectedMeal.name}
                        onChange={e => updateMeal(selectedMeal.id, 'name', e.target.value)}
                        placeholder="e.g. Oats Meal, Pasta Meal"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: '1 1 120px', margin: 0 }}>
                        <label className="form-label">Meals Per Day (Frequency)</label>
                        <input
                          type="number"
                          className="form-input"
                          value={selectedMeal.mealsPerDay}
                          onChange={e => updateMeal(selectedMeal.id, 'mealsPerDay', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="form-group" style={{ flex: '2 1 200px', margin: 0 }}>
                        <label className="form-label">Status</label>
                        <div style={{ display: 'flex', alignItems: 'center', minHeight: '44px' }}>
                          <label className="auto-checkbox-container" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              style={{ cursor: 'pointer' }}
                              checked={!selectedMeal.disabled}
                              onChange={e => updateMeal(selectedMeal.id, 'disabled', !e.target.checked)}
                            />
                            Active / Include in Prompt
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '1.5rem', maxWidth: '550px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', padding: '0.85rem 1.15rem', borderRadius: '10px' }}>
                    <label className="form-label" style={{ marginBottom: '0.35rem' }}>Cook Quantity Mode</label>
                    <div style={{ display: 'flex', gap: '1.5rem', margin: '0.25rem 0' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`cookQty-${selectedMeal.id}`}
                          checked={(selectedMeal.cookQuantityMode || 'daily') === 'daily'}
                          onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'daily')}
                        />
                        Whole Day Total
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`cookQty-${selectedMeal.id}`}
                          checked={(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'}
                          onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'per-meal')}
                        />
                        Per Meal
                      </label>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', margin: '0.25rem 0 0 0', lineHeight: '1.4' }}>
                      {(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'
                        ? `Cook message will show per-meal quantities (daily total ÷ ${selectedMeal.mealsPerDay}).`
                        : 'Cook message will show the entire day\'s total for this meal.'}
                    </p>
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
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div className={`ingredient-row-compact ${ing.disabled ? 'is-disabled' : ''}`}>
                          <input
                            type="text"
                            className="form-input"
                            style={{ textDecoration: ing.disabled ? 'line-through' : 'none' }}
                            value={ing.name}
                            disabled={ing.disabled}
                            onChange={e => updateMealIngredient(selectedMeal.id, idx, 'name', e.target.value)}
                            placeholder="Ingredient Name"
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input
                              type="number"
                              className="form-input"
                              placeholder="Weight"
                              disabled={ing.isAuto || ing.disabled}
                              value={ing.weight}
                              onChange={e => updateMealIngredient(selectedMeal.id, idx, 'weight', e.target.value)}
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>g</span>
                          </div>
                          
                          <label className="auto-checkbox-container" title="Active">
                            <input
                              type="checkbox"
                              checked={!ing.disabled}
                              onChange={e => updateMealIngredient(selectedMeal.id, idx, 'disabled', !e.target.checked)}
                            />
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Active</span>
                          </label>

                          <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="AUTO">
                            <input
                              type="checkbox"
                              disabled={ing.disabled}
                              checked={ing.isAuto}
                              onChange={e => updateMealIngredient(selectedMeal.id, idx, 'isAuto', e.target.checked)}
                            />
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>AUTO</span>
                          </label>

                          <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="Personal">
                            <input
                              type="checkbox"
                              disabled={ing.disabled}
                              checked={!!ing.personalOnly}
                              onChange={e => updateMealIngredient(selectedMeal.id, idx, 'personalOnly', e.target.checked)}
                            />
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Pers.</span>
                          </label>

                          <button className="btn-remove" onClick={() => removeMealIngredient(selectedMeal.id, idx)} title="Delete Ingredient">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>

                        {!ing.disabled && (
                          <div className="ingredient-sub-options">
                            {ing.isAuto && (
                              <div className="ingredient-sub-range">
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>AUTO RANGE:</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Min</span>
                                  <input
                                    type="number"
                                    className="form-input"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                                    placeholder="Min g"
                                    disabled={ing.disabled || !ing.isAuto}
                                    value={ing.minGrams || ''}
                                    onChange={e => updateMealIngredient(selectedMeal.id, idx, 'minGrams', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Max</span>
                                  <input
                                    type="number"
                                    className="form-input"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                                    placeholder="Max g"
                                    disabled={ing.disabled || !ing.isAuto}
                                    value={ing.maxGrams || ''}
                                    onChange={e => updateMealIngredient(selectedMeal.id, idx, 'maxGrams', e.target.value)}
                                  />
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
                                </div>
                              </div>
                            )}

                            <div className="ingredient-sub-split">
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '40px', fontWeight: 600 }}>Split:</span>
                              <input 
                                type="text" 
                                className="form-input" 
                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', flex: 1, height: 'auto', background: 'rgba(0,0,0,0.15)' }} 
                                placeholder="Optional split instruction (e.g. 50% in subji, remaining in chicken)"
                                value={ing.split || ''}
                                onChange={e => updateMealIngredient(selectedMeal.id, idx, 'split', e.target.value)}
                              />
                            </div>
                          </div>
                        )}
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
                    <textarea
                      className="form-input"
                      value={selectedMeal.prepMethod}
                      onChange={e => updateMeal(selectedMeal.id, 'prepMethod', e.target.value)}
                      placeholder="e.g. Cook in airfryer 200c for 10 min"
                      rows={3}
                      style={{ resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
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
                        if (draggedDay && sourceDay && sourceDay !== day) {
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
                    Ingredients for {activeDay} ({getDayVariantName(config.dailyVariables[activeDay] || [], config.meals.filter(m => !m.disabled))})
                  </h4>
                </div>

                <div className="ingredients-list">
                  {(config.dailyVariables[activeDay] || []).map((ing, idx) => (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div className={`ingredient-row-compact ${ing.disabled ? 'is-disabled' : ''}`} style={{ gridTemplateColumns: 'minmax(140px, 2fr) minmax(100px, 1.5fr) 125px auto auto auto auto' }}>
                        <input
                          type="text"
                          className="form-input"
                          style={{ textDecoration: ing.disabled ? 'line-through' : 'none' }}
                          value={ing.name}
                          disabled={ing.disabled}
                          onChange={e => updateIngredient('daily', idx, 'name', e.target.value, activeDay)}
                          placeholder="Ingredient Name"
                        />
                        <select
                          className="form-input"
                          style={{ background: 'rgba(0,0,0,0.15)' }}
                          value={ing.mealId || ''}
                          disabled={ing.disabled}
                          onChange={e => updateIngredient('daily', idx, 'mealId', e.target.value, activeDay)}
                        >
                          <option value="" disabled>Select Meal...</option>
                          {config.meals.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <input
                            type="number"
                            className="form-input"
                            placeholder="Weight"
                            disabled={ing.isAuto || ing.disabled}
                            value={ing.weight}
                            onChange={e => updateIngredient('daily', idx, 'weight', e.target.value, activeDay)}
                          />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>g</span>
                        </div>
                        
                        <label className="auto-checkbox-container" title="Active">
                          <input
                            type="checkbox"
                            checked={!ing.disabled}
                            onChange={e => updateIngredient('daily', idx, 'disabled', !e.target.checked, activeDay)}
                          />
                          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Active</span>
                        </label>

                        <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="AUTO">
                          <input
                            type="checkbox"
                            disabled={ing.disabled}
                            checked={ing.isAuto}
                            onChange={e => updateIngredient('daily', idx, 'isAuto', e.target.checked, activeDay)}
                          />
                          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>AUTO</span>
                        </label>

                        <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="Personal">
                          <input
                            type="checkbox"
                            disabled={ing.disabled}
                            checked={!!ing.personalOnly}
                            onChange={e => updateIngredient('daily', idx, 'personalOnly', e.target.checked, activeDay)}
                          />
                          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Pers.</span>
                        </label>

                        <button className="btn-remove" onClick={() => removeIngredient('daily', idx, activeDay)} title="Delete Ingredient">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>

                      {!ing.disabled && (
                        <div className="ingredient-sub-options" style={{ marginLeft: '1.5rem' }}>
                          {ing.isAuto && (
                            <div className="ingredient-sub-range">
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>AUTO RANGE:</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Min</span>
                                <input
                                  type="number"
                                  className="form-input"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                                  placeholder="Min g"
                                  disabled={ing.disabled || !ing.isAuto}
                                  value={ing.minGrams || ''}
                                  onChange={e => updateIngredient('daily', idx, 'minGrams', e.target.value, activeDay)}
                                />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Max</span>
                                <input
                                  type="number"
                                  className="form-input"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                                  placeholder="Max g"
                                  disabled={ing.disabled || !ing.isAuto}
                                  value={ing.maxGrams || ''}
                                  onChange={e => updateIngredient('daily', idx, 'maxGrams', e.target.value, activeDay)}
                                />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
                              </div>
                            </div>
                          )}

                          <div className="ingredient-sub-split">
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '40px', fontWeight: 600 }}>Split:</span>
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', flex: 1, height: 'auto', background: 'rgba(0,0,0,0.15)' }} 
                              placeholder="Optional split instruction (e.g. 50% in subji, remaining in chicken)"
                              value={ing.split || ''}
                              onChange={e => updateIngredient('daily', idx, 'split', e.target.value, activeDay)}
                            />
                          </div>
                        </div>
                      )}
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
                      const variant = getDayVariantName(ingredients, config.meals.filter(m => !m.disabled));
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
              {/* Cache status indicator */}
              {(() => {
                const cacheDay = getCurrentCacheDay();
                const cached = cacheStatus[cacheDay];
                if (cached) {
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(cached.generatedAt).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return 'just now';
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days}d ago`;
                  })();
                  return (
                    <div className={`cache-status-bar ${cached.isValid ? 'cache-valid' : 'cache-stale'}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                        <span style={{ fontSize: '0.9rem' }}>{cached.isValid ? '✅' : '⚠️'}</span>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                            {cached.isValid ? 'Cached response available' : 'Cache stale — config changed'}
                          </span>
                          <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: '0.5rem' }}>Generated {timeAgo}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          className="cache-action-btn cache-clear-btn"
                          onClick={() => clearCache(cacheDay)}
                          title="Delete cached response"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
                          </svg>
                          Clear
                        </button>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={isGenerating || isCacheLoading}
                  onClick={() => handleGenerate(false)}
                >
                  {isGenerating ? (
                    <>
                      <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                      Calculating &amp; Generating...
                    </>
                  ) : isCacheLoading ? (
                    <>
                      <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                      Checking cache...
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

                {cacheStatus[getCurrentCacheDay()] && (
                  <button
                    className="btn-regenerate"
                    disabled={isGenerating || isCacheLoading}
                    onClick={() => handleGenerate(true)}
                    title="Skip cache and regenerate fresh"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M1 4v6h6M23 20v-6h-6"/>
                      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                    </svg>
                    Regenerate
                  </button>
                )}
              </div>
            </div> {/* cache container */}
          </div> {/* builder-content */}
        </div> {/* builder-layout */}
      </section>

          {/* Right Column: AI Outputs */}
          <section className="glass-panel" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
            <div className="output-header-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '1.5rem' }}>
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
              {isGenerating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', color: '#c084fc', fontSize: '0.85rem', fontWeight: 600 }}>
                  <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', boxShadow: 'none', margin: 0 }}></div>
                  <span style={{ opacity: 0.9 }}>Streaming...</span>
                </div>
              )}
              {isCachedResponse && !isGenerating && outputText && (
                <div className="cache-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <path d="M22 4L12 14.01l-3-3"/>
                  </svg>
                  Cached
                </div>
              )}
            </div>

            {errorMsg && (
              <div style={{ background: 'rgba(244, 63, 94, 0.1)', borderLeft: '4px solid var(--accent-rose)', color: '#fda4af', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Generation Error</div>
                {errorMsg}
              </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {isGenerating && !outputText && !thinkingText ? (
                <div className="loading-container" style={{ flex: 1 }}>
                  <div className="spinner"></div>
                  <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Gemini is solving calculations...</p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
                </div>
              ) : outputText || thinkingText ? (
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
                          <div key={idx} style={{ 
                            padding: '1.25rem', 
                            background: 'rgba(255,255,255,0.015)', 
                            border: '1px solid rgba(255,255,255,0.04)', 
                            borderRadius: '12px',
                            transition: 'all var(--transition-fast)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
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
                              padding: '0.85rem 1rem', 
                              borderRadius: '8px', 
                              fontSize: '0.82rem', 
                              fontFamily: 'var(--font-mono)', 
                              color: 'var(--text-secondary)',
                              whiteSpace: 'pre-wrap',
                              lineHeight: '1.6',
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
                  {hfStatus === 'RUNNING' && 'Running'}
                  {hfStatus === 'SLEEPING' && 'Sleeping'}
                  {(hfStatus === 'BUILDING' || hfStatus === 'STARTING') && 'Building...'}
                  {hfStatus === 'UNAUTHORIZED' && 'Unauthorized'}
                  {hfStatus === 'NOT_CONFIGURED' && 'Not Configured'}
                  {hfStatus !== 'RUNNING' && hfStatus !== 'SLEEPING' && hfStatus !== 'BUILDING' && hfStatus !== 'STARTING' && hfStatus !== 'UNAUTHORIZED' && hfStatus !== 'NOT_CONFIGURED' && hfStatus}
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
                  onClick={() => {
                    setSchedulerState(prev => ({ ...prev, isEnabled: !prev.isEnabled }));
                    setIsSchedulerDirty(true);
                  }}
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
                    onChange={e => {
                      setSchedulerState(prev => ({ ...prev, targetTime: e.target.value }));
                      setIsSchedulerDirty(true);
                    }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <select
                    className="form-input"
                    value={schedulerState.timezone || 'Asia/Kolkata'}
                    onChange={e => {
                      setSchedulerState(prev => ({ ...prev, timezone: e.target.value }));
                      setIsSchedulerDirty(true);
                    }}
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
              </div>

              <div className="input-row" style={{ marginBottom: '1rem' }}>
                <div className="form-group contact-picker-input">
                  <label className="form-label">Cook Recipient (Part 2: For Cook)</label>
                  
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
                          setIsSchedulerDirty(true);
                          saveSchedulerDb(newState)
                            .then(() => setIsSchedulerDirty(false))
                            .catch(e => {
                              console.error('Failed to auto-save:', e);
                              setIsSchedulerDirty(false);
                            });
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
                                  setIsSchedulerDirty(true);
                                  saveSchedulerDb(newState)
                                    .then(() => setIsSchedulerDirty(false))
                                    .catch(e => {
                                      console.error('Failed to auto-save:', e);
                                      setIsSchedulerDirty(false);
                                    });
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
                                setIsSchedulerDirty(true);
                                saveSchedulerDb(newState)
                                  .then(() => setIsSchedulerDirty(false))
                                  .catch(e => {
                                    console.error('Failed to auto-save:', e);
                                    setIsSchedulerDirty(false);
                                  });
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

                <div className="form-group contact-picker-input">
                  <label className="form-label">Myself Recipient (Part 1: For Myself)</label>
                  
                  {schedulerState.userRecipientId ? (
                    <div className="selected-contact-card" style={{ background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
                      <div className="selected-contact-info">
                        <span className="selected-contact-name">
                          {schedulerState.userRecipientName || 'Selected Recipient'}
                          <span className="selected-contact-type" style={{ background: 'rgba(6, 182, 212, 0.2)', color: 'var(--accent-cyan)' }}>
                            {schedulerState.userRecipientType === 'group' ? 'Group' : 'Contact'}
                          </span>
                        </span>
                        <span className="selected-contact-id">
                          {schedulerState.userRecipientId}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="selected-contact-clear"
                        onClick={() => {
                          const newState = {
                            ...schedulerState,
                            userRecipientId: '',
                            userRecipientName: '',
                            userRecipientType: 'contact' as const
                          };
                          setSchedulerState(newState);
                          setIsSchedulerDirty(true);
                          saveSchedulerDb(newState)
                            .then(() => setIsSchedulerDirty(false))
                            .catch(e => {
                              console.error('Failed to auto-save:', e);
                              setIsSchedulerDirty(false);
                            });
                          setSearchUserContact('');
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
                        value={searchUserContact}
                        onChange={e => {
                          setSearchUserContact(e.target.value);
                          setShowUserContactsDropdown(true);
                        }}
                        onFocus={() => setShowUserContactsDropdown(true)}
                        onBlur={() => setTimeout(() => setShowUserContactsDropdown(false), 200)}
                      />
                      
                      {showUserContactsDropdown && (
                        <div className="contacts-dropdown">
                          {contacts
                            .filter(c => c.name.toLowerCase().includes(searchUserContact.toLowerCase()) || c.id.includes(searchUserContact))
                            .map(contact => (
                              <div 
                                key={contact.id} 
                                className="contact-option"
                                onMouseDown={() => {
                                  const newState = {
                                    ...schedulerState,
                                    userRecipientId: contact.id,
                                    userRecipientName: contact.name,
                                    userRecipientType: (contact.isGroup ? 'group' : 'contact') as 'group' | 'contact'
                                  };
                                  setSchedulerState(newState);
                                  setIsSchedulerDirty(true);
                                  saveSchedulerDb(newState)
                                    .then(() => setIsSchedulerDirty(false))
                                    .catch(e => {
                                      console.error('Failed to auto-save:', e);
                                      setIsSchedulerDirty(false);
                                    });
                                  setSearchUserContact('');
                                  setShowUserContactsDropdown(false);
                                }}
                              >
                                <span>{contact.name}</span>
                                <span className="contact-option-type">{contact.isGroup ? 'Group' : 'Contact'}</span>
                              </div>
                            ))}
                            
                          {searchUserContact.trim() && (
                            <div 
                              className="contact-option"
                              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', color: 'var(--accent-cyan)' }}
                              onMouseDown={() => {
                                const inputVal = searchUserContact.trim();
                                const isGroup = inputVal.endsWith('@g.us') || inputVal.includes('-');
                                const newState = {
                                  ...schedulerState,
                                  userRecipientId: inputVal,
                                  userRecipientName: inputVal.split('@')[0],
                                  userRecipientType: (isGroup ? 'group' : 'contact') as 'group' | 'contact'
                                };
                                setSchedulerState(newState);
                                setIsSchedulerDirty(true);
                                saveSchedulerDb(newState)
                                  .then(() => setIsSchedulerDirty(false))
                                  .catch(e => {
                                    console.error('Failed to auto-save:', e);
                                    setIsSchedulerDirty(false);
                                  });
                                setSearchUserContact('');
                                setShowUserContactsDropdown(false);
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>➕ Use manual ID:</span>
                                <strong style={{ fontFamily: 'var(--font-mono)' }}>{searchUserContact}</strong>
                              </span>
                              <span className="contact-option-type" style={{ color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.15)' }}>Manual</span>
                            </div>
                          )}

                          {contacts.filter(c => c.name.toLowerCase().includes(searchUserContact.toLowerCase()) || c.id.includes(searchUserContact)).length === 0 && !searchUserContact.trim() && (
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
                  style={{ flex: 1, padding: '0.6rem 0.5rem', fontSize: '0.8rem', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                  onClick={() => handleSendTestMessage('myself')}
                  disabled={testSendStatus.status === 'sending' || whatsappState.status !== 'ready' || !schedulerState.userRecipientId}
                >
                  {testSendStatus.status === 'sending' ? 'Sending...' : 'Test Myself'}
                </button>
                
                <button 
                  className="btn-secondary" 
                  style={{ flex: 1, padding: '0.6rem 0.5rem', fontSize: '0.8rem', border: '1px solid var(--accent-purple)' }}
                  onClick={() => handleSendTestMessage('cook')}
                  disabled={testSendStatus.status === 'sending' || whatsappState.status !== 'ready' || !schedulerState.recipientId}
                >
                  {testSendStatus.status === 'sending' ? 'Sending...' : 'Test Cook'}
                </button>
              </div>

              {!schedulerState.recipientId && !schedulerState.userRecipientId && whatsappState.status === 'ready' && (
                <div style={{ 
                  marginTop: '1rem', 
                  fontSize: '0.8rem', 
                  padding: '0.5rem 0.75rem', 
                  borderRadius: '6px',
                  color: 'var(--accent-rose)',
                  background: 'rgba(244, 63, 94, 0.08)',
                  border: '1px solid rgba(244, 63, 94, 0.15)'
                }}>
                  ⚠️ Select at least one recipient (Cook or Myself) above to enable test sending.
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
      className={`cook-copy-btn ${copied ? 'copied' : ''}`} 
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Day
        </>
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
