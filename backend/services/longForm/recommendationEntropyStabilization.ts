/**
 * Phase 6 — Entropy stabilization.
 *
 * Diagnostics produced by earlier phases (cluster diversity, coverage,
 * archetype entropy, shape uniqueness) tell us how spread out a batch is,
 * but they don't measure whether the batch HANGS TOGETHER. A perfectly
 * random batch scores high on diversity but tells the buyer nothing
 * coherent; a perfectly repetitive batch scores high on coherence but
 * wastes slots.
 *
 * This layer computes:
 *   batchCoherenceScore        — how much the batch shares a through-line
 *   batchEntropyStabilityScore — diversity × coherence harmonic mean
 *
 * If either score drifts out of band, the layer emits warnings (no rejection
 * yet — that decision belongs to the caller).
 */

import type {
  EntropyStabilization,
  LongFormRecommendation,
  RecommendationSetCoverage,
  RecommendationBatchDiagnostics,
} from './longFormRecommendationTypes';

// Coherence bands (after empirical calibration on stress fixtures).
const COHERENCE_FLOOR = 30;
const COHERENCE_CEIL = 88;
const DIVERSITY_FLOOR = 30;
const DIVERSITY_CEIL = 92;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function harmonicMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

function dominantShare<T extends string>(distribution: Record<T, number>): { share: number; key: T | null } {
  const entries = Object.entries(distribution) as Array<[T, number]>;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return { share: 0, key: null };
  let max = -1;
  let key: T | null = null;
  for (const [k, n] of entries) {
    if (n > max) { max = n; key = k; }
  }
  return { share: max / total, key };
}

/**
 * Coherence proxy: an accepted batch shares some ICP through-line, archetype
 * cluster, or stage focus. We use the dominant archetype share, dominant
 * ICP-family share, and median-novelty as composite signals.
 *
 * Coherence is high when at least one signal has a dominant theme (50–80%)
 * AND novelty is moderately high (not all of the cards are warmed-over reruns).
 */
function computeBatchCoherence(
  recommendations: LongFormRecommendation[],
  diagnostics: RecommendationBatchDiagnostics,
): number {
  if (recommendations.length === 0) return 0;

  // Archetype dominance: an ideal batch has 2–3 archetypes leading.
  const archetypeShare = dominantShare(diagnostics.archetypeDistribution).share;
  // We want share to be in [0.3, 0.6] — too low = scattered, too high = collapsed.
  const archetypeCoherence = (() => {
    if (archetypeShare === 0) return 30;
    if (archetypeShare < 0.25) return 40;
    if (archetypeShare <= 0.6) return 90;
    if (archetypeShare <= 0.8) return 65;
    return 35;
  })();

  // Stage spread coherence: a great batch covers consecutive funnel stages
  // rather than scattering across all 5 randomly.
  const stages = recommendations.map((r) => r.targetBuyerStage);
  const stageOrder = ['awareness', 'consideration', 'evaluation', 'decision', 'expansion'];
  const stageIndices = stages.map((s) => stageOrder.indexOf(s)).filter((i) => i >= 0);
  const stageSpread = stageIndices.length === 0
    ? 0
    : Math.max(...stageIndices) - Math.min(...stageIndices);
  const stageCoherence = stageSpread <= 1 ? 60 : stageSpread <= 2 ? 90 : stageSpread <= 3 ? 70 : 45;

  // Mean novelty bumps coherence (cards weren't pulled from disjoint memories).
  const novelties = recommendations
    .map((r) => r.recommendationNoveltyScore ?? 80)
    .sort((a, b) => a - b);
  const medianNovelty = novelties[Math.floor(novelties.length / 2)] ?? 80;
  const noveltyCoherence = medianNovelty < 25 ? 40 : medianNovelty < 55 ? 65 : 80;

  return clamp100(archetypeCoherence * 0.45 + stageCoherence * 0.30 + noveltyCoherence * 0.25);
}

export function stabilizeBatchEntropy(input: {
  recommendations: LongFormRecommendation[];
  setCoverage: RecommendationSetCoverage;
  diagnostics: RecommendationBatchDiagnostics;
  /** Diversity score BEFORE the balancer ran — used to surface a shift. */
  preBalanceDiversityScore?: number;
}): EntropyStabilization {
  const { recommendations, setCoverage, diagnostics } = input;

  const batchCoherenceScore = computeBatchCoherence(recommendations, diagnostics);
  const diversity = setCoverage.overallDiversityScore;

  // Stability = harmonic mean of diversity and coherence. Penalizes lopsided
  // batches (high diversity / low coherence OR vice versa).
  const batchEntropyStabilityScore = clamp100(harmonicMean(diversity, batchCoherenceScore));

  const warnings: string[] = [];
  if (diversity < DIVERSITY_FLOOR) warnings.push(`Batch diversity (${diversity}) is below the floor (${DIVERSITY_FLOOR}); recommendations may collapse into a single theme.`);
  if (diversity > DIVERSITY_CEIL) warnings.push(`Batch diversity (${diversity}) is above the ceiling (${DIVERSITY_CEIL}); recommendations may lack a through-line.`);
  if (batchCoherenceScore < COHERENCE_FLOOR) warnings.push(`Batch coherence (${batchCoherenceScore}) is below the floor (${COHERENCE_FLOOR}); recommendations don't share a recognizable arc.`);
  if (batchCoherenceScore > COHERENCE_CEIL) warnings.push(`Batch coherence (${batchCoherenceScore}) is above the ceiling (${COHERENCE_CEIL}); recommendations may be too repetitive.`);

  const dominantArchetype = dominantShare(diagnostics.archetypeDistribution);
  if (dominantArchetype.share > 0.6 && dominantArchetype.key) {
    warnings.push(`Archetype "${dominantArchetype.key}" dominates ${Math.round(dominantArchetype.share * 100)}% of the batch — consider broadening.`);
  }

  const diversityShift = input.preBalanceDiversityScore == null
    ? 0
    : diversity - input.preBalanceDiversityScore;

  return {
    batchCoherenceScore,
    batchEntropyStabilityScore,
    warnings,
    diversityShift,
  };
}
