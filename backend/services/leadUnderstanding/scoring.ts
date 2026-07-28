/**
 * LI-B103 / CI-D401 — Unified Lead Scoring contract. There is ONE final score; engines are
 * CONTRIBUTORS. As of Program 2 (CI-D401 / adjustment A1) the blend ALGORITHM lives once in the
 * shared canonical layer (`intelligence/canonical/scoring`) — this module is the lead-dimension
 * SPECIALIZATION that delegates to it (behaviour byte-identical; Program 1's 44 tests unchanged).
 * No forked scoring implementation remains.
 */

import type { ScoreContribution, DimensionScore, LeadScore, ScoreDimension } from './types';
import { SCORE_DIMENSIONS } from './types';
import { combineDimension as combineDimensionGeneric, combineScoresFor, type ScoringConfig } from '../intelligence/canonical/scoring';

export type { ScoringConfig };

/** Combine all contributions for ONE lead dimension (delegates to the shared canonical combiner). */
export function combineDimension(dimension: ScoreDimension, contributions: ScoreContribution[], config: ScoringConfig = {}): DimensionScore {
  return combineDimensionGeneric<ScoreDimension>(dimension, contributions as ScoreContribution[], config) as DimensionScore;
}

/** Combine contributions across ALL lead dimensions into the canonical LeadScore. */
export function combineScores(contributions: ScoreContribution[], config: ScoringConfig = {}): LeadScore {
  return combineScoresFor<ScoreDimension>(SCORE_DIMENSIONS, contributions, config) as LeadScore;
}
