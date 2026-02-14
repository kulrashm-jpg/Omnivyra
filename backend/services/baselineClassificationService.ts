/**
 * Dynamic Baseline Conditioning — lightweight classification.
 * Computes expected baseline from stage × market scope and classifies actual vs expected.
 */

import {
  BASE_UNIT,
  STAGE_MULTIPLIER,
  MARKET_SCOPE_MULTIPLIER,
  BASELINE_THRESHOLDS,
} from '../config/baselineModelConfig';

export type CompanyStage = 'early_stage' | 'growth_stage' | 'established';
export type MarketScope = 'niche' | 'regional' | 'national' | 'global';

export function computeExpectedBaseline(
  stage: CompanyStage | string,
  marketScope: MarketScope | string
): number {
  const stageMult = STAGE_MULTIPLIER[stage] ?? STAGE_MULTIPLIER.early_stage;
  const scopeMult = MARKET_SCOPE_MULTIPLIER[marketScope] ?? MARKET_SCOPE_MULTIPLIER.niche;
  return BASE_UNIT * stageMult * scopeMult;
}

export function classifyBaseline(
  actualFollowers: number,
  expectedBaseline: number
): { status: 'underdeveloped' | 'aligned' | 'strong'; ratio: number } {
  if (expectedBaseline <= 0) {
    return { status: 'aligned', ratio: 1 };
  }
  const ratio = actualFollowers / expectedBaseline;

  if (ratio < BASELINE_THRESHOLDS.underdeveloped) {
    return { status: 'underdeveloped', ratio };
  }

  if (ratio > BASELINE_THRESHOLDS.strong) {
    return { status: 'strong', ratio };
  }

  return { status: 'aligned', ratio };
}
