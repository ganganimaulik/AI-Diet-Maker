'use client';
import { useState, useEffect, useRef } from 'react';
import { compilePromptText } from '@/lib/compile-prompt';
import { Config, DayOutput, DayProgress, DEFAULT_CONFIG, normalizeConfig, stableStringify, DAYS_OF_WEEK } from '@/lib/types';
import { useConfigActions } from '@/hooks/useConfigActions';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useDietCache } from '@/hooks/useDietCache';
import LoginScreen from '@/components/LoginScreen';
import AppHeader from '@/components/AppHeader';
import BuilderSidebar from '@/components/planner/BuilderSidebar';
import GlobalTargetsTab from '@/components/planner/GlobalTargetsTab';
import MealEditorTab from '@/components/planner/MealEditorTab';
import DailyVariablesTab from '@/components/planner/DailyVariablesTab';
import PromptTab from '@/components/planner/PromptTab';
import GenerationControls from '@/components/planner/GenerationControls';
import OutputPanel, { OutputTab } from '@/components/planner/OutputPanel';
import LayoutModeToggle, { LayoutMode } from '@/components/planner/LayoutModeToggle';
import ApiSettingsCard from '@/components/connections/ApiSettingsCard';
import WhatsAppConnectionCard from '@/components/connections/WhatsAppConnectionCard';
import HuggingFaceCard from '@/components/connections/HuggingFaceCard';
import SchedulerCard from '@/components/connections/SchedulerCard';
import SchedulerLogsCard from '@/components/connections/SchedulerLogsCard';

export default function Home() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [currentView, setCurrentView] = useState<'planner' | 'connections'>('planner');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('builder');
  const [activeTab, setActiveTab] = useState<string>('global');
  const [activeDay, setActiveDay] = useState<string>('MONDAY');

  // Custom prompt override state
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Output and generation states.
  // Progress, streamed output and errors are all keyed by day so several days
  // can generate at the same time without overwriting each other.
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [dayProgress, setDayProgress] = useState<Record<string, DayProgress>>({});
  const [dayOutputs, setDayOutputs] = useState<Record<string, DayOutput>>({});
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({});
  const [configErrorMsg, setConfigErrorMsg] = useState('');
  const [outputTab, setOutputTab] = useState<OutputTab>('user');

  // Mirrors of state that async generation closures need to read live
  const dayProgressRef = useRef<Record<string, DayProgress>>({});
  const selectedDayRef = useRef('MONDAY');

  const markDayProgress = (day: string, status: DayProgress) => {
    dayProgressRef.current = { ...dayProgressRef.current, [day]: status };
    setDayProgress(prev => ({ ...prev, [day]: status }));
  };

  const setDayOutput = (day: string, text: string, thinking: string, isCached: boolean) => {
    setDayOutputs(prev => ({ ...prev, [day]: { text, thinking, isCached } }));
  };

  const clearDayProgress = (day: string) => {
    const next = { ...dayProgressRef.current };
    delete next[day];
    dayProgressRef.current = next;
    setDayProgress(next);
  };

  const isDayBusy = (day: string) => {
    const status = dayProgressRef.current[day];
    return status === 'checking' || status === 'generating';
  };

  // Authentication and Save states
  const [isAuthenticatedState, setIsAuthenticatedState] = useState<boolean | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const hasUnsavedChanges = savedConfig
    ? stableStringify(config) !== stableStringify(savedConfig)
    : false;

  const cache = useDietCache(isAuthenticatedState);
  const {
    cacheStatus,
    fetchCacheStatus,
    checkCache,
    saveToCache,
    clearCache
  } = cache;

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

  const whatsapp = useWhatsApp({
    isAuthenticated: isAuthenticatedState,
    activeTab,
    currentView,
    config,
    saveConfig
  });

  const actions = useConfigActions(setConfig, setActiveTab);

  // Load config from the database into local state (shared by initial load & login)
  const loadConfig = async () => {
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
    whatsapp.fetchWhatsAppStatus();
    whatsapp.fetchContacts();
  };

  // Check login and fetch config on mount
  useEffect(() => {
    const checkAuthAndLoad = async () => {
      try {
        const authRes = await fetch('/api/auth/check');
        const authData = await authRes.json();

        if (authData.authenticated) {
          setIsAuthenticatedState(true);
          await loadConfig();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        await loadConfig();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
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

  const autoGeneratedPrompt = compilePromptText(config, { mode: 'single', selectedDay: config.selectedGenerationDay || 'MONDAY' });
  const activePrompt = isCustomMode ? customPrompt : autoGeneratedPrompt;

  // Initialize custom prompt if entering custom mode
  useEffect(() => {
    if (isCustomMode && !customPrompt) {
      setCustomPrompt(autoGeneratedPrompt);
    }
  }, [isCustomMode, autoGeneratedPrompt, customPrompt]);

  // Get the cache key for the current generation scope
  const getCurrentCacheDay = (): string => {
    return config.selectedGenerationDay || 'MONDAY';
  };

  // What the panel shows right now: the slot belonging to the selected day
  const currentDay = getCurrentCacheDay();
  const currentOutput = dayOutputs[currentDay];
  const outputText = currentOutput?.text || '';
  const thinkingText = currentOutput?.thinking || '';
  const isCachedResponse = !!currentOutput?.isCached;
  const isGenerating = dayProgress[currentDay] === 'generating';
  const isCacheLoading = dayProgress[currentDay] === 'checking';
  const errorMsg = dayErrors[currentDay] || configErrorMsg;

  // Keep the ref in sync so in-flight streams know which day is on screen
  useEffect(() => {
    selectedDayRef.current = currentDay;
  }, [currentDay]);

  // Clear cache for one day (or all days) and drop the matching on-screen
  // output. Days still generating keep their slot and progress.
  const handleClearCache = async (day?: string) => {
    await clearCache(day);

    setDayOutputs(prev => {
      const next = { ...prev };
      for (const d of day ? [day] : Object.keys(next)) {
        if (!isDayBusy(d)) delete next[d];
      }
      return next;
    });
    setDayErrors(prev => {
      const next = { ...prev };
      for (const d of day ? [day] : Object.keys(next)) delete next[d];
      return next;
    });

    const nextProgress: Record<string, DayProgress> = {};
    for (const [d, status] of Object.entries(dayProgressRef.current)) {
      if (isDayBusy(d) || (day && d !== day)) nextProgress[d] = status;
    }
    dayProgressRef.current = nextProgress;
    setDayProgress(nextProgress);
  };

  // Auto-load cached response when selected generation day changes.
  // A day that already holds output — loaded earlier or streaming right now —
  // keeps whatever is in its slot.
  useEffect(() => {
    if (!isMounted || isAuthenticatedState !== true) return;
    const day = config.selectedGenerationDay || 'MONDAY';
    if (dayOutputs[day] || isDayBusy(day)) return;

    let cancelled = false;
    const loadDayFromCache = async () => {
      const cached = await checkCache(day);
      if (cancelled || isDayBusy(day)) return;
      if (cached) {
        setDayOutput(day, cached.responseText, cached.thinkingText, true);
      }
    };
    loadDayFromCache();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.selectedGenerationDay, isMounted, isAuthenticatedState]);

  // Run AI Generation for one day. The target day is pinned when the request
  // starts, so a second day can be launched while this one is still streaming.
  // `targetDay` regenerates a day other than the selected one; `configOverride`
  // lets a caller that just changed the config generate against the new value
  // instead of the stale render closure.
  const handleGenerate = async (forceRegenerate = false, targetDay?: string, configOverride?: Config) => {
    const cfg = configOverride ?? config;
    const day = targetDay || cfg.selectedGenerationDay || 'MONDAY';
    if (isDayBusy(day)) return;

    if (layoutMode === 'builder') {
      setLayoutMode('results');
    }

    if (cfg.provider === 'fireworks') {
      if (!cfg.fireworksApiKey) {
        setConfigErrorMsg('Fireworks API Key is missing. Please enter your Fireworks API Key in Settings.');
        setCurrentView('connections');
        return;
      }
    } else if (cfg.provider === 'gemini-enterprise') {
      if (cfg.enterpriseAuthMethod === 'api-key' && !cfg.enterpriseApiKey) {
        setConfigErrorMsg('API Key is missing. Please enter your Agent Platform API Key in Settings.');
        setCurrentView('connections');
        return;
      }
      if (cfg.enterpriseAuthMethod === 'service-account' && !cfg.enterpriseServiceAccountJson) {
        setConfigErrorMsg('Service Account JSON is missing. Please enter your Service Account JSON in Settings.');
        setCurrentView('connections');
        return;
      }
      if (!cfg.enterpriseProjectId) {
        setConfigErrorMsg('GCP Project ID is missing. Please enter your GCP Project ID in Settings.');
        setCurrentView('connections');
        return;
      }
    } else {
      if (!cfg.apiKey) {
        setConfigErrorMsg('API Key is missing. Please enter your Gemini API Key in Settings.');
        setCurrentView('connections');
        return;
      }
    }

    // Claim the day before the first await so a double click can't start it twice
    markDayProgress(day, 'checking');
    setConfigErrorMsg('');
    setDayErrors(prev => ({ ...prev, [day]: '' }));

    // Auto-save config if there are unsaved changes so the config hash
    // in the database reflects the current state before cache validation
    const isDirty = savedConfig ? stableStringify(cfg) !== stableStringify(savedConfig) : false;
    if (isDirty) {
      try {
        await saveConfig(cfg);
      } catch {
        // saveConfig already shows an alert on failure; bail out
        clearDayProgress(day);
        return;
      }
    }

    // The hand-written prompt belongs to the day it was authored against, so
    // regenerating any other day falls back to the compiled prompt.
    const useCustomPrompt = isCustomMode && day === (config.selectedGenerationDay || 'MONDAY');

    // Compile for the pinned day — the user may switch days while this runs
    const dayPrompt = useCustomPrompt
      ? activePrompt
      : compilePromptText(cfg, { mode: 'single', selectedDay: day });

    // Check cache first (unless forcing regeneration)
    if (!forceRegenerate && !useCustomPrompt) {
      const cached = await checkCache(day);
      if (cached) {
        markDayProgress(day, 'done');
        setDayOutput(day, cached.responseText, cached.thinkingText, true);
        if (selectedDayRef.current === day) {
          setOutputTab('user');
        }
        return;
      }
    }

    markDayProgress(day, 'generating');
    setDayOutput(day, '', '', false);

    try {
      const selectedModel = cfg.model === 'custom' ? cfg.customModel : cfg.model;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'x-fireworks-api-key': cfg.fireworksApiKey || ''
        },
        body: JSON.stringify({
          prompt: dayPrompt,
          model: selectedModel,
          thinkingLevel: cfg.thinkingLevel,
          maxTokens: cfg.maxTokens || 0,
          reasoningEffort: cfg.reasoningEffort || 'default',
          provider: cfg.provider || 'google-ai-studio',
          fireworksApiKey: cfg.fireworksApiKey,
          enterpriseAuthMethod: cfg.enterpriseAuthMethod || 'api-key',
          enterpriseApiKey: cfg.enterpriseApiKey,
          enterpriseProjectId: cfg.enterpriseProjectId,
          enterpriseLocation: cfg.enterpriseLocation || 'global',
          enterpriseServiceAccountJson: cfg.enterpriseServiceAccountJson
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

      // Apply one parsed SSE event to this day's output slot
      const applyEvent = (parsed: { error?: string; thought?: string; text?: string }) => {
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        if (parsed.thought) {
          currentThought += parsed.thought;
          setDayOutput(day, currentText, currentThought, false);
          if (!hasSwitchedToThoughts) {
            hasSwitchedToThoughts = true;
            // Only steer the tab if this day is the one on screen
            if (selectedDayRef.current === day) {
              setOutputTab('thoughts');
            }
          }
        }
        if (parsed.text) {
          currentText += parsed.text;
          setDayOutput(day, currentText, currentThought, false);
          if (!hasSwitchedToUser) {
            hasSwitchedToUser = true;
            if (selectedDayRef.current === day) {
              setOutputTab('user');
            }
          }
        }
      };

      const processLine = (line: string, silent: boolean) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const dataStr = trimmed.slice(5).trim();
        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch (err) {
          if (!silent) console.error('Error parsing SSE line:', err);
          return;
        }
        applyEvent(parsed);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          processLine(line, false);
        }
      }

      processLine(buffer, true);

      if (!currentText) {
        throw new Error('The model returned an empty response.');
      }

      markDayProgress(day, 'done');

      // Save to cache after successful generation (only for non-custom prompts)
      if (!useCustomPrompt) {
        saveToCache(day, currentText, currentThought);
      }

    } catch (e) {
      console.error(e);
      setDayErrors(prev => ({
        ...prev,
        [day]: e instanceof Error && e.message ? e.message : 'An error occurred while connecting to the Gemini API.'
      }));
      markDayProgress(day, 'error');
      // Drop an empty slot so re-selecting the day re-checks the cache
      setDayOutputs(prev => {
        const existing = prev[day];
        if (!existing || existing.text || existing.thinking) return prev;
        const next = { ...prev };
        delete next[day];
        return next;
      });
    }
  };

  // Regenerate one specific day straight from the results view. The day is
  // brought on screen first so its stream is visible, and the config carrying
  // that selection is handed to handleGenerate so the auto-save writes it too.
  const handleRegenerateDay = (day: string) => {
    if (isDayBusy(day)) return;
    const nextConfig = { ...config, selectedGenerationDay: day };
    setConfig(nextConfig);
    selectedDayRef.current = day;
    handleGenerate(true, day, nextConfig);
  };

  // Parallel AI Generation for all 7 days
  const handleGenerateAllDays = async () => {
    if (isBatchGenerating) return;

    if (layoutMode === 'builder') {
      setLayoutMode('results');
    }

    if (config.provider === 'fireworks') {
      if (!config.fireworksApiKey) {
        setConfigErrorMsg('Fireworks API Key is missing. Please enter your Fireworks API Key in Settings.');
        setCurrentView('connections');
        return;
      }
    } else if (config.provider === 'gemini-enterprise') {
      if (config.enterpriseAuthMethod === 'api-key' && !config.enterpriseApiKey) {
        setConfigErrorMsg('API Key is missing. Please enter your Agent Platform API Key in Settings.');
        setCurrentView('connections');
        return;
      }
      if (config.enterpriseAuthMethod === 'service-account' && !config.enterpriseServiceAccountJson) {
        setConfigErrorMsg('Service Account JSON is missing. Please enter your Service Account JSON in Settings.');
        setCurrentView('connections');
        return;
      }
      if (!config.enterpriseProjectId) {
        setConfigErrorMsg('GCP Project ID is missing. Please enter your GCP Project ID in Settings.');
        setCurrentView('connections');
        return;
      }
    } else {
      if (!config.apiKey) {
        setConfigErrorMsg('API Key is missing. Please enter your Gemini API Key in Settings.');
        setCurrentView('connections');
        return;
      }
    }

    if (hasUnsavedChanges) {
      try {
        await saveConfig(config);
      } catch {
        return;
      }
    }

    setIsBatchGenerating(true);
    setConfigErrorMsg('');

    // A day already generating on its own keeps running; don't duplicate it
    const daysToRun = DAYS_OF_WEEK.filter(day => !isDayBusy(day));
    daysToRun.forEach(day => markDayProgress(day, 'generating'));
    setDayErrors(prev => {
      const next = { ...prev };
      daysToRun.forEach(day => { next[day] = ''; });
      return next;
    });

    const selectedModel = config.model === 'custom' ? config.customModel : config.model;

    const promises = daysToRun.map(async (day) => {
      try {
        // Check if a valid cached entry already exists for this day; if so, skip API call
        const cached = await checkCache(day);
        if (cached) {
          markDayProgress(day, 'done');
          setDayOutput(day, cached.responseText, cached.thinkingText, true);
          return;
        }

        const dayPrompt = compilePromptText(config, { mode: 'single', selectedDay: day });
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'x-fireworks-api-key': config.fireworksApiKey || ''
          },
          body: JSON.stringify({
            prompt: dayPrompt,
            model: selectedModel,
            thinkingLevel: config.thinkingLevel,
            maxTokens: config.maxTokens || 0,
            reasoningEffort: config.reasoningEffort || 'default',
            provider: config.provider || 'google-ai-studio',
            fireworksApiKey: config.fireworksApiKey,
            enterpriseAuthMethod: config.enterpriseAuthMethod || 'api-key',
            enterpriseApiKey: config.enterpriseApiKey,
            enterpriseProjectId: config.enterpriseProjectId,
            enterpriseLocation: config.enterpriseLocation || 'global',
            enterpriseServiceAccountJson: config.enterpriseServiceAccountJson
          })
        });

        if (!res.ok) {
          throw new Error(`Failed generation for ${day}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('Response body not readable');

        const decoder = new TextDecoder();
        let buffer = '';
        let dayText = '';
        let dayThought = '';
        let dayError = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());
              if (parsed.error) dayError = parsed.error;
              if (parsed.thought) dayThought += parsed.thought;
              if (parsed.text) dayText += parsed.text;
            } catch {}
          }
        }

        if (buffer.trim().startsWith('data:')) {
          try {
            const parsed = JSON.parse(buffer.trim().slice(5).trim());
            if (parsed.error) dayError = parsed.error;
            if (parsed.thought) dayThought += parsed.thought;
            if (parsed.text) dayText += parsed.text;
          } catch {}
        }

        // Surface the server's reason and keep a partial stream out of the cache.
        if (dayError) throw new Error(dayError);

        if (dayText) {
          await saveToCache(day, dayText, dayThought);
          markDayProgress(day, 'done');
          setDayOutput(day, dayText, dayThought, true);
        } else {
          setDayErrors(prev => ({ ...prev, [day]: 'The model returned an empty response.' }));
          markDayProgress(day, 'error');
        }
      } catch (err) {
        console.error(`Error generating ${day}:`, err);
        setDayErrors(prev => ({
          ...prev,
          [day]: err instanceof Error && err.message ? err.message : `Failed to generate ${day}.`
        }));
        markDayProgress(day, 'error');
      }
    });

    await Promise.all(promises);
    setIsBatchGenerating(false);
    await fetchCacheStatus();
  };

  if (isAuthenticatedState === null || !isMounted) {
    return (
      <div className="loading-container" style={{ minHeight: '100dvh' }}>
        <div className="spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>Checking credentials &amp; loading configuration...</p>
      </div>
    );
  }

  if (isAuthenticatedState === false) {
    return (
      <LoginScreen
        passwordInput={passwordInput}
        setPasswordInput={setPasswordInput}
        loginError={loginError}
        onSubmit={handleLogin}
      />
    );
  }

  const selectedMeal = (config.meals || []).find(m => m.id === activeTab);

  return (
    <div className="app-container">
      <AppHeader
        currentView={currentView}
        onSelectPlanner={() => {
          setCurrentView('planner');
          if (activeTab === 'whatsapp') {
            setActiveTab('global');
          }
        }}
        onSelectConnections={() => setCurrentView('connections')}
        whatsappState={whatsapp.whatsappState}
        config={config}
        onLogout={handleLogout}
      />

      {currentView === 'planner' ? (
        <>
        <LayoutModeToggle
          layoutMode={layoutMode}
          setLayoutMode={setLayoutMode}
          hasOutput={!!outputText}
        />

        <main className={`dashboard-grid layout-${layoutMode}`}>
          {/* Left Column: Configuration Panels */}
          <section className="glass-panel" style={{ display: layoutMode === 'results' ? 'none' : 'block' }}>
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
                <span className="save-config-bar__text">
                  ⚠️ You have unsaved changes
                </span>
                <button
                  className="btn-secondary"
                  disabled={isSavingConfig}
                  onClick={() => saveConfig()}
                >
                  {isSavingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            )}

            <div className="builder-layout">
              <BuilderSidebar
                meals={config.meals}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onAddMeal={actions.addNewMeal}
                onReorderMeals={actions.reorderMeals}
              />

              <div className="builder-content">
                {activeTab === 'global' && (
                  <GlobalTargetsTab config={config} actions={actions} />
                )}

                {selectedMeal && (
                  <MealEditorTab
                    meal={selectedMeal}
                    config={config}
                    canDelete={config.meals.length > 1}
                    actions={actions}
                  />
                )}

                {activeTab === 'daily' && (
                  <DailyVariablesTab
                    config={config}
                    activeDay={activeDay}
                    setActiveDay={setActiveDay}
                    actions={actions}
                  />
                )}

                {activeTab === 'prompt' && (
                  <PromptTab
                    activePrompt={activePrompt}
                    isCustomMode={isCustomMode}
                    setIsCustomMode={setIsCustomMode}
                    setCustomPrompt={setCustomPrompt}
                  />
                )}

                <GenerationControls
                  config={config}
                  setSelectedGenerationDay={(day) => setConfig(prev => ({ ...prev, selectedGenerationDay: day }))}
                  cacheStatus={cacheStatus}
                  currentCacheDay={getCurrentCacheDay()}
                  isGenerating={isGenerating}
                  isBatchGenerating={isBatchGenerating}
                  dayProgress={dayProgress}
                  isCacheLoading={isCacheLoading}
                  onGenerate={handleGenerate}
                  onGenerateAllDays={handleGenerateAllDays}
                  onClearCache={handleClearCache}
                />
              </div>
            </div>
          </section>

          {/* Right Column: AI Outputs */}
          <OutputPanel
            selectedDay={config.selectedGenerationDay || 'MONDAY'}
            onSelectDay={(day) => setConfig(prev => ({ ...prev, selectedGenerationDay: day }))}
            cacheStatus={cacheStatus}
            outputText={outputText}
            thinkingText={thinkingText}
            outputTab={outputTab}
            setOutputTab={setOutputTab}
            errorMsg={errorMsg}
            isGenerating={isGenerating}
            isBatchGenerating={isBatchGenerating}
            dayProgress={dayProgress}
            isCachedResponse={isCachedResponse}
            onGenerate={handleGenerate}
            onGenerateAllDays={handleGenerateAllDays}
            onRegenerateDay={handleRegenerateDay}
            hidden={layoutMode === 'builder'}
          />
        </main>
        </>
      ) : (
        <main className="settings-dashboard-grid animate-fadeIn">
          <ApiSettingsCard
            config={config}
            setConfig={setConfig}
            isSavingConfig={isSavingConfig}
            onSave={() => saveConfig()}
          />

          <div className="settings-column">
            <WhatsAppConnectionCard
              whatsappState={whatsapp.whatsappState}
              isResettingWhatsapp={whatsapp.isResettingWhatsapp}
              onReset={whatsapp.handleResetWhatsapp}
            />

            <HuggingFaceCard
              config={config}
              setConfig={setConfig}
              hfStatus={whatsapp.hfStatus}
              hfDetails={whatsapp.hfDetails}
              wakingUp={whatsapp.wakingUp}
              isSavingConfig={isSavingConfig}
              onSave={() => saveConfig()}
              onWakeUp={whatsapp.handleWakeUpSpace}
            />

            <SchedulerCard whatsapp={whatsapp} />

            <SchedulerLogsCard schedulerState={whatsapp.schedulerState} />
          </div>
        </main>
      )}

      <footer className="footer">
        <p>AI Diet Maker © 2026. Made with Google Gemini API.</p>
      </footer>
    </div>
  );
}
