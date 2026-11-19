'use client';
import { useEffect, useRef, useState } from 'react';

export interface CacheEntryStatus {
  generatedAt: string;
  isValid: boolean;
}

/**
 * Per-day cached diet plan status + CRUD against /api/cache — extracted from page.tsx.
 *
 * `onPlansReplaced` hears about days whose cached plan is a different plan
 * than the last status showed: a generation finished, or going back to an
 * earlier config restored the plan it had. Whatever the page shows for those
 * days was the old plan.
 */
export function useDietCache(
  isAuthenticated: boolean | null,
  onPlansReplaced?: (days: string[]) => void
) {
  const [cacheStatus, setCacheStatus] = useState<Record<string, CacheEntryStatus>>({});
  // The last status the server reported, to tell which days' plans changed.
  const lastStatusRef = useRef<Record<string, CacheEntryStatus> | null>(null);
  // Read through a ref, so a fetch started by an older render still reaches
  // the page's current handler.
  const onPlansReplacedRef = useRef(onPlansReplaced);
  useEffect(() => {
    onPlansReplacedRef.current = onPlansReplaced;
  });

  // Fetch cache status for all days
  const fetchCacheStatus = async () => {
    try {
      const res = await fetch('/api/cache');
      if (res.ok) {
        const data = await res.json();
        const statusMap: Record<string, CacheEntryStatus> = {};
        for (const entry of data.entries || []) {
          statusMap[entry.day] = { generatedAt: entry.generatedAt, isValid: entry.isValid };
        }
        const previous = lastStatusRef.current;
        lastStatusRef.current = statusMap;
        setCacheStatus(statusMap);

        const replaced = previous
          ? Object.keys(statusMap).filter(day => statusMap[day].isValid
            && previous[day]
            && previous[day].generatedAt !== statusMap[day].generatedAt)
          : [];
        if (replaced.length > 0) onPlansReplacedRef.current?.(replaced);
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
      if (lastStatusRef.current) {
        const next = { ...lastStatusRef.current };
        for (const d of day ? [day] : Object.keys(next)) delete next[d];
        lastStatusRef.current = next;
      }
      setCacheStatus(prev => {
        if (day) {
          const next = { ...prev };
          delete next[day];
          return next;
        }
        return {};
      });
    } catch (e) {
      console.error('Error clearing cache:', e);
    }
  };

  // Fetch cache status on mount & after auth
  useEffect(() => {
    if (isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchCacheStatus();
    }
  }, [isAuthenticated]);

  return {
    cacheStatus,
    fetchCacheStatus,
    checkCache,
    saveToCache,
    clearCache
  };
}

export type DietCacheHook = ReturnType<typeof useDietCache>;
