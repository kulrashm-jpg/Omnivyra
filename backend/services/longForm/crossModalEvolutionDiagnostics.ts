/**
 * Phase 12.10 — Cross-modal evolution diagnostics aggregator.
 *
 * In-memory per-process registry that accumulates hardened cross-modal
 * passes and emits 7 trend axes:
 *   chainDriftTrend                      avg chainContinuityScore (drift = inverted)
 *   semanticDuplicationTrend             avg semanticSimilarityScore across recent pairs
 *   fatigueEvolutionTrend                avg transformationFatigueScore (inverted)
 *   ecosystemCoherenceTrend              avg ecosystemCoherenceScore
 *   transformationSequenceQualityTrend   avg topRecommendation forecast
 *   adaptiveScoringEvolutionTrend        adaptiveTransformationConfidence
 *   multiHopDegradationTrend             avg cumulative authority retention (inverted)
 */

import type {
  AdaptiveTransformationProfile,
  CrossModalEvolutionDiagnostics,
  DiagnosticTrend,
  EcosystemNarrativeResult,
  MultiHopContinuityResult,
  SemanticSimilarityResult,
  StrategicSequencingResult,
  TransformationFatigueResult,
} from './longFormRecommendationTypes';

export interface CrossModalEvolutionSample {
  timestamp: string;
  companyId: string;
  multiHop?: MultiHopContinuityResult;
  fatigue?: TransformationFatigueResult;
  ecosystem?: EcosystemNarrativeResult;
  sequencing?: StrategicSequencingResult;
  adaptive?: AdaptiveTransformationProfile;
  /** semantic pair-similarity averages observed this sample, if any. */
  semanticPairSimilarities?: SemanticSimilarityResult[];
}

export interface CrossModalEvolutionDiagnosticsRegistry {
  record(sample: CrossModalEvolutionSample): void;
  build(companyId?: string, windowSize?: number): CrossModalEvolutionDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function trendDirection(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}
function invertedTrend(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last < first ? 'improving' : 'degrading';
}

function reduceSemantic(samples: CrossModalEvolutionSample[]): number[] {
  const out: number[] = [];
  for (const s of samples) {
    const list = s.semanticPairSimilarities ?? [];
    if (list.length === 0) continue;
    out.push(avg(list.map((r) => r.semanticTransformationSimilarityScore)));
  }
  return out;
}

export function createCrossModalEvolutionDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): CrossModalEvolutionDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, CrossModalEvolutionSample[]>();

  function bucket(companyId: string): CrossModalEvolutionSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }
  function allSamples(companyId?: string): CrossModalEvolutionSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: CrossModalEvolutionSample[] = [];
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
          chainDriftTrend: 'unknown',
          semanticDuplicationTrend: 'unknown',
          fatigueEvolutionTrend: 'unknown',
          ecosystemCoherenceTrend: 'unknown',
          transformationSequenceQualityTrend: 'unknown',
          adaptiveScoringEvolutionTrend: 'unknown',
          multiHopDegradationTrend: 'unknown',
          sampleSize: 0,
        };
      }
      const mid = Math.max(1, Math.floor(sampleSize / 2));
      const first = samples.slice(0, mid);
      const second = samples.slice(mid);

      // 1. chain drift — high chainContinuityScore is good.
      const chainScoreFn = (group: CrossModalEvolutionSample[]) =>
        avg(group.filter((s) => s.multiHop).map((s) => s.multiHop!.chainContinuityScore));
      const chainDriftTrend = trendDirection(chainScoreFn(first), chainScoreFn(second));

      // 2. semantic duplication — high similarity is bad → inverted.
      const semFirst = reduceSemantic(first);
      const semLast = reduceSemantic(second);
      const semanticDuplicationTrend = semFirst.length === 0 && semLast.length === 0
        ? 'unknown'
        : invertedTrend(avg(semFirst), avg(semLast));

      // 3. fatigue — higher is worse → inverted.
      const fatigueFn = (group: CrossModalEvolutionSample[]) =>
        avg(group.filter((s) => s.fatigue).map((s) => s.fatigue!.transformationFatigueScore));
      const fatigueEvolutionTrend = invertedTrend(fatigueFn(first), fatigueFn(second));

      // 4. ecosystem coherence — higher is better.
      const ecoFn = (group: CrossModalEvolutionSample[]) =>
        avg(group.filter((s) => s.ecosystem).map((s) => s.ecosystem!.ecosystemCoherenceScore));
      const ecosystemCoherenceTrend = trendDirection(ecoFn(first), ecoFn(second));

      // 5. transformation sequence quality — average top forecast.
      const seqFn = (group: CrossModalEvolutionSample[]) =>
        avg(group
          .filter((s) => s.sequencing?.topRecommendation)
          .map((s) => s.sequencing!.topRecommendation!.ecosystemContributionForecast));
      const transformationSequenceQualityTrend = trendDirection(seqFn(first), seqFn(second));

      // 6. adaptive scoring evolution — confidence as a proxy.
      const adaptFn = (group: CrossModalEvolutionSample[]) =>
        avg(group.filter((s) => s.adaptive).map((s) => s.adaptive!.adaptiveTransformationConfidence));
      const adaptiveScoringEvolutionTrend = trendDirection(adaptFn(first), adaptFn(second));

      // 7. multi-hop degradation — cumulative authority retention (lower = worse → inverted).
      const cumAuthFn = (group: CrossModalEvolutionSample[]) =>
        avg(group.filter((s) => s.multiHop).map((s) => s.multiHop!.cumulativeAuthorityRetention));
      const multiHopDegradationTrend = trendDirection(cumAuthFn(first), cumAuthFn(second));

      return {
        chainDriftTrend,
        semanticDuplicationTrend: semanticDuplicationTrend as DiagnosticTrend,
        fatigueEvolutionTrend,
        ecosystemCoherenceTrend,
        transformationSequenceQualityTrend,
        adaptiveScoringEvolutionTrend,
        multiHopDegradationTrend,
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

let _defaultRegistry: CrossModalEvolutionDiagnosticsRegistry | null = null;

export function getDefaultCrossModalEvolutionDiagnosticsRegistry(): CrossModalEvolutionDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createCrossModalEvolutionDiagnosticsRegistry();
  return _defaultRegistry;
}
export function setDefaultCrossModalEvolutionDiagnosticsRegistry(reg: CrossModalEvolutionDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}
