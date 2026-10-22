'use client';
import { Dispatch, SetStateAction, useEffect, useState, useSyncExternalStore } from 'react';
import { Config } from '@/lib/types';
import { BuilderLocation, HistoryStep, NO_HISTORY, createBuilderHistory } from '@/lib/builder-history';

const getServerStatus = () => NO_HISTORY;

/**
 * Undo/redo for the Diet Builder (see lib/builder-history.ts). Every change to
 * the builder's fields is recorded, whatever made it. Undo and redo put a step
 * back and pass `showChange` where it lives, so the edited tab comes into view.
 *
 * The caller reports database round-trips: `load` after fetching the config,
 * `markSaved` after saving it, `clear` on logout.
 */
export function useBuilderHistory(
  config: Config,
  setConfig: Dispatch<SetStateAction<Config>>,
  showChange: (location: BuilderLocation) => void
) {
  const [history] = useState(createBuilderHistory);
  const { canUndo, canRedo } = useSyncExternalStore(history.subscribe, history.getStatus, getServerStatus);

  const { global: globalTargets, meals, dailyVariables } = config;
  useEffect(() => {
    history.record({ global: globalTargets, meals, dailyVariables });
  }, [history, globalTargets, meals, dailyVariables]);

  const apply = (step: HistoryStep | null) => {
    if (!step) return;
    setConfig(prev => ({ ...prev, ...step.snapshot }));
    if (step.location) showChange(step.location);
  };

  return {
    canUndo,
    canRedo,
    undo: () => apply(history.undo()),
    redo: () => apply(history.redo()),
    load: history.load,
    markSaved: history.markSaved,
    clear: history.clear
  };
}
