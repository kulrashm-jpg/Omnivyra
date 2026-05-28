/**
 * Phase 13.10 — Cross-modal operational diagnostics aggregator.
 *
 * Aggregates samples emitted by the production operationalization layer
 * and produces 6 trend axes + 3 absolute metrics:
 *   chainHealthEvolutionTrend           avg ChainHealthResult.chainHealthScore
 *   adaptationStabilityTrend            avg EffectiveTransformationProfile.adaptationStabilityScore
 *   semanticConfidenceTrend             avg SemanticConfidenceResult.semanticConfidenceScore
 *   recoveryCooldownFrequencyPercent    fraction of ticks with cooldownActive
 *   lineageReplayIntegrityScore         avg SnapshotIntegrityResult.snapshotIntegrityScore
 *   branchExplosionSuppressionCount     total safety detections of type branch_explosion
 *   ecosystemRecomputationCostMsAvg     mean tick recomputation cost
 */

import type {
  ChainHealthResult,
  CrossModalOperationalDiagnostics,
  CrossModalSafetyResult,
  DiagnosticTrend,
  EcosystemCoherenceTickResult,
  EffectiveTransformationProfile,
  GovernanceStabilityResult,
  SemanticConfidenceResult,
  SnapshotIntegrityResult,
} from './longFormRecommendationTypes';

export interface CrossModalOperationalSample {
  timestamp: string;
  companyId: string;
  chainHealth?: ChainHealthResult;
  effective?: EffectiveTransformationProfile;
  semanticConfidence?: SemanticConfidenceResult;
  stabilization?: GovernanceStabilityResult;
  ecosystemTick?: EcosystemCoherenceTickResult;
  safety?: CrossModalSafetyResult;
  snapshotIntegrity?: SnapshotIntegrityResult;
  /** wall-clock ms attributable to the cross-modal recomputation in this tick. */
  recomputationCostMs?: number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function trendDirection(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

export interface CrossModalOperationalDiagnosticsRegistry {
  record(sample: CrossModalOperationalSample): void;
  build(companyId?: string, windowSize?: number): CrossModalOperationalDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export function createCrossModalOperationalDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): CrossModalOperationalDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, CrossModalOperationalSample[]>();

  function bucket(companyId: string): CrossModalOperationalSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }
  function allSamples(companyId?: string): CrossModalOperationalSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: CrossModalOperationalSample[] = [];
    buckets.forEach((b) => out.push(...b));
    return out;
  }

  return {
    record(sample) {
      const b = bucket(sample.companyId);
      b.push(sample);
      while (b.length > capacity) b.shift();
    },
    build(companyId, windowSize = 50) {
      const samples = allSamples(companyId).slice(-windowSize);
      const sampleSize = samples.length;
      if (sampleSize === 0) {
        return {
          chainHealthEvolutionTrend: 'unknown',
          adaptationStabilityTrend: 'unknown',
          semanticConfidenceTrend: 'unknown',
          recoveryCooldownFrequencyPercent: 0,
          lineageReplayIntegrityScore: 0,
          branchExplosionSuppressionCount: 0,
          ecosystemRecomputationCostMsAvg: 0,
          sampleSize: 0,
        };
      }
      const mid = Math.max(1, Math.floor(sampleSize / 2));
      const first = samples.slice(0, mid);
      const second = samples.slice(mid);

      const chainHealthFirst = avg(first.filter((s) => s.chainHealth).map((s) => s.chainHealth!.chainHealthScore));
      const chainHealthLast = avg(second.filter((s) => s.chainHealth).map((s) => s.chainHealth!.chainHealthScore));
      const chainHealthEvolutionTrend = trendDirection(chainHealthFirst, chainHealthLast);

      const stabFirst = avg(first.filter((s) => s.effective).map((s) => s.effective!.adaptationStabilityScore));
      const stabLast = avg(second.filter((s) => s.effective).map((s) => s.effective!.adaptationStabilityScore));
      const adaptationStabilityTrend = trendDirection(stabFirst, stabLast);

      const semFirst = avg(first.filter((s) => s.semanticConfidence).map((s) => s.semanticConfidence!.semanticConfidenceScore));
      const semLast = avg(second.filter((s) => s.semanticConfidence).map((s) => s.semanticConfidence!.semanticConfidenceScore));
      const semanticConfidenceTrend = trendDirection(semFirst, semLast);

      const cooldownActiveCount = samples.filter((s) => s.stabilization?.cooldownActive).length;
      const recoveryCooldownFrequencyPercent = Math.round((cooldownActiveCount / sampleSize) * 100);

      const integrities = samples.filter((s) => s.snapshotIntegrity).map((s) => s.snapshotIntegrity!.snapshotIntegrityScore);
      const lineageReplayIntegrityScore = integrities.length === 0 ? 0 : Math.round(avg(integrities));

      let branchExplosionSuppressionCount = 0;
      for (const s of samples) {
        if (!s.safety) continue;
        for (const d of s.safety.recursiveTransformationDetections) {
          if (d.type === 'branch_explosion') branchExplosionSuppressionCount += 1;
        }
      }

      const recomputeCosts = samples
        .filter((s) => typeof s.recomputationCostMs === 'number')
        .map((s) => s.recomputationCostMs!);
      const ecosystemRecomputationCostMsAvg = recomputeCosts.length === 0 ? 0 : Math.round(avg(recomputeCosts));

      return {
        chainHealthEvolutionTrend,
        adaptationStabilityTrend,
        semanticConfidenceTrend,
        recoveryCooldownFrequencyPercent,
        lineageReplayIntegrityScore,
        branchExplosionSuppressionCount,
        ecosystemRecomputationCostMsAvg,
        sampleSize,
      };
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _default: CrossModalOperationalDiagnosticsRegistry | null = null;
export function getDefaultCrossModalOperationalDiagnosticsRegistry(): CrossModalOperationalDiagnosticsRegistry {
  if (!_default) _default = createCrossModalOperationalDiagnosticsRegistry();
  return _default;
}
export function setDefaultCrossModalOperationalDiagnosticsRegistry(r: CrossModalOperationalDiagnosticsRegistry): void {
  _default = r;
}
