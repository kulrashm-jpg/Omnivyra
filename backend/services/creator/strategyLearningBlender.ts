/**
 * Strategy Learning Blender (Creator Performance Learning Engine —
 * Phase 4).
 *
 * Pure helper that takes the output of the existing
 * `companyStrategyRecommendationEngine` and **additively** blends the
 * learning score on top. Never modifies the engine itself.
 *
 * Blend formula (per option):
 *
 *   blended.score   = recommendation.score + learning.score
 *   blended.reasons = recommendation.reasons ∪ learning.reasons
 *
 * Re-sorts by blended score with the native picker order as a stable
 * tiebreaker.
 *
 * STRICT scope:
 *   - Learning is ADDITIVE. Never overrides governance.
 *   - Never hard-suppresses a strategy.
 *   - Cold-start: when `summary.lane.coldStart === true`, the
 *     blender is a strict no-op (returns the input recommendations
 *     unchanged) so the existing context engine remains authoritative.
 */

import type { RecommendedPurposeOption } from './companyStrategyRecommendationEngine';
import type { LearningSummary, LearningScore } from './strategyLearningEngine';
import { PURPOSE_OPTIONS } from '../../../lib/variants/purposeOptions';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';

export type BlendedPurposeOption = RecommendedPurposeOption & {
  /** Recommendation engine score (verbatim from input). */
  context_score: number;
  /** Learning bonus applied (0 in cold start). */
  learning_score: number;
  /** Confidence band reported by the learning engine. */
  learning_confidence: 'low' | 'medium' | 'high';
  /** Reasons sourced from the learning engine (separate so callers
   *  can render them with a "Performance:" prefix). */
  learning_reasons: string[];
  /** True when the option received any non-zero learning bonus. */
  learning_applied: boolean;
};

export type BlendLearningPriorsInput = {
  contentType: CreatorTypeForVariant;
  /** Output of `companyStrategyRecommendationEngine`. */
  recommendations: ReadonlyArray<RecommendedPurposeOption>;
  /** Output of `strategyLearningEngine.computeLearningPriors`. */
  learning: LearningSummary;
};

export type BlendLearningPriorsResult = {
  options: BlendedPurposeOption[];
  /** True when the learning engine returned cold-start; the blender
   *  preserved the input order. */
  appliedLearning: boolean;
  /** Cold-start note from the learning engine, surfaced for UI. */
  coldStartNote: string | null;
};

/**
 * Compose blended options. Stable, deterministic, pure.
 *
 * When `learning.lane.coldStart === true`, every option's
 * `context_score` is preserved with `learning_score = 0` and the
 * input order is kept (no re-sort). This honors Phase 7 cold-start
 * safety.
 */
export function blendLearningPriors(
  input: BlendLearningPriorsInput,
): BlendLearningPriorsResult {
  const { recommendations, learning, contentType } = input;
  const coldStart = learning.lane.coldStart;

  // Map learning scores by strategy_key for fast lookup.
  const byKey = new Map<string, LearningScore>();
  for (const v of Object.values(learning.scores)) {
    byKey.set(v.strategy_key, v);
  }

  const nativeIndex = new Map<string, number>();
  PURPOSE_OPTIONS[contentType].forEach((opt, idx) => nativeIndex.set(opt.value, idx));

  const blended: BlendedPurposeOption[] = recommendations.map((opt) => {
    const ls = byKey.get(opt.value);
    const learningScore = coldStart ? 0 : (ls?.score ?? 0);
    const learningReasons = coldStart ? [] : (ls?.reasons ?? []);
    const learningConfidence = (ls?.confidence ?? 'low') as 'low' | 'medium' | 'high';
    const applied = learningScore !== 0;
    return {
      ...opt,
      context_score: opt.score,
      learning_score: learningScore,
      learning_confidence: learningConfidence,
      learning_reasons: learningReasons,
      learning_applied: applied,
      score: opt.score + learningScore,
      reasons: applied
        ? [...opt.reasons, ...learningReasons.map((r) => `Performance: ${r}`)]
        : opt.reasons,
    };
  });

  if (coldStart) {
    // Cold-start safety: preserve input order; do NOT re-sort.
    return {
      options: blended,
      appliedLearning: false,
      coldStartNote: learning.coldStartNote,
    };
  }

  // Re-sort by blended score; ties broken by native option order so
  // the picker's deterministic baseline holds.
  blended.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (nativeIndex.get(a.value) ?? 0) - (nativeIndex.get(b.value) ?? 0);
  });

  return {
    options: blended,
    appliedLearning: blended.some((o) => o.learning_applied),
    coldStartNote: null,
  };
}

/**
 * Variant that applies blending across all three content-type lanes.
 * Used by the API endpoint that fans out across lanes.
 */
export function blendLearningPriorsAllTypes(input: {
  recommendedByType: Record<CreatorTypeForVariant, ReadonlyArray<RecommendedPurposeOption>>;
  learningByType: Record<CreatorTypeForVariant, LearningSummary>;
}): Record<CreatorTypeForVariant, BlendLearningPriorsResult> {
  return {
    image: blendLearningPriors({
      contentType: 'image',
      recommendations: input.recommendedByType.image,
      learning: input.learningByType.image,
    }),
    carousel: blendLearningPriors({
      contentType: 'carousel',
      recommendations: input.recommendedByType.carousel,
      learning: input.learningByType.carousel,
    }),
    infographic: blendLearningPriors({
      contentType: 'infographic',
      recommendations: input.recommendedByType.infographic,
      learning: input.learningByType.infographic,
    }),
  };
}
