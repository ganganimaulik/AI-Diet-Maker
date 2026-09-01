/**
 * TypeScript wrapper around the shared verify-plan.js module.
 * The verification logic lives in verify-plan.js so it can also be used
 * by whatsapp-worker.js via CommonJS require().
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const verifier = require('./verify-plan.js');

export type VerificationSeverity = 'error' | 'warning';

export type VerificationCategory =
  | 'calories'
  | 'macros'
  | 'sodium'
  | 'weights'
  | 'cook'
  | 'format'
  | 'reference';

export interface VerificationIssue {
  severity: VerificationSeverity;
  category: VerificationCategory;
  message: string;
}

export interface VerificationTotals {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sodium: number | null;
  potassium: number | null;
  ratio: number | null;
  /** Computed side only. */
  saltGrams?: number;
  inIdealRange?: boolean | null;
  /** Stated side only — the plan's own "Ideal / Above Ideal" call. */
  verdict?: string | null;
}

export interface VerificationFeasibility {
  calorieTargetReachable: boolean;
  bestRatio: number | null;
  ratioReachable: boolean;
  extraPotassiumNeededMg?: number;
  saltReductionNeededG?: number;
}

export interface PlanVerification {
  day: string;
  ok: boolean;
  checkedAt: string;
  issues: VerificationIssue[];
  errorCount: number;
  warningCount: number;
  computed: VerificationTotals | null;
  stated: VerificationTotals | null;
  target?: number;
  feasibility: VerificationFeasibility | null;
}

/** Re-derive one day's plan from the config it was generated from. */
export const verifyPlan: (
  config: unknown,
  day: string,
  planText: string
) => PlanVerification = verifier.verifyPlan;

/** Lowest Na:K ratio any plan for this day could reach at the calorie target. */
export const computeFeasibility: (
  config: unknown,
  day: string
) => VerificationFeasibility | null = verifier.computeFeasibility;
