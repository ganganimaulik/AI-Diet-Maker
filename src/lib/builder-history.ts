// Undo/redo history for the Diet Builder, kept in localStorage so it survives
// a page refresh.
import { Config, DAYS_OF_WEEK } from '@/lib/types';

/** The part of the config the Diet Builder edits — all an undo ever restores. */
export type BuilderSnapshot = Pick<Config, 'global' | 'meals' | 'dailyVariables'>;

/** The builder tab (and day, for daily variables) that shows a step's change. */
export interface BuilderLocation {
  tab: string;
  day?: string;
}

/** What one undo or redo puts back, and where to look at it. */
export interface HistoryStep {
  snapshot: BuilderSnapshot;
  location: BuilderLocation | null;
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
}

export const NO_HISTORY: HistoryStatus = { canUndo: false, canRedo: false };

const STORAGE_KEY = 'diet-maker:builder-history';
const STORAGE_VERSION = 1;
// Every step is a whole builder snapshot (about 10 KB), so the oldest fall off.
const MAX_STEPS = 100;
// Edits to the same ingredient, meal or targets this close together are one step.
const TYPING_STEP_MS = 1000;

interface Entry {
  snapshot: BuilderSnapshot;
  key: string;
}

export const toBuilderSnapshot = (config: Config): BuilderSnapshot => ({
  global: config.global,
  meals: config.meals,
  dailyVariables: config.dailyVariables
});

/**
 * JSON with sorted keys and without empty values. `''`, `false` and a missing
 * field all mean the same to the prompt, and the database fills those defaults
 * in on save, so a reloaded config still matches the step it was saved from.
 */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) => {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const kept = Object.keys(inner).sort()
      .filter(key => inner[key] !== '' && inner[key] !== false && inner[key] != null);
    return Object.fromEntries(kept.map(key => [key, inner[key]]));
  });

// Collects the path of every object holding a changed value (".meals.2",
// ".meals.2.ingredients.0", ".global"). False when an array grew or shrank.
const collectChangedOwners = (a: unknown, b: unknown, path: string, owners: Set<string>): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    owners.add(path.slice(0, path.lastIndexOf('.')));
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .every(key => collectChangedOwners(left[key], right[key], `${path}.${key}`, owners));
};

/**
 * The one ingredient, meal or targets block an edit touched, so a run of
 * keystrokes in it can share an undo step. Null for anything wider: an add,
 * delete, reorder or day swap is always a step of its own.
 */
const editedOwner = (from: BuilderSnapshot, to: BuilderSnapshot): string | null => {
  const owners = new Set<string>();
  return collectChangedOwners(from, to, '', owners) && owners.size === 1 ? [...owners][0] : null;
};

/** The tab that shows how `to` differs from `from`, or null for a pure reorder. */
const locateChange = (from: BuilderSnapshot, to: BuilderSnapshot): BuilderLocation | null => {
  const mealsBefore = new Map(from.meals.map(m => [m.id, canonicalJson(m)] as const));
  // A meal that changed or came back opens on its own tab...
  const meal = to.meals.find(m => mealsBefore.get(m.id) !== canonicalJson(m));
  if (meal) return { tab: meal.id };
  // ...while one that went away leaves no tab to open.
  if (to.meals.length < from.meals.length) return { tab: 'global' };
  const day = DAYS_OF_WEEK.find(d =>
    canonicalJson(from.dailyVariables[d] || []) !== canonicalJson(to.dailyVariables[d] || []));
  if (day) return { tab: 'daily', day };
  return canonicalJson(from.global) !== canonicalJson(to.global) ? { tab: 'global' } : null;
};

// Stored steps are applied straight to the builder, so anything that would
// break rendering is dropped rather than restored.
const isIngredientList = (value: unknown): boolean =>
  Array.isArray(value) && value.every(ing => typeof ing?.name === 'string');

const isSnapshot = (value: unknown): value is BuilderSnapshot => {
  const snapshot = value as Partial<BuilderSnapshot> | null;
  return !!snapshot?.global && typeof snapshot.global === 'object'
    && Array.isArray(snapshot.meals)
    && snapshot.meals.every(m => typeof m?.id === 'string' && isIngredientList(m.ingredients))
    && !!snapshot.dailyVariables && typeof snapshot.dailyVariables === 'object'
    && Object.values(snapshot.dailyVariables).every(isIngredientList);
};

/** Stored steps, oldest first; the last one is the state this browser last saw saved. */
const readStoredHistory = (): BuilderSnapshot[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return stored?.v === STORAGE_VERSION && Array.isArray(stored.entries) && stored.entries.every(isSnapshot)
      ? stored.entries
      : [];
  } catch {
    return [];
  }
};

const writeStoredHistory = (snapshots: BuilderSnapshot[]) => {
  // Past the storage quota, keep the newest steps rather than none.
  for (let start = 0; start < snapshots.length; start += Math.ceil((snapshots.length - start) / 2)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, entries: snapshots.slice(start) }));
      return;
    } catch {
      // retry without the older half
    }
  }
};

/**
 * A step is a snapshot of the builder's own fields — never API keys or the
 * day on screen — taken whenever those fields change; typing in one field
 * makes a single step rather than one per keystroke.
 *
 * A refresh reloads the saved config and drops unsaved edits (see page.tsx),
 * so only the steps up to the last save are stored. After a reload, Undo steps
 * back from the saved state and there is nothing to redo.
 */
export function createBuilderHistory() {
  let entries: Entry[] = [];
  let index = -1;
  // The step the database holds; -1 once an edit after undoing past it cuts it off.
  let savedIndex = -1;
  // The block the newest step is still gathering keystrokes for.
  let typing: { owner: string; at: number } | null = null;
  let status = NO_HISTORY;
  const listeners = new Set<() => void>();

  const entryFor = (snapshot: BuilderSnapshot): Entry => ({ snapshot, key: canonicalJson(snapshot) });

  const publish = () => {
    const canUndo = index > 0;
    const canRedo = index < entries.length - 1;
    if (canUndo === status.canUndo && canRedo === status.canRedo) return;
    status = { canUndo, canRedo };
    listeners.forEach(listener => listener());
  };

  const persist = () => {
    if (savedIndex >= 0) writeStoredHistory(entries.slice(0, savedIndex + 1).map(entry => entry.snapshot));
  };

  const trim = () => {
    const excess = entries.length - MAX_STEPS;
    if (excess <= 0) return;
    entries = entries.slice(excess);
    index -= excess;
    savedIndex = savedIndex >= excess ? savedIndex - excess : -1;
  };

  const moveTo = (target: number): HistoryStep | null => {
    if (target < 0 || target >= entries.length) return null;
    const from = entries[index].snapshot;
    index = target;
    typing = null;
    publish();
    const { snapshot } = entries[target];
    return { snapshot, location: locateChange(from, snapshot) };
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    getStatus: () => status,

    /** Picks the history back up for a config just loaded from the database. */
    load(config: Config) {
      const loaded = entryFor(toBuilderSnapshot(config));
      const kept = readStoredHistory().map(entryFor);
      // The stored steps end at this browser's last save. If the database has
      // moved on since (another tab or device), its state becomes a new step.
      if (kept[kept.length - 1]?.key === loaded.key) kept.pop();
      entries = [...kept, loaded].slice(-MAX_STEPS);
      index = savedIndex = entries.length - 1;
      typing = null;
      persist();
      publish();
    },

    /** Records the builder as it is now; called after every change to its fields. */
    record(snapshot: BuilderSnapshot) {
      if (index < 0) return;
      const next = entryFor(snapshot);
      const present = entries[index];
      if (next.key === present.key) return;

      const owner = editedOwner(present.snapshot, snapshot);
      const now = Date.now();
      if (owner && typing?.owner === owner && now - typing.at < TYPING_STEP_MS) {
        entries[index] = next;
        typing.at = now;
        // Typed back to how the step began: drop it rather than keep a no-op.
        if (entries[index - 1].key === next.key) {
          entries.pop();
          index--;
          typing = null;
        }
      } else {
        entries = [...entries.slice(0, index + 1), next];
        if (savedIndex > index) savedIndex = -1;
        index++;
        typing = owner ? { owner, at: now } : null;
        trim();
      }
      publish();
    },

    /** Notes that the database now holds `config`. */
    markSaved(config: Config) {
      if (index < 0) return;
      const saved = entryFor(toBuilderSnapshot(config));
      if (entries[index].key === saved.key) {
        savedIndex = index;
      } else if (entries[savedIndex]?.key !== saved.key) {
        savedIndex = entries.map(entry => entry.key).lastIndexOf(saved.key, index);
        // Typing while the save was in flight folded the saved state into the
        // newest step; split it back out so the history still passes through it.
        if (savedIndex < 0) {
          entries.splice(index, 0, saved);
          savedIndex = index++;
          trim();
        }
      }
      // The next edit starts a fresh step, so the saved state stays reachable.
      typing = null;
      persist();
      publish();
    },

    undo: () => moveTo(index - 1),

    redo: () => moveTo(index + 1),

    /** Forgets the history here and in the browser's storage (on logout). */
    clear() {
      entries = [];
      index = savedIndex = -1;
      typing = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage is unavailable, so nothing was kept there
      }
      publish();
    }
  };
}
