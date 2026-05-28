/**
 * Phase 4 — Recommendation confidence model.
 *
 * Confidence is NOT just the overallRecommendationStrength. A recommendation
 * may score high but be low-confidence if: company context is thin, retry
 * was needed, cluster is collapsed, archetype is uncategorized, novelty is
 * low, etc. This model produces a separate confidenceScore + band per
 * recommendation, with a contributor breakdown for explainability.
 *
 * Inputs flow from the engine pipeline state — no LLM, deterministic.
 *
 * Banding:
 *   < 40  → low
 *   40–65 → medium
 *   66–85 → high
 *   > 85  → exceptional
 */

import type { CompanyContextFoundation } from './companyContextFoundation';
import type {
  ClusterDiversityReport,
  ConfidenceBand,
  LongFormRecommendation,
  RecommendationConfidence,
  RecommendationFamilyCluster,
} from './longFormRecommendationTypes';

const WEIGHTS = {
  companyContextRichness: 0.10,
  recommendationUniqueness: 0.10,
  validationStability: 0.10,
  retryVolatility: 0.05,
  clusterStability: 0.10,
  archetypeConfidence: 0.05,
  noveltyConfidence: 0.10,
  operationalSpecificity: 0.15,
  strategicConsistency: 0.15,
  continuityStability: 0.10,
} as const;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

export interface ComputeConfidenceInput {
  recommendation: LongFormRecommendation;
  foundation: CompanyContextFoundation;
  /** Cluster this recommendation belongs to (null when no clustering ran). */
  cluster: RecommendationFamilyCluster | null;
  clusterReport: ClusterDiversityReport;
  /** Whether the engine had to retry; supplied by engine. */
  retryUsed: boolean;
  /** Whether this specific recommendation was retried (round > 0). */
  recommendationRetried: boolean;
  /**
   * Optional continuity stability — when null, the contributor is set to a
   * neutral 70 (no signal). Engine doesn't compute continuity itself; the
   * handoff route can update confidence later if it caches the recommendation.
   */
  continuityStability?: number | null;
}

export function computeRecommendationConfidence(
  input: ComputeConfidenceInput,
): RecommendationConfidence {
  const { recommendation: r, foundation, cluster, clusterReport, retryUsed, recommendationRetried, continuityStability } = input;

  const reasoning: string[] = [];

  // 1. Company context richness — foundation completion + populated sections.
  const companyContextRichness = clamp100(
    foundation.completion * 0.7 + (foundation.populatedSections.length / 5) * 100 * 0.3,
  );
  if (companyContextRichness < 40) reasoning.push('Company context is thin — only a few foundation sections populated.');

  // 2. Recommendation uniqueness — shape uniqueness × cluster spread fraction.
  const shapeUniq = r.narrativeShapeUniquenessScore ?? 80;
  const spreadFrac = clusterReport.totalCandidates === 0
    ? 0.5
    : clusterReport.clusterCount / clusterReport.totalCandidates;
  const recommendationUniqueness = clamp100(shapeUniq * 0.6 + spreadFrac * 100 * 0.4);
  if (recommendationUniqueness < 45) reasoning.push('Narrative shape repeats within the batch or cluster spread is low.');

  // 3. Validation stability — did the candidate need a retry round to pass?
  const validationStability = recommendationRetried ? 55 : 90;
  if (recommendationRetried) reasoning.push('Required a validator retry — first-round refinement did not clear all rules.');

  // 4. Retry volatility — penalize batches with overall retry usage even if this
  //    card passed first round; the batch is unstable.
  const retryVolatility = retryUsed ? 65 : 95;

  // 5. Cluster stability — cluster with many suppressed duplicates is unstable;
  //    cluster with exactly 1 member is most stable (no near-duplicates).
  const memberCount = cluster?.memberRecommendationIds.length ?? 1;
  const suppressed = cluster?.suppressedDuplicateCount ?? 0;
  const clusterStability = clamp100(100 - suppressed * 10 - Math.max(0, memberCount - 2) * 8);
  if (clusterStability < 60) reasoning.push('Cluster had near-duplicate candidates; recommendation is in a collapse-prone family.');

  // 6. Archetype confidence — uncategorized is low signal.
  const archetypeConfidence = r.narrativeArchetype && r.narrativeArchetype !== 'uncategorized' ? 90 : 45;
  if (archetypeConfidence < 60) reasoning.push('Narrative archetype could not be classified — content lacks an identifiable strategic shape.');

  // 7. Novelty confidence — direct mapping from novelty score.
  const noveltyConfidence = r.recommendationNoveltyScore ?? 85;
  if (noveltyConfidence < 35) reasoning.push('Novelty is low — recommendation overlaps recent recommendations for this company.');

  // 8. Operational specificity — operationalDepthScore direct.
  const operationalSpecificity = r.operationalDepthScore;
  if (operationalSpecificity < 55) reasoning.push('Operational depth is below the floor — proof items may be too generic.');

  // 9. Strategic consistency — authorityBuildingScore + drift-risk inversion.
  const driftPenalty =
    r.genericityRiskLevel === 'high' ? 30
    : r.genericityRiskLevel === 'medium' ? 12
    : 0;
  const strategicConsistency = clamp100(r.authorityBuildingScore - driftPenalty);
  if (driftPenalty > 0) reasoning.push(`Drift risk ${r.genericityRiskLevel} reduces strategic consistency.`);

  // 10. Continuity stability — supplied by handoff route, neutral when absent.
  const continuityStabilityValue = continuityStability == null ? 70 : continuityStability;

  const breakdown = {
    companyContextRichness,
    recommendationUniqueness,
    validationStability,
    retryVolatility,
    clusterStability,
    archetypeConfidence,
    noveltyConfidence,
    operationalSpecificity,
    strategicConsistency,
    continuityStability: continuityStabilityValue,
  } as const;

  const score = clamp100(
    breakdown.companyContextRichness * WEIGHTS.companyContextRichness
    + breakdown.recommendationUniqueness * WEIGHTS.recommendationUniqueness
    + breakdown.validationStability * WEIGHTS.validationStability
    + breakdown.retryVolatility * WEIGHTS.retryVolatility
    + breakdown.clusterStability * WEIGHTS.clusterStability
    + breakdown.archetypeConfidence * WEIGHTS.archetypeConfidence
    + breakdown.noveltyConfidence * WEIGHTS.noveltyConfidence
    + breakdown.operationalSpecificity * WEIGHTS.operationalSpecificity
    + breakdown.strategicConsistency * WEIGHTS.strategicConsistency
    + breakdown.continuityStability * WEIGHTS.continuityStability,
  );

  const band: ConfidenceBand =
    score < 40 ? 'low'
    : score < 66 ? 'medium'
    : score < 86 ? 'high'
    : 'exceptional';

  if (band === 'exceptional') reasoning.unshift('All confidence contributors are strong; this is a high-trust recommendation.');
  if (band === 'low') reasoning.unshift('Surface this recommendation with a low-confidence label; consider deprioritizing.');

  return {
    recommendationConfidenceScore: score,
    confidenceBand: band,
    contributorBreakdown: breakdown,
    reasoning,
  };
}

/**
 * Recompute confidence with an updated continuityStability value. Used by the
 * handoff route after running the semantic continuity analyzer.
 */
export function rescoreWithContinuity(
  base: RecommendationConfidence,
  continuityStability: number,
): RecommendationConfidence {
  const updated = { ...base.contributorBreakdown, continuityStability };
  const score = clamp100(
    updated.companyContextRichness * WEIGHTS.companyContextRichness
    + updated.recommendationUniqueness * WEIGHTS.recommendationUniqueness
    + updated.validationStability * WEIGHTS.validationStability
    + updated.retryVolatility * WEIGHTS.retryVolatility
    + updated.clusterStability * WEIGHTS.clusterStability
    + updated.archetypeConfidence * WEIGHTS.archetypeConfidence
    + updated.noveltyConfidence * WEIGHTS.noveltyConfidence
    + updated.operationalSpecificity * WEIGHTS.operationalSpecificity
    + updated.strategicConsistency * WEIGHTS.strategicConsistency
    + updated.continuityStability * WEIGHTS.continuityStability,
  );
  const band: ConfidenceBand =
    score < 40 ? 'low'
    : score < 66 ? 'medium'
    : score < 86 ? 'high'
    : 'exceptional';
  return {
    recommendationConfidenceScore: score,
    confidenceBand: band,
    contributorBreakdown: updated,
    reasoning: base.reasoning,
  };
}
