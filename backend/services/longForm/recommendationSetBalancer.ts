/**
 * Phase 2 — Recommendation set balancer.
 *
 * Inspects the candidate pool produced by scoring + clustering and selects
 * a subset that maximizes diversity across:
 *   1. ICP problem families
 *   2. Buyer maturity / target stage
 *   3. Operational sophistication (capability families)
 *   4. Strategic depth (archetype mix)
 *   5. Editorial style (narrative shapes)
 *   6. Capability areas
 *   7. Pain-point categories
 *
 * Strategy: greedy fill ordered by overallStrength, but skip a candidate if
 * a stronger one already covered its (icpFamily, capabilityFamily, archetype,
 * stage) tuple — unless we'd fall short of the requested limit, in which case
 * we relax the constraint progressively.
 */

import type {
  CoverageDimension,
  LongFormRecommendation,
  RecommendationSetCoverage,
} from './longFormRecommendationTypes';
import { deriveRecommendationFamily } from './recommendationFamilyClustering';

export interface BalanceResult {
  /** Selected subset, ordered by overallStrength descending. */
  selected: LongFormRecommendation[];
  /** Candidates dropped because diversity was already covered. */
  diversityDrops: LongFormRecommendation[];
  /** Coverage stats for the selected subset. */
  coverage: RecommendationSetCoverage;
  /** Number of candidates suppressed for diversity (Phase 9 diagnostic). */
  diversitySuppressionCount: number;
}

function emptyDim(): CoverageDimension {
  return { unique: 0, total: 0, ratio: 0 };
}

function dim(uniqueCount: number, total: number): CoverageDimension {
  const ratio = total === 0 ? 0 : Number((uniqueCount / total).toFixed(2));
  return { unique: uniqueCount, total, ratio };
}

function buildCoverage(recommendations: LongFormRecommendation[]): RecommendationSetCoverage {
  if (recommendations.length === 0) {
    return {
      icpCoverage: emptyDim(),
      capabilityCoverage: emptyDim(),
      narrativeCoverage: emptyDim(),
      maturityCoverage: emptyDim(),
      funnelStageCoverage: emptyDim(),
      overallDiversityScore: 0,
    };
  }
  const icp = new Set<string>();
  const capability = new Set<string>();
  const narrative = new Set<string>();
  const maturity = new Set<string>();
  const funnel = new Set<string>();

  for (const rec of recommendations) {
    const family = deriveRecommendationFamily(rec);
    icp.add(family.icpProblemFamily);
    capability.add(family.capabilityFamily);
    narrative.add(family.narrativeArchetype);
    funnel.add(rec.targetBuyerStage);
    // Maturity proxy: collapse stage into early/mid/late buckets so this is a
    // distinct axis from raw funnel stage.
    const matBucket =
      rec.targetBuyerStage === 'awareness' ? 'early'
      : rec.targetBuyerStage === 'consideration' || rec.targetBuyerStage === 'evaluation' ? 'mid'
      : 'late';
    maturity.add(matBucket);
  }

  const total = recommendations.length;
  const icpDim = dim(icp.size, total);
  const capDim = dim(capability.size, total);
  const narrDim = dim(narrative.size, total);
  const matDim = dim(maturity.size, Math.min(total, 3));
  const funDim = dim(funnel.size, Math.min(total, 5));

  // Weighted blend: ICP + capability are double-weighted because they have the
  // highest commercial impact on recommendation set spread.
  const overall = Math.round(
    (icpDim.ratio * 0.28 + capDim.ratio * 0.22 + narrDim.ratio * 0.20 + matDim.ratio * 0.15 + funDim.ratio * 0.15) * 100,
  );

  return {
    icpCoverage: icpDim,
    capabilityCoverage: capDim,
    narrativeCoverage: narrDim,
    maturityCoverage: matDim,
    funnelStageCoverage: funDim,
    overallDiversityScore: overall,
  };
}

/**
 * Pick `limit` recommendations from `candidates`, preferring diversity over
 * raw score once each diversity bucket has one representative.
 *
 * The selection runs in rounds with progressively-loosened uniqueness keys:
 *   Round 1: must be unique on (icpFamily, capabilityFamily, archetype, stage)
 *   Round 2: must be unique on (icpFamily, capabilityFamily)
 *   Round 3: must be unique on icpFamily OR capabilityFamily
 *   Round 4: no uniqueness — just fill remaining slots by score
 *
 * This guarantees the top-scoring candidate is always selected (round 1),
 * then diversity wins for as long as we have unique buckets, then quality
 * wins for the remainder.
 */
export function balanceRecommendationSet(
  candidates: LongFormRecommendation[],
  limit: number,
): BalanceResult {
  if (candidates.length === 0 || limit <= 0) {
    return {
      selected: [],
      diversityDrops: [],
      coverage: buildCoverage([]),
      diversitySuppressionCount: 0,
    };
  }

  const sorted = [...candidates].sort((a, b) => b.overallRecommendationStrength - a.overallRecommendationStrength);

  const familiesById = new Map<string, ReturnType<typeof deriveRecommendationFamily>>();
  for (const rec of sorted) {
    familiesById.set(rec.recommendationId, deriveRecommendationFamily(rec));
  }

  const selected: LongFormRecommendation[] = [];
  const selectedKeys = {
    tight: new Set<string>(),       // icp|cap|arch|stage
    medium: new Set<string>(),      // icp|cap
    icpOnly: new Set<string>(),
    capOnly: new Set<string>(),
  };
  const pickedIds = new Set<string>();

  function keysFor(rec: LongFormRecommendation) {
    const fam = familiesById.get(rec.recommendationId)!;
    return {
      tight: `${fam.icpProblemFamily}|${fam.capabilityFamily}|${fam.narrativeArchetype}|${rec.targetBuyerStage}`,
      medium: `${fam.icpProblemFamily}|${fam.capabilityFamily}`,
      icpOnly: fam.icpProblemFamily,
      capOnly: fam.capabilityFamily,
    };
  }

  const rounds: Array<{ name: 'tight' | 'medium' | 'icpOnly' | 'capOnly' | 'none'; selector: (k: ReturnType<typeof keysFor>) => boolean }> = [
    { name: 'tight', selector: (k) => !selectedKeys.tight.has(k.tight) },
    { name: 'medium', selector: (k) => !selectedKeys.medium.has(k.medium) },
    { name: 'icpOnly', selector: (k) => !selectedKeys.icpOnly.has(k.icpOnly) || !selectedKeys.capOnly.has(k.capOnly) },
    { name: 'none', selector: () => true },
  ];

  for (const round of rounds) {
    if (selected.length >= limit) break;
    for (const rec of sorted) {
      if (selected.length >= limit) break;
      if (pickedIds.has(rec.recommendationId)) continue;
      const k = keysFor(rec);
      if (!round.selector(k)) continue;
      selected.push(rec);
      pickedIds.add(rec.recommendationId);
      selectedKeys.tight.add(k.tight);
      selectedKeys.medium.add(k.medium);
      selectedKeys.icpOnly.add(k.icpOnly);
      selectedKeys.capOnly.add(k.capOnly);
    }
  }

  const diversityDrops = sorted.filter((rec) => !pickedIds.has(rec.recommendationId));

  return {
    selected,
    diversityDrops,
    coverage: buildCoverage(selected),
    diversitySuppressionCount: diversityDrops.length,
  };
}

/** Public helper for emitting coverage without running a selection. */
export function reportRecommendationSetCoverage(recommendations: LongFormRecommendation[]): RecommendationSetCoverage {
  return buildCoverage(recommendations);
}
