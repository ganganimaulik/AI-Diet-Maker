'use client';
import { useState, useEffect, useRef } from 'react';
import { compilePromptText } from '@/lib/compile-prompt';
import { Config, DayOutput, DayProgress, GenerationJob, DEFAULT_CONFIG, normalizeConfig, stableStringify, DAYS_OF_WEEK } from '@/lib/types';
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

const JOB_POLL_INTERVAL_MS = 3000;

const isActiveJob = (job: GenerationJob) => job.status === 'queued' || job.status === 'running';

const normalizeGenerationJob = (value: unknown): GenerationJob | null => {
  if (!value || typeof value !== 'object') return null;
  const job = value as Partial<GenerationJob>;
  if (
    typeof job.jobId !== 'string' ||
    typeof job.day !== 'string' ||
    !job.jobId ||
    !DAYS_OF_WEEK.includes(job.day) ||
    !['queued', 'running', 'completed', 'failed'].includes(job.status || '')
  ) {
    return null;
  }

  return {
    jobId: job.jobId,
    day: job.day,
    status: job.status as GenerationJob['status'],
    responseText: typeof job.responseText === 'string' ? job.responseText : '',
    thinkingText: typeof job.thinkingText === 'string' ? job.thinkingText : '',
    error: typeof job.error === 'string' ? job.error : '',
    cacheable: job.cacheable !== false,
    isCurrentConfig: job.isCurrentConfig !== false
  };
};

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
  const dayOutputsRef = useRef<Record<string, DayOutput>>({});
  const selectedDayRef = useRef('MONDAY');
  const pollingJobsRef = useRef<Record<string, { jobId: string; promise: Promise<GenerationJob>; presentOnCompletion: boolean }>>({});
  const activeJobIdsRef = useRef<Record<string, string>>({});
  const presentedJobIdsRef = useRef(new Set<string>());
  const finalizedJobIdsRef = useRef(new Set<string>());
  const batchDaysRef = useRef(new Set<string>());
  const hasRestoredJobsRef = useRef(false);
  const isPageActiveRef = useRef(true);
  const pollingEpochRef = useRef(0);

  const markDayProgress = (day: string, status: DayProgress) => {
    dayProgressRef.current = { ...dayProgressRef.current, [day]: status };
    setDayProgress(prev => ({ ...prev, [day]: status }));
  };

  const setDayOutput = (day: string, text: string, thinking: string, isCached: boolean) => {
    dayOutputsRef.current = { ...dayOutputsRef.current, [day]: { text, thinking, isCached } };
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
    return status === 'checking' || status === 'queued' || status === 'generating';
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
      throw e;
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
      selectedDayRef.current = normalized.selectedGenerationDay || 'MONDAY';
      setConfig(normalized);
      setSavedConfig(normalized);
    } else {
      // First time setup, save default config to DB
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_CONFIG)
      });
      selectedDayRef.current = DEFAULT_CONFIG.selectedGenerationDay || 'MONDAY';
      setConfig(DEFAULT_CONFIG);
      setSavedConfig(DEFAULT_CONFIG);
    }
    whatsapp.fetchWhatsAppStatus();
    whatsapp.fetchContacts();
  };

  // Check login and fetch config on mount
  useEffect(() => {
    isPageActiveRef.current = true;
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
    return () => {
      isPageActiveRef.current = false;
    };
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
      hasRestoredJobsRef.current = false;
      pollingEpochRef.current += 1;
      pollingJobsRef.current = {};
      activeJobIdsRef.current = {};
      batchDaysRef.current.clear();
      dayProgressRef.current = {};
      setDayProgress({});
      setIsBatchGenerating(false);
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

  const finishBatchDay = (day: string) => {
    if (!batchDaysRef.current.delete(day)) return;
    setIsBatchGenerating(batchDaysRef.current.size > 0);
  };

  const presentGenerationJob = (job: GenerationJob) => {
    if (presentedJobIdsRef.current.has(job.jobId)) return;
    presentedJobIdsRef.current.add(job.jobId);
    selectedDayRef.current = job.day;
    setConfig(prev => prev.selectedGenerationDay === job.day
      ? prev
      : { ...prev, selectedGenerationDay: job.day });
    setCurrentView('planner');
    setLayoutMode('results');
  };

  const applyGenerationJob = (job: GenerationJob, present = false) => {
    const day = job.day;
    const previousOutput = dayOutputsRef.current[day];
    const hadText = !!previousOutput?.text;
    const hadThinking = !!previousOutput?.thinking;

    // In-flight progress is always shown — a running job is real regardless of
    // whether the config drifted after it was queued. isCurrentConfig only
    // decides whether a *terminal* result is trusted/cached, not whether an
    // active generation is visible.
    if (isActiveJob(job)) {
      const hasPartial = !!(job.responseText || job.thinkingText);
      if (hasPartial) {
        setDayOutputs(prev => {
          const nextOutput: DayOutput = {
            text: job.responseText,
            thinking: job.thinkingText,
            isCached: false
          };
          const existing = prev[day];
          if (existing?.text === nextOutput.text && existing?.thinking === nextOutput.thinking && !existing.isCached) {
            return prev;
          }
          const next = { ...prev, [day]: nextOutput };
          dayOutputsRef.current = next;
          return next;
        });
      }
      activeJobIdsRef.current[day] = job.jobId;
      markDayProgress(day, job.status === 'queued' ? 'queued' : 'generating');
      setDayErrors(prev => prev[day] ? { ...prev, [day]: '' } : prev);
    } else {
      if (activeJobIdsRef.current[day] === job.jobId) {
        delete activeJobIdsRef.current[day];
      }

      // A stale finished job neither overwrites a newer cached output nor gets
      // surfaced as that day's plan — the config moved on after it was queued.
      if (!job.isCurrentConfig) {
        return;
      }

      const hasOutput = !!(job.responseText || job.thinkingText);
      if (hasOutput || job.status === 'completed') {
        setDayOutputs(prev => {
          const nextOutput: DayOutput = {
            text: job.responseText,
            thinking: job.thinkingText,
            isCached: job.status === 'completed' && job.cacheable
          };
          const existing = prev[day];
          if (
            existing?.text === nextOutput.text &&
            existing?.thinking === nextOutput.thinking &&
            existing?.isCached === nextOutput.isCached
          ) {
            return prev;
          }
          const next = { ...prev, [day]: nextOutput };
          dayOutputsRef.current = next;
          return next;
        });
      }

      if (job.status === 'completed' && job.responseText) {
        markDayProgress(day, 'done');
        setDayErrors(prev => prev[day] ? { ...prev, [day]: '' } : prev);
        if (job.cacheable && !finalizedJobIdsRef.current.has(job.jobId)) {
          finalizedJobIdsRef.current.add(job.jobId);
          void fetchCacheStatus();
        }
      } else {
        markDayProgress(day, 'error');
        setDayErrors(prev => ({
          ...prev,
          [day]: job.error || 'The model returned an empty response.'
        }));
      }
    }

    // Auto-select the tab only on initial transitions or explicit presentation,
    // never yank the user away from their manual tab selection during polling.
    if (selectedDayRef.current === day) {
      if (present) {
        if (job.responseText) {
          setOutputTab('user');
        } else if (job.thinkingText) {
          setOutputTab('thoughts');
        }
      } else if (!hadText && job.responseText) {
        // Plan text first became available: switch to plan view
        setOutputTab('user');
      } else if (!hadThinking && job.thinkingText && !job.responseText) {
        // Thinking first began: switch to thoughts view
        setOutputTab('thoughts');
      }
    }

    if (present) presentGenerationJob(job);
  };

  const fetchGenerationJob = async (day: string): Promise<GenerationJob | null> => {
    const res = await fetch(`/api/generate?day=${encodeURIComponent(day)}`, {
      cache: 'no-store'
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error = data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Unable to check generation status (${res.status}).`;
      throw new Error(error);
    }
    if (!data || typeof data !== 'object' || !('job' in data)) return null;
    return normalizeGenerationJob((data as { job: unknown }).job);
  };

  const trackGenerationJob = (
    initialJob: GenerationJob,
    presentOnCompletion = false
  ): Promise<GenerationJob> => {
    applyGenerationJob(initialJob, presentOnCompletion && !isActiveJob(initialJob));
    if (!isActiveJob(initialJob)) return Promise.resolve(initialJob);

    const existing = pollingJobsRef.current[initialJob.day];
    if (existing && existing.jobId === initialJob.jobId) {
      existing.presentOnCompletion ||= presentOnCompletion;
      return existing.promise;
    }

    const day = initialJob.day;
    const epoch = pollingEpochRef.current;
    const entry = {
      jobId: initialJob.jobId,
      promise: Promise.resolve(initialJob),
      presentOnCompletion
    };

    entry.promise = (async () => {
      let latestJob = initialJob;
      try {
        while (isActiveJob(latestJob)) {
          await new Promise(resolve => window.setTimeout(resolve, JOB_POLL_INTERVAL_MS));
          if (!isPageActiveRef.current || pollingEpochRef.current !== epoch) return latestJob;

          let polledJob: GenerationJob | null = null;
          try {
            polledJob = await fetchGenerationJob(day);
          } catch (error) {
            // A transient network failure must not turn a still-running durable
            // server job into a client-side generation failure.
            console.warn(`Unable to poll generation job for ${day}; retrying.`, error);
            continue;
          }

          if (!polledJob) continue;

          // Keep tracking an active job even if the config drifted after it was
          // queued: the run still completes server-side, and whether its result
          // is surfaced is decided on completion (applyGenerationJob), not here.
          latestJob = polledJob;
          entry.jobId = polledJob.jobId;
          applyGenerationJob(
            polledJob,
            entry.presentOnCompletion && !isActiveJob(polledJob)
          );
        }
        return latestJob;
      } finally {
        if (pollingJobsRef.current[day] === entry) {
          delete pollingJobsRef.current[day];
        }
        if (!isActiveJob(latestJob)) finishBatchDay(day);
      }
    })();

    pollingJobsRef.current[day] = entry;
    return entry.promise;
  };

  const restoreGenerationJobs = async () => {
    try {
      const res = await fetch('/api/generate', { cache: 'no-store' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== 'object') return;

      const rawJobs = 'jobs' in data && Array.isArray((data as { jobs: unknown }).jobs)
        ? (data as { jobs: unknown[] }).jobs
        : 'job' in data
          ? [(data as { job: unknown }).job]
          : [];
      // Keep every well-formed job that is still active — an in-flight
      // generation is always worth showing — but only surface a terminal job's
      // result when it was produced against the current config. A stale
      // completed/failed job is left for the cache layer to adjudicate.
      const jobs = rawJobs
        .map(normalizeGenerationJob)
        .filter((job): job is GenerationJob => !!job)
        .filter(job => isActiveJob(job) || job.isCurrentConfig);

      // GET returns newest jobs first. Keep one current job per day, except
      // that a job already being tracked by this tab wins over a stale list row.
      const jobsByDay = new Map<string, GenerationJob>();
      for (const job of jobs) {
        const existing = jobsByDay.get(job.day);
        const trackedId = activeJobIdsRef.current[job.day];
        if (!existing || job.jobId === trackedId) jobsByDay.set(job.day, job);
      }
      const currentJobs = [...jobsByDay.values()];
      if (currentJobs.length === 0) return;

      const activeJobs = currentJobs.filter(isActiveJob);
      if (batchDaysRef.current.size === 0 && activeJobs.length > 1) {
        activeJobs.forEach(job => batchDaysRef.current.add(job.day));
        setIsBatchGenerating(true);
      }

      const unpresentedJobs = currentJobs.filter(job => !presentedJobIdsRef.current.has(job.jobId));
      const jobToPresent = unpresentedJobs.find(job => job.day === selectedDayRef.current)
        || unpresentedJobs.find(job => job.status === 'completed' && !!job.responseText)
        || unpresentedJobs.find(isActiveJob)
        || unpresentedJobs[0];

      for (const job of currentJobs) {
        applyGenerationJob(job, job === jobToPresent);
        if (isActiveJob(job)) {
          void trackGenerationJob(job, job === jobToPresent).catch(error => {
            console.error(`Error tracking restored generation for ${job.day}:`, error);
          });
        }
      }
    } catch (error) {
      console.error('Error restoring generation jobs:', error);
    }
  };

  // Restore durable jobs after the authenticated config has loaded, and do
  // another reconciliation as soon as a backgrounded tab becomes visible.
  useEffect(() => {
    if (isAuthenticatedState !== true || !savedConfig) return;
    if (!hasRestoredJobsRef.current) {
      hasRestoredJobsRef.current = true;
      void restoreGenerationJobs();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void restoreGenerationJobs();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticatedState, savedConfig]);

  // Run AI Generation for one day. The target day is pinned when the request
  // starts, so a second day can be launched while this one is still running.
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
          enterpriseServiceAccountJson: cfg.enterpriseServiceAccountJson,
          day,
          cacheable: !useCustomPrompt
        })
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMessage = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Server responded with an error.';
        throw new Error(errorMessage);
      }

      const job = data && typeof data === 'object' && 'job' in data
        ? normalizeGenerationJob((data as { job: unknown }).job)
        : null;
      if (!job) throw new Error('Server did not return a valid generation job.');

      await trackGenerationJob(job, true);

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
    daysToRun.forEach(day => batchDaysRef.current.add(day));
    daysToRun.forEach(day => markDayProgress(day, 'queued'));
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
            enterpriseServiceAccountJson: config.enterpriseServiceAccountJson,
            day,
            cacheable: true
          })
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const errorMessage = data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : `Failed generation for ${day}`;
          throw new Error(errorMessage);
        }

        const job = data && typeof data === 'object' && 'job' in data
          ? normalizeGenerationJob((data as { job: unknown }).job)
          : null;
        if (!job) throw new Error(`Server did not return a valid generation job for ${day}.`);

        await trackGenerationJob(job);
      } catch (err) {
        console.error(`Error generating ${day}:`, err);
        setDayErrors(prev => ({
          ...prev,
          [day]: err instanceof Error && err.message ? err.message : `Failed to generate ${day}.`
        }));
        markDayProgress(day, 'error');
      } finally {
        finishBatchDay(day);
      }
    });

    await Promise.all(promises);
    batchDaysRef.current.clear();
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
            provider={config.provider}
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
