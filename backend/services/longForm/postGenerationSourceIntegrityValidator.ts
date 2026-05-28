/**
 * Phase 8 — Post-generation source integrity validator.
 *
 * Aggregates per-section traceability + citation orchestration + source
 * conflict results into a 7-dimension article-level integrity score.
 *
 * Bands:
 *   < 35  → failed
 *   35–54 → weak
 *   55–74 → acceptable
 *   75–89 → strong
 *   ≥ 90  → exceptional
 */

import type {
  CitationOrchestrationResult,
  ClaimTraceability,
  ExtractedClaim,
  KnowledgeSource,
  PostGenerationSourceIntegrityResult,
  SourceConflictResult,
  SourceIntegrityBand,
  SourceReliabilityBand,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

const WEIGHTS = {
  claimTraceability: 0.20,
  citationValidity: 0.16,
  unsupportedSourceDensity: 0.14,
  weakSourceOverreliance: 0.10,
  staleSourceDensity: 0.08,
  attributionCompleteness: 0.12,
  evidenceGroundingQuality: 0.20,
} as const;

const FLOORS = {
  claimTraceability: 50,
  citationValidity: 55,
  unsupportedSourceDensity: 55,
  weakSourceOverreliance: 55,
  staleSourceDensity: 65,
  attributionCompleteness: 60,
  evidenceGroundingQuality: 55,
} as const;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function bandFor(score: number): SourceIntegrityBand {
  if (score < 35) return 'failed';
  if (score < 55) return 'weak';
  if (score < 75) return 'acceptable';
  if (score < 90) return 'strong';
  return 'exceptional';
}

function rankBand(b: SourceReliabilityBand): number {
  return ['unreliable', 'low', 'moderate', 'high', 'exceptional'].indexOf(b);
}

export interface ValidateSourceIntegrityInput {
  claims: ExtractedClaim[];
  traceability: ClaimTraceability[];
  citationResult: CitationOrchestrationResult;
  conflicts: SourceConflictResult;
  approvedSources: KnowledgeSource[];
}

export function validatePostGenerationSourceIntegrity(
  input: ValidateSourceIntegrityInput,
): PostGenerationSourceIntegrityResult {
  const trustBySource = calibrateManySources(input.approvedSources);

  // claimTraceability — average per-claim traceabilityScore, only for claims that need support.
  const traceableClaims = input.traceability.filter((t) => {
    const claim = input.claims.find((c) => c.claimId === t.claimId);
    if (!claim) return false;
    return (
      claim.claimType === 'factual_claim'
      || claim.claimType === 'statistic'
      || claim.claimType === 'benchmark_comparison'
      || claim.claimType === 'market_statement'
      || claim.claimType === 'historical_statement'
      || claim.claimType === 'product_capability_claim'
      || claim.claimType === 'operational_assertion'
    );
  });
  const claimTraceability = clamp100(average(traceableClaims.map((t) => t.claimTraceabilityScore)));

  // citationValidity — average priority of cited items, downweighted by fakes rejected.
  const citationValidity = (() => {
    const priorities = input.citationResult.citationPlan.map((c) => c.priority);
    const avgPriority = priorities.length === 0 ? 0 : average(priorities);
    const fakePenalty = Math.min(60, input.citationResult.rejectedFakeCitations * 10);
    return clamp100(avgPriority - fakePenalty + (priorities.length > 0 ? 15 : 0));
  })();

  // unsupportedSourceDensity (inverted) — ratio of orphan claims among trace-needing claims.
  const orphanCount = traceableClaims.filter((t) => t.isOrphan).length;
  const orphanRatio = traceableClaims.length === 0 ? 0 : orphanCount / traceableClaims.length;
  const unsupportedSourceDensity = clamp100(100 - orphanRatio * 100);

  // weakSourceOverreliance (inverted) — fraction of citations sourced from low/unreliable bands.
  const weakSourceOverreliance = (() => {
    if (input.citationResult.citationPlan.length === 0) return 80;
    const weakCount = input.citationResult.citationPlan.filter((c) => {
      const tr = trustBySource.get(c.sourceId);
      return tr && (tr.sourceReliabilityBand === 'low' || tr.sourceReliabilityBand === 'unreliable');
    }).length;
    const weakRatio = weakCount / input.citationResult.citationPlan.length;
    return clamp100(100 - weakRatio * 100);
  })();

  // staleSourceDensity (inverted) — share of approved sources that are stale.
  const staleSourceDensity = (() => {
    if (input.approvedSources.length === 0) return 100;
    const staleCount = input.approvedSources.filter((s) => s.freshnessMetadata.isStale).length;
    return clamp100(100 - (staleCount / input.approvedSources.length) * 100);
  })();

  // attributionCompleteness — for each citation, did its source carry full attribution?
  const attributionCompleteness = (() => {
    if (input.citationResult.citationPlan.length === 0) return 70; // no citations attempted, neutral
    let totalScore = 0;
    let counted = 0;
    for (const cit of input.citationResult.citationPlan) {
      const src = input.approvedSources.find((s) => s.sourceId === cit.sourceId);
      if (!src) continue;
      let s = 30;
      if (src.title) s += 20;
      if (src.authorOrPublisher) s += 25;
      if (src.freshnessMetadata.publishedAt) s += 15;
      if (src.sourceOrigin) s += 10;
      totalScore += s;
      counted += 1;
    }
    return clamp100(counted === 0 ? 70 : totalScore / counted);
  })();

  // evidenceGroundingQuality — weighted blend of trust band of sources actually used.
  const evidenceGroundingQuality = (() => {
    const usedSourceIds = Array.from(new Set(input.citationResult.citationPlan.map((c) => c.sourceId)));
    if (usedSourceIds.length === 0) {
      // No citations: fall back to grounding profile's source quality, scaled down.
      if (input.approvedSources.length === 0) return 30;
      const avgTrust = average(input.approvedSources.map((s) => trustBySource.get(s.sourceId)?.sourceTrustScore ?? 30));
      return clamp100(avgTrust * 0.65);
    }
    const trustValues = usedSourceIds.map((sid) => trustBySource.get(sid)?.sourceTrustScore ?? 40);
    // Conflict penalty.
    const conflictPenalty = input.conflicts.conflicts.reduce((sum, c) => sum + (c.severity === 'high' ? 8 : c.severity === 'medium' ? 4 : 1), 0);
    return clamp100(average(trustValues) - conflictPenalty);
  })();

  const dimensionScores = {
    claimTraceability,
    citationValidity,
    unsupportedSourceDensity,
    weakSourceOverreliance,
    staleSourceDensity,
    attributionCompleteness,
    evidenceGroundingQuality,
  };

  let weighted = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    weighted += dimensionScores[k] * WEIGHTS[k];
  });
  const sourceIntegrityScore = clamp100(weighted);

  // groundingCoverageScore: distinct dimension reflecting how much of the article
  // is actually backed by sources (vs. unsupported).
  const groundingCoverageScore = clamp100(
    (claimTraceability * 0.45)
    + ((1 - orphanRatio) * 100 * 0.35)
    + (unsupportedSourceDensity * 0.20),
  );

  const citationIntegrityWarnings: string[] = [];
  if (input.citationResult.rejectedFakeCitations > 0) citationIntegrityWarnings.push(`${input.citationResult.rejectedFakeCitations} would-be citation(s) rejected (no eligible source).`);
  for (const w of input.citationResult.weakSourceOveruseWarnings) citationIntegrityWarnings.push(w);
  if (input.conflicts.sourceConflictSeverity === 'high') citationIntegrityWarnings.push(`Source conflict severity is HIGH (${input.conflicts.conflicts.length} conflict(s)).`);
  if (citationValidity < FLOORS.citationValidity) citationIntegrityWarnings.push(`Citation validity ${citationValidity}/${FLOORS.citationValidity} — review citation plan.`);

  const orphanClaims = traceableClaims
    .filter((t) => t.isOrphan)
    .map((t) => {
      const claim = input.claims.find((c) => c.claimId === t.claimId)!;
      return {
        claimId: t.claimId,
        claimText: claim.claimText.slice(0, 200),
        reason: t.orphanReason ?? 'unknown',
      };
    });

  // Weak evidence areas — group orphan claims by topic-ish prefix.
  const weakEvidenceAreas: PostGenerationSourceIntegrityResult['weakEvidenceAreas'] = [];
  const orphansByTopic = new Map<string, { sourceIds: Set<string>; count: number }>();
  for (const o of orphanClaims) {
    const topicHint = o.claimText.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
    const entry = orphansByTopic.get(topicHint) ?? { sourceIds: new Set(), count: 0 };
    entry.count += 1;
    orphansByTopic.set(topicHint, entry);
  }
  for (const [topic, info] of orphansByTopic) {
    if (info.count >= 2) {
      weakEvidenceAreas.push({
        topic,
        sourceIds: [],
        reason: `${info.count} unsupported claims share topic "${topic}".`,
      });
    }
  }

  // Also surface low-trust band concentrations.
  const usedBands = input.citationResult.citationPlan.map((c) => trustBySource.get(c.sourceId)?.sourceReliabilityBand ?? 'unreliable');
  const weakBandCount = usedBands.filter((b) => rankBand(b) <= rankBand('low')).length;
  if (weakBandCount >= 2) {
    weakEvidenceAreas.push({
      topic: 'weak-source dominance',
      sourceIds: input.citationResult.citationPlan
        .filter((c) => {
          const b = trustBySource.get(c.sourceId)?.sourceReliabilityBand;
          return b === 'low' || b === 'unreliable';
        })
        .map((c) => c.sourceId),
      reason: `${weakBandCount} citation(s) drawn from low/unreliable sources.`,
    });
  }

  return {
    sourceIntegrityScore,
    integrityBand: bandFor(sourceIntegrityScore),
    groundingCoverageScore,
    dimensionScores,
    citationIntegrityWarnings,
    orphanClaims,
    weakEvidenceAreas,
  };
}

export { FLOORS as POST_GENERATION_SOURCE_FLOORS };
