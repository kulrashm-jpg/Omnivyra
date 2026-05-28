/**
 * Phase 10 — Recommendation lifecycle diagnostics aggregator.
 *
 * Walks the lifecycle registry and produces a snapshot of confidence
 * distribution, drift/inheritance failure counts, suitability distribution,
 * lifecycle state counts, and aging stats.
 *
 * Called by the engine right before returning the response (for the current
 * batch view) and by the handoff route after a transition (for the live
 * registry view).
 */

import type {
  ConfidenceBand,
  LongFormPrimaryUse,
  LongFormRecommendation,
  RecommendationLifecycleDiagnostics,
  RecommendationLifecycleState,
  RecommendationLineageMetadata,
} from './longFormRecommendationTypes';
import {
  LONG_FORM_PRIMARY_USES,
} from './longFormRecommendationTypes';
import type { RecommendationLifecycleRegistry } from './recommendationLifecycle';

const CONFIDENCE_BANDS: ConfidenceBand[] = ['low', 'medium', 'high', 'exceptional'];
const LIFECYCLE_STATES: RecommendationLifecycleState[] = [
  'generated', 'validated', 'selected', 'handed_off',
  'planner_validated', 'planner_drifted',
  'generation_ready', 'generation_rejected', 'archived',
];

function emptyConfidenceDist(): Record<ConfidenceBand, number> {
  const d = {} as Record<ConfidenceBand, number>;
  for (const b of CONFIDENCE_BANDS) d[b] = 0;
  return d;
}

function emptySuitabilityDist(): Record<LongFormPrimaryUse, number> {
  const d = {} as Record<LongFormPrimaryUse, number>;
  for (const u of LONG_FORM_PRIMARY_USES) d[u] = 0;
  return d;
}

function emptyLifecycleCounts(): Record<RecommendationLifecycleState, number> {
  const d = {} as Record<RecommendationLifecycleState, number>;
  for (const s of LIFECYCLE_STATES) d[s] = 0;
  return d;
}

function latestState(metadata: RecommendationLineageMetadata): RecommendationLifecycleState {
  return metadata.lifecycleStateHistory[metadata.lifecycleStateHistory.length - 1]?.state ?? 'generated';
}

function continuityDegraded(metadata: RecommendationLineageMetadata): boolean {
  return metadata.inheritanceHistory.some((h) => h.continuityScore < 70);
}

function inheritanceFailed(metadata: RecommendationLineageMetadata): boolean {
  return metadata.inheritanceHistory.some((h) => h.inheritanceCompletenessScore < 70);
}

function semanticDriftFlagged(metadata: RecommendationLineageMetadata): boolean {
  return metadata.inheritanceHistory.some((h) => h.semanticContinuityScore < 60);
}

export function buildLifecycleDiagnostics(input: {
  registry: RecommendationLifecycleRegistry;
  companyId?: string;
  /** When provided, include these recommendations even if they aren't (yet) in the registry. */
  inflightRecommendations?: LongFormRecommendation[];
  /** Pre/post diversity used to compute entropy stabilization effectiveness. */
  preBalanceDiversity?: number;
  postBalanceDiversity?: number;
}): RecommendationLifecycleDiagnostics {
  const snapshot = input.registry.snapshot(input.companyId);

  const confidenceDistribution = emptyConfidenceDist();
  const suitabilityDistribution = emptySuitabilityDist();
  const lifecycleStateCounts = emptyLifecycleCounts();

  let continuityDegradationCount = 0;
  let plannerInheritanceLossCount = 0;
  let semanticDriftFrequency = 0;
  let ageSum = 0;
  let oldest = 0;

  // First walk the registry entries.
  for (const { recommendation, metadata } of snapshot) {
    const band = recommendation.confidence?.confidenceBand;
    if (band) confidenceDistribution[band] = (confidenceDistribution[band] ?? 0) + 1;
    const primary = recommendation.suitability?.recommendedPrimaryUse;
    if (primary) suitabilityDistribution[primary] = (suitabilityDistribution[primary] ?? 0) + 1;

    lifecycleStateCounts[latestState(metadata)] = (lifecycleStateCounts[latestState(metadata)] ?? 0) + 1;

    if (continuityDegraded(metadata)) continuityDegradationCount += 1;
    if (inheritanceFailed(metadata)) plannerInheritanceLossCount += 1;
    if (semanticDriftFlagged(metadata)) semanticDriftFrequency += 1;

    ageSum += metadata.ageInSeconds;
    if (metadata.ageInSeconds > oldest) oldest = metadata.ageInSeconds;
  }

  // Then fold in any inflight recommendations not yet registered (e.g. when the
  // engine builds the diagnostics for its own batch before transitioning state).
  if (input.inflightRecommendations) {
    const knownIds = new Set(snapshot.map((s) => s.recommendation.recommendationId));
    for (const rec of input.inflightRecommendations) {
      if (knownIds.has(rec.recommendationId)) continue;
      const band = rec.confidence?.confidenceBand;
      if (band) confidenceDistribution[band] = (confidenceDistribution[band] ?? 0) + 1;
      const primary = rec.suitability?.recommendedPrimaryUse;
      if (primary) suitabilityDistribution[primary] = (suitabilityDistribution[primary] ?? 0) + 1;
      lifecycleStateCounts.generated = (lifecycleStateCounts.generated ?? 0) + 1;
    }
  }

  const inflightCount = input.inflightRecommendations?.length ?? 0;
  const populationCount = snapshot.length + inflightCount;
  const averageRecommendationAgeSeconds = snapshot.length === 0 ? 0 : Math.round(ageSum / snapshot.length);

  // Entropy stabilization effectiveness: bounded measure of how much the
  // post-balance diversity moved toward the [DIVERSITY_FLOOR, DIVERSITY_CEIL]
  // band relative to the pre-balance pool. Higher = the layer pulled the
  // batch back to a healthy band.
  let entropyStabilizationEffectiveness = 50;
  if (input.preBalanceDiversity != null && input.postBalanceDiversity != null) {
    const pre = input.preBalanceDiversity;
    const post = input.postBalanceDiversity;
    const target = 60; // midpoint of [30,92] band approximately
    const preDistance = Math.abs(pre - target);
    const postDistance = Math.abs(post - target);
    const improvement = preDistance - postDistance;
    entropyStabilizationEffectiveness = Math.max(0, Math.min(100, Math.round(50 + improvement)));
  }

  return {
    confidenceDistribution,
    continuityDegradationCount,
    plannerInheritanceLossCount,
    semanticDriftFrequency,
    entropyStabilizationEffectiveness,
    suitabilityDistribution,
    lifecycleStateCounts,
    oldestRecommendationAgeSeconds: oldest,
    averageRecommendationAgeSeconds,
    activeRegistrySize: populationCount,
  };
}
