'use client';
import { useEffect, useState } from 'react';

export interface CacheEntryStatus {
  generatedAt: string;
  isValid: boolean;
}

/**
 * Per-day cached diet plan status + CRUD against /api/cache — extracted from page.tsx.
 */
export function useDietCache(isAuthenticated: boolean | null) {
  const [cacheStatus, setCacheStatus] = useState<Record<string, CacheEntryStatus>>({});
  const [isCachedResponse, setIsCachedResponse] = useState(false);
  const [isCacheLoading, setIsCacheLoading] = useState(false);

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

  // Fetch cache status on mount & after auth
  useEffect(() => {
    if (isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchCacheStatus();
    }
  }, [isAuthenticated]);

  return {
    cacheStatus,
    isCachedResponse,
    setIsCachedResponse,
    isCacheLoading,
    setIsCacheLoading,
    fetchCacheStatus,
    checkCache,
    saveToCache,
    clearCache
  };
}

export type DietCacheHook = ReturnType<typeof useDietCache>;
