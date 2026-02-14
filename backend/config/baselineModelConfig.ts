/**
 * Dynamic Baseline Conditioning — configurable formula constants.
 * Easily adjustable for tuning stage/scope multipliers and thresholds.
 */

export const BASE_UNIT = 300;

export const STAGE_MULTIPLIER: Record<string, number> = {
  early_stage: 1,
  growth_stage: 4,
  established: 10,
};

export const MARKET_SCOPE_MULTIPLIER: Record<string, number> = {
  niche: 1,
  regional: 2,
  national: 5,
  global: 10,
};

export const BASELINE_THRESHOLDS = {
  underdeveloped: 0.5,
  strong: 1.2,
};
