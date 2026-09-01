'use client';
import { useEffect, useState } from 'react';
import { DayVerification } from '@/lib/types';

// Verification runs one request per day so a slow AI review cannot stall the
// whole sweep, but firing all seven at a provider at once invites rate limits.
const MAX_PARALLEL_VERIFICATIONS = 3;

/**
 * Per-day plan verification state against /api/verify — the arithmetic checker
 * always runs server-side; the AI review is opt-in via settings.
 */
export function useVerification(isAuthenticated: boolean | null) {
  const [verifications, setVerifications] = useState<Record<string, DayVerification>>({});
  const [verifyingDays, setVerifyingDays] = useState<Record<string, boolean>>({});
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);

  const fetchVerifications = async () => {
    try {
      const res = await fetch('/api/verify');
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, DayVerification> = {};
      for (const result of data.results || []) map[result.day] = result;
      setVerifications(map);
    } catch (e) {
      console.error('Error fetching verification results:', e);
    }
  };

  /** Verify one day. `aiReview` overrides the saved setting when provided. */
  const verifyDay = async (day: string, aiReview?: boolean): Promise<DayVerification | null> => {
    setVerifyingDays(prev => ({ ...prev, [day]: true }));
    setVerifyErrors(prev => {
      const next = { ...prev };
      delete next[day];
      return next;
    });

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiReview === undefined ? { day } : { day, aiReview })
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyErrors(prev => ({ ...prev, [day]: data.error || 'Verification failed.' }));
        return null;
      }
      setVerifications(prev => ({ ...prev, [day]: data.result }));
      return data.result as DayVerification;
    } catch (e) {
      setVerifyErrors(prev => ({ ...prev, [day]: e instanceof Error ? e.message : 'Verification failed.' }));
      return null;
    } finally {
      setVerifyingDays(prev => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
    }
  };

  /** Verify several days with a small worker pool. */
  const verifyDays = async (days: string[], aiReview?: boolean) => {
    if (days.length === 0) return;
    setIsVerifyingAll(true);
    try {
      const queue = [...days];
      const workers = Array.from(
        { length: Math.min(MAX_PARALLEL_VERIFICATIONS, queue.length) },
        async () => {
          for (let day = queue.shift(); day; day = queue.shift()) {
            await verifyDay(day, aiReview);
          }
        }
      );
      await Promise.all(workers);
    } finally {
      setIsVerifyingAll(false);
    }
  };

  const clearVerification = async (day?: string) => {
    try {
      await fetch(day ? `/api/verify?day=${day}` : '/api/verify', { method: 'DELETE' });
      setVerifications(prev => {
        if (!day) return {};
        const next = { ...prev };
        delete next[day];
        return next;
      });
    } catch (e) {
      console.error('Error clearing verification results:', e);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchVerifications();
    }
  }, [isAuthenticated]);

  return {
    verifications,
    verifyingDays,
    verifyErrors,
    isVerifyingAll,
    fetchVerifications,
    verifyDay,
    verifyDays,
    clearVerification
  };
}

export type VerificationHook = ReturnType<typeof useVerification>;
