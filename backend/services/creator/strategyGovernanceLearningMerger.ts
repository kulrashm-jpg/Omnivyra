/**
 * Strategy Governance + Learning Merger (Creator Validation P1
 * Remediation — Phase 3).
 *
 * Pure helper that takes the output of
 *   - `applyStrategyGovernance` (classification: recommended / allowed
 *     / restricted)
 *   - `blendLearningPriors` (learning-augmented score)
 *
 * and produces a single per-content-type view where:
 *
 *   - Every option retains its governance classification + restriction
 *     reason (governance is NEVER overridden by learning).
 *   - Every option carries the learning fields (context_score,
 *     learning_score, learning_confidence, learning_reasons,
 *     learning_applied) so the picker can render the augmented signal.
 *   - Within each governance bucket (recommended, allowed, restricted)
 *     options are re-sorted by blended score (with native order as a
 *     stable tiebreak). Buckets remain ordered:
 *         recommended → allowed → restricted.
 *
 *   - In cold start the blender already returned input order and
 *     score=0 learning bonuses, so the bucket re-sort collapses to the
 *     governance order. No special-case required here.
 *
 * STRICT scope:
 *   - PURE. No I/O.
 *   - Never reclassifies any option.
 *   - Never removes any option.
 *   - The restricted bucket order is preserved verbatim from
 *     governance — operators must never see a learning-boosted
 *     restricted strategy float above a non-restricted one.
 */

import { PURPOSE_OPTIONS } from '../../../lib/variants/purposeOptions';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';
import type {
  ApplyStrategyGovernanceResult,
  GovernedPurposeOption,
} from './strategyGovernanceApplier';
import type {
  BlendedPurposeOption,
  BlendLearningPriorsResult,
} from './strategyLearningBlender';

export type GovernedBlendedPurposeOption = GovernedPurposeOption & {
  /** Recommendation engine score (verbatim). */
  context_score: number;
  /** Learning bonus applied (0 in cold start). */
  learning_score: number;
  /** Confidence band reported by the learning engine. */
  learning_confidence: 'low' | 'medium' | 'high';
  /** Reasons sourced from the learning engine. */
  learning_reasons: string[];
  /** True when the option received any non-zero learning bonus. */
  learning_applied: boolean;
};

export type MergedGovernanceLearningPerType = {
  /** Bucket-ordered (recommended → allowed → restricted), with each
   *  bucket internally re-sorted by blended score. */
  options: GovernedBlendedPurposeOption[];
  recommended: GovernedBlendedPurposeOption[];
  allowed: GovernedBlendedPurposeOption[];
  restricted: GovernedBlendedPurposeOption[];
  default_strategy_override: string | null;
  /** True when the learning engine contributed a non-zero bonus to at
   *  least one option in this lane. False in cold start. */
  learning_applied: boolean;
  /** Cold-start note from the learning engine, surfaced for UI. */
  cold_start_note: string | null;
};

function mergeOneLane(input: {
  contentType: CreatorTypeForVariant;
  governance: ApplyStrategyGovernanceResult;
  blended: BlendLearningPriorsResult;
}): MergedGovernanceLearningPerType {
  const { contentType, governance, blended } = input;
  const nativeIndex = new Map<string, number>();
  PURPOSE_OPTIONS[contentType].forEach((opt, idx) => nativeIndex.set(opt.value, idx));

  // Map blended options by value for fast lookup.
  const blendedByValue = new Map<string, BlendedPurposeOption>();
  for (const b of blended.options) blendedByValue.set(b.value, b);

  const attach = (o: GovernedPurposeOption): GovernedBlendedPurposeOption => {
    const b = blendedByValue.get(o.value);
    return {
      ...o,
      context_score: b?.context_score ?? o.score,
      learning_score: b?.learning_score ?? 0,
      learning_confidence: b?.learning_confidence ?? 'low',
      learning_reasons: b?.learning_reasons ?? [],
      learning_applied: b?.learning_applied ?? false,
    };
  };

  const sortByBlended = (
    a: GovernedBlendedPurposeOption,
    b: GovernedBlendedPurposeOption,
  ): number => {
    const aBlended = a.context_score + a.learning_score;
    const bBlended = b.context_score + b.learning_score;
    if (bBlended !== aBlended) return bBlended - aBlended;
    return (nativeIndex.get(a.value) ?? 0) - (nativeIndex.get(b.value) ?? 0);
  };

  // Re-sort within the recommended bucket and within the two allowed
  // sub-buckets (clean vs deprioritized). The restricted bucket and
  // the clean-vs-deprioritized boundary are preserved verbatim — a
  // learning bonus must NEVER float a deprioritized or restricted
  // strategy above a non-deprioritized / non-restricted one.
  const recommended = governance.recommended.map(attach).sort(sortByBlended);
  const allowedAll = governance.allowed.map(attach);
  const allowedClean = allowedAll.filter((o) => !o.deprioritized).sort(sortByBlended);
  const allowedDepr = allowedAll.filter((o) => o.deprioritized).sort(sortByBlended);
  const allowed = [...allowedClean, ...allowedDepr];
  const restricted = governance.restricted.map(attach);

  const options = [...recommended, ...allowed, ...restricted];

  return {
    options,
    recommended,
    allowed,
    restricted,
    default_strategy_override: governance.defaultStrategyOverride,
    learning_applied: blended.appliedLearning,
    cold_start_note: blended.coldStartNote,
  };
}

export function mergeGovernanceWithLearningAllTypes(input: {
  governanceByType: Record<CreatorTypeForVariant, ApplyStrategyGovernanceResult>;
  blendedByType: Record<CreatorTypeForVariant, BlendLearningPriorsResult>;
}): Record<CreatorTypeForVariant, MergedGovernanceLearningPerType> {
  return {
    image: mergeOneLane({
      contentType: 'image',
      governance: input.governanceByType.image,
      blended: input.blendedByType.image,
    }),
    carousel: mergeOneLane({
      contentType: 'carousel',
      governance: input.governanceByType.carousel,
      blended: input.blendedByType.carousel,
    }),
    infographic: mergeOneLane({
      contentType: 'infographic',
      governance: input.governanceByType.infographic,
      blended: input.blendedByType.infographic,
    }),
  };
}
