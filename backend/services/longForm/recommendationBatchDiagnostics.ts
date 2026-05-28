/**
 * Phase 9 — Batch-level diagnostics aggregator.
 *
 * Collapses cluster, balancer, narrative-shape, memory, and continuity signals
 * into a single observability payload the API returns and the UI surfaces.
 */

import type {
  ClusterDiversityReport,
  GenerationContinuityValidation,
  LongFormRecommendation,
  NarrativeArchetype,
  NarrativeShape,
  RecommendationBatchDiagnostics,
} from './longFormRecommendationTypes';
import { NARRATIVE_ARCHETYPES } from './longFormRecommendationTypes';

const SHAPE_KEYS: NarrativeShape[] = [
  'how_to', 'why_x_matters', 'ultimate_guide', 'best_practices', 'how_to_scale',
  'future_of', 'what_is', 'comparison', 'framework_first', 'case_proof',
  'opinion_take', 'other',
];

function emptyShapeDist(): Record<NarrativeShape, number> {
  const d = {} as Record<NarrativeShape, number>;
  for (const k of SHAPE_KEYS) d[k] = 0;
  return d;
}

function emptyArchetypeDist(): Record<NarrativeArchetype, number> {
  const d = {} as Record<NarrativeArchetype, number>;
  for (const k of NARRATIVE_ARCHETYPES) d[k] = 0;
  d.uncategorized = 0;
  return d;
}

function shannonEntropyNormalized<T extends string>(counts: Record<T, number>): number {
  const values = Object.values(counts) as number[];
  const total = values.reduce<number>((s, n) => s + n, 0);
  if (total === 0) return 0;
  let h = 0;
  let nonZeroBuckets = 0;
  for (const c of values) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
    nonZeroBuckets += 1;
  }
  if (nonZeroBuckets <= 1) return 0;
  // Normalize against log2(nonZeroBuckets) so a uniform distribution → 100.
  const max = Math.log2(nonZeroBuckets);
  return max === 0 ? 0 : Math.round((h / max) * 100);
}

function distributeNovelty(recommendations: LongFormRecommendation[]) {
  const dist = { low: 0, medium: 0, high: 0 };
  for (const rec of recommendations) {
    const n = rec.recommendationNoveltyScore ?? 100;
    if (n < 35) dist.low += 1;
    else if (n < 70) dist.medium += 1;
    else dist.high += 1;
  }
  return dist;
}

export interface BuildBatchDiagnosticsInput {
  recommendations: LongFormRecommendation[];
  clusterReport: ClusterDiversityReport;
  diversitySuppressionCount: number;
  shapeDistribution: Record<NarrativeShape, number>;
  retry: {
    roundsUsed: number;
    candidatesPerRound: number[];
    acceptedPerRound: number[];
  };
  continuityValidations?: GenerationContinuityValidation[];
}

export function buildBatchDiagnostics(input: BuildBatchDiagnosticsInput): RecommendationBatchDiagnostics {
  const archetypeDist = emptyArchetypeDist();
  for (const rec of input.recommendations) {
    const a = rec.narrativeArchetype ?? 'uncategorized';
    archetypeDist[a] = (archetypeDist[a] ?? 0) + 1;
  }

  // Ensure the supplied shape distribution covers all shape keys.
  const shapeDist = { ...emptyShapeDist(), ...input.shapeDistribution };

  const clusterSpread = input.recommendations.length === 0
    ? 0
    : Math.round((input.clusterReport.clusterCount / Math.max(input.recommendations.length, 1)) * 100);

  const narrativeShapeEntropy = input.recommendations.length === 0
    ? 0
    : Math.round(
        input.recommendations.reduce((sum, r) => sum + (r.narrativeShapeUniquenessScore ?? 100), 0)
        / input.recommendations.length,
      );

  const recommendationEntropyScore = shannonEntropyNormalized(archetypeDist);

  const firstRoundAccept = input.retry.acceptedPerRound[0] ?? 0;
  const firstRoundCandidates = input.retry.candidatesPerRound[0] ?? 0;
  const lastRoundAccept = input.retry.acceptedPerRound[input.retry.acceptedPerRound.length - 1] ?? 0;
  const lastRoundCandidates = input.retry.candidatesPerRound[input.retry.candidatesPerRound.length - 1] ?? 0;
  const firstRate = firstRoundCandidates === 0 ? 0 : firstRoundAccept / firstRoundCandidates;
  const lastRate = lastRoundCandidates === 0 ? 0 : lastRoundAccept / lastRoundCandidates;
  const acceptanceImprovement = firstRate === 0 ? -1 : Number((lastRate - firstRate).toFixed(3));

  const continuityPreservationScore = (() => {
    if (!input.continuityValidations || input.continuityValidations.length === 0) return null;
    const sum = input.continuityValidations.reduce((s, v) => s + v.continuityScore, 0);
    return Math.round(sum / input.continuityValidations.length);
  })();

  return {
    rejectedClusterCount: input.clusterReport.suppressedDuplicateCount,
    diversitySuppressionCount: input.diversitySuppressionCount,
    retryEffectiveness: {
      roundsUsed: input.retry.roundsUsed,
      candidatesPerRound: input.retry.candidatesPerRound,
      acceptedPerRound: input.retry.acceptedPerRound,
      acceptanceImprovement,
    },
    noveltyDistribution: distributeNovelty(input.recommendations),
    clusterSpread,
    narrativeShapeEntropy,
    recommendationEntropyScore,
    continuityPreservationScore,
    shapeDistribution: shapeDist,
    archetypeDistribution: archetypeDist,
  };
}
