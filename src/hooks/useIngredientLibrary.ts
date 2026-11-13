'use client';
import { useState } from 'react';
import { IngredientEntry, IngredientEntryInput } from '@/lib/types';

/** The form's fields; a caller adding one alias to a row sends them as a list. */
export type LibrarySaveInput = Omit<IngredientEntryInput, 'aliases'> & { aliases: string | string[] };

export type LibraryMutationResult = { ok: true } | { ok: false; error: string };

/**
 * The ingredient library against /api/ingredients.
 *
 * Unlike the Diet Builder, a library edit is saved the moment it is made: the
 * rows live in their own collection, and generation, verification and the
 * WhatsApp worker all read them from the database, never from this tab.
 *
 * `entries` stays null until the first load succeeds, so callers can tell
 * "nothing loaded yet" from "an empty library" and hold off compiling prompts.
 *
 * @param onChanged Runs after any saved change. Every plan's "is it still
 *   current" answer depends on the rows it used, so the caller refreshes those.
 */
export function useIngredientLibrary(onChanged: () => void) {
  const [entries, setEntries] = useState<IngredientEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/ingredients', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.entries)) {
        throw new Error(data.error || `Unexpected response (${res.status})`);
      }
      setEntries(data.entries);
      setLoadError('');
      return true;
    } catch (e) {
      // The server's own wording ("Internal server error") says nothing useful
      // on screen; keep it for the console.
      console.error('Error loading ingredient library:', e);
      setLoadError('The ingredient library could not be loaded.');
      return false;
    }
  };

  const mutate = async (request: () => Promise<Response>): Promise<LibraryMutationResult> => {
    try {
      const res = await request();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'The change could not be saved.' };
      // Re-read rather than patch locally: the server owns the row order.
      await load();
      onChanged();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'The change could not be saved.' };
    }
  };

  /** Create a row, or replace the one with `id`. */
  const save = (input: LibrarySaveInput, id?: string) => mutate(() =>
    fetch('/api/ingredients', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { ...input, id } : input)
    })
  );

  const remove = (id: string) => mutate(() =>
    fetch(`/api/ingredients?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  );

  return { entries, loadError, load, save, remove };
}

export type IngredientLibraryHook = ReturnType<typeof useIngredientLibrary>;
