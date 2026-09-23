/**
 * TypeScript wrapper around the shared build-plan.js module.
 * The builder lives in build-plan.js so whatsapp-worker.js can require() it
 * for scheduled sends without a build step.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const builder = require('./build-plan.js');

/** How the AUTO weights were allocated for a day. */
export type PlanAllocationStrategy =
  | 'even-split'
  | 'ratio-steered'
  | 'closest-ratio'
  | 'calorie-boundary';

export interface PlanOutcome {
  autoCount: number;
  fixedKcal: number;
  budget: number;
  /** False when no mix of this day's AUTO ingredients reaches the target. */
  calorieTargetReachable: boolean;
  /** False when the configured Na:K band is out of reach for this day. */
  ratioReachable: boolean;
  strategy: PlanAllocationStrategy;
  desiredRatio: number;
  plannedRatio: number | null;
}

export interface PlanTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  naturalSodium: number;
  saltSodium: number;
  sodium: number;
  potassium: number;
  saltGrams: number;
  ratio: number;
}

export interface BuiltPlan {
  /** Part 1 and Part 2, in the same document shape a model would produce. */
  text: string;
  /** The derivation, shown in the dashboard where the model's thoughts go. */
  thinking: string;
  totals: PlanTotals;
  outcome: PlanOutcome;
}

/** Bumped when the builder would produce a different plan for the same config. */
export const PLAN_BUILDER_VERSION: number = builder.PLAN_BUILDER_VERSION;

/** Thrown when a config cannot be solved without a model. */
export const PlanBuildError: new (message: string) => Error = builder.PlanBuildError;

/** Build one day's plan document deterministically — no provider call. */
export const buildPlan: (config: unknown, day: string) => BuiltPlan = builder.buildPlan;
