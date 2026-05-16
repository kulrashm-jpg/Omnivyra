export const LISTENING_MODES = [
  'manual_only',
  'daily',
  'alternate_days',
  'weekly',
] as const;
export type ListeningMode = (typeof LISTENING_MODES)[number];

export const INDUSTRY_VOLATILITIES = ['high', 'moderate', 'low'] as const;
export type IndustryVolatility = (typeof INDUSTRY_VOLATILITIES)[number];

export type ListeningConfiguration = {
  id: string;
  organization_id: string;
  mode: ListeningMode;
  platforms: string[];
  keyword_count: number;
  industry_category: string | null;
  industry_volatility: IndustryVolatility | null;
  monthly_credit_ceiling: number;
  daily_run_ceiling: number;
  cooldown_minutes: number;
  estimated_monthly_credits_min: number;
  estimated_monthly_credits_max: number;
  estimated_credits_per_run: number;
  next_planned_run_at: string | null;
  last_run_at: string | null;
  last_confirmation_at: string | null;
  confirmed_by: string | null;
  confirmed_estimate_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function isListeningMode(value: unknown): value is ListeningMode {
  return typeof value === 'string'
    && (LISTENING_MODES as readonly string[]).includes(value);
}

export function isIndustryVolatility(value: unknown): value is IndustryVolatility {
  return typeof value === 'string'
    && (INDUSTRY_VOLATILITIES as readonly string[]).includes(value);
}

/**
 * Frequency → planned runs per calendar month. Used by credit estimation
 * and orchestration scheduler. Deterministic; matches user expectations:
 * daily ≈ 30, alternate-days ≈ 15, weekly ≈ 4, manual = 0.
 */
export const FREQUENCY_RUNS_PER_MONTH: Record<ListeningMode, number> = {
  manual_only: 0,
  daily: 30,
  alternate_days: 15,
  weekly: 4,
};

export const FREQUENCY_INTERVAL_HOURS: Record<ListeningMode, number> = {
  manual_only: 0,
  daily: 24,
  alternate_days: 48,
  weekly: 168,
};
