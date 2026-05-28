/**
 * Phase 6 + 11 — Live execution diagnostics + fleet observability.
 *
 * `buildLiveExecutionDiagnostics` runs over the per-section results captured
 * during a SINGLE generation run. `createGenerationExecutionObservability`
 * accumulates samples across MANY runs for fleet-level observability.
 */

import type {
  DiagnosticTrend,
  GenerationExecutionDiagnostics,
  GenerationExecutionObservability,
  PostGenerationIntegrityResult,
  SectionContinuityResult,
  SectionRecoveryHistoryEntry,
} from './longFormRecommendationTypes';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 4): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

function pressureTrend(first: number, last: number, threshold = 4): 'rising' | 'stable' | 'falling' | 'unknown' {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'rising' : 'falling';
}

// ────────────────────────────────────────────────────────────────────────────
// Per-run diagnostics
// ────────────────────────────────────────────────────────────────────────────

export interface LiveExecutionInput {
  sectionResults: SectionContinuityResult[];
  sectionGenericityScores: number[];
  recoveryHistory: SectionRecoveryHistoryEntry[];
  sectionsFailed: number;
}

export function buildLiveExecutionDiagnostics(input: LiveExecutionInput): GenerationExecutionDiagnostics {
  const sectionsGenerated = input.sectionResults.length;
  const sectionsValidated = input.sectionResults.length - input.sectionsFailed;
  const sectionsRecovered = new Set(input.recoveryHistory.map((h) => h.sectionIndex)).size;
  const regenerationCount = input.recoveryHistory.filter((h) => h.action === 'regenerate_section').length;

  const continuityVals = input.sectionResults.map((s) => s.sectionContinuityScore);
  const strategicVals = input.sectionResults.map((s) => s.sectionStrategicIntegrityScore);
  const operationalVals = input.sectionResults.map((s) => s.sectionOperationalIntegrityScore);
  const terminologyVals = input.sectionResults.map((s) => s.signals.terminologyIntegrity);
  const genericityVals = input.sectionGenericityScores;

  const averageContinuity = Math.round(average(continuityVals));
  const averageStrategic = Math.round(average(strategicVals));
  const averageOperational = Math.round(average(operationalVals));
  const averageTerminologyPreservation = Math.round(average(terminologyVals));
  const averageGenericityPressure = Math.round(average(genericityVals));

  const mid = Math.max(1, Math.floor(sectionsGenerated / 2));
  const fh = (arr: number[]) => arr.slice(0, mid);
  const sh = (arr: number[]) => arr.slice(mid);

  const continuityDegradationTrend = trendDirection(average(fh(continuityVals)), average(sh(continuityVals)));
  const operationalDepthTrend = trendDirection(average(fh(operationalVals)), average(sh(operationalVals)));
  const terminologyPreservationTrend = trendDirection(average(fh(terminologyVals)), average(sh(terminologyVals)));
  const genericityPressureTrend = pressureTrend(average(fh(genericityVals)), average(sh(genericityVals)));

  // Section coherence trend: variance across sections — rising variance = degrading coherence.
  // Approximate by trend of strategic scores.
  const sectionCoherenceTrend = trendDirection(average(fh(strategicVals)), average(sh(strategicVals)));

  const recoveryFrequency = sectionsGenerated === 0 ? 0
    : Math.round((sectionsRecovered / sectionsGenerated) * 100);
  const regenerationFrequency = sectionsGenerated === 0 ? 0
    : Math.round((regenerationCount / sectionsGenerated) * 100);

  const riskProfile: 'low' | 'medium' | 'high' = (() => {
    if (input.sectionsFailed > 0 || averageContinuity < 50 || averageGenericityPressure > 55) return 'high';
    if (averageContinuity < 65 || averageGenericityPressure > 35 || recoveryFrequency > 40) return 'medium';
    return 'low';
  })();

  return {
    sectionsGenerated,
    sectionsValidated,
    sectionsRecovered,
    sectionsFailed: input.sectionsFailed,
    regenerationCount,
    averageContinuity,
    averageStrategic,
    averageOperational,
    averageTerminologyPreservation,
    averageGenericityPressure,
    continuityDegradationTrend,
    operationalDepthTrend,
    terminologyPreservationTrend,
    genericityPressureTrend,
    sectionCoherenceTrend,
    recoveryFrequency,
    regenerationFrequency,
    generationExecutionRiskProfile: riskProfile,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fleet-level observability
// ────────────────────────────────────────────────────────────────────────────

interface ObservabilitySample {
  timestamp: string;
  companyId: string;
  diagnostics: GenerationExecutionDiagnostics;
  integrity: PostGenerationIntegrityResult;
}

export interface GenerationExecutionObservabilityRegistry {
  record(sample: ObservabilitySample): void;
  build(companyId?: string, windowSize?: number): GenerationExecutionObservability;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function emptyIntegrityDist() {
  return { failed: 0, weak: 0, acceptable: 0, strong: 0, exceptional: 0 };
}

export function createGenerationExecutionObservabilityRegistry(options?: {
  maxSamplesPerCompany?: number;
}): GenerationExecutionObservabilityRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, ObservabilitySample[]>();

  function bucket(companyId: string): ObservabilitySample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): ObservabilitySample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: ObservabilitySample[] = [];
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
          sectionIntegrityDistribution: emptyIntegrityDist(),
          recoveryEffectiveness: { successful: 0, total: 0, ratio: 0 },
          regenerationRatePercent: 0,
          genericitySuppressionRatePercent: 0,
          operationalContinuityTrend: 'unknown',
          terminologyPreservationTrend: 'unknown',
          sectionDriftFrequencyPercent: 0,
          articleIntegrityTrend: 'unknown',
          executionStabilityProfile: 'low',
          sampleSize: 0,
        };
      }

      const integrityDist = emptyIntegrityDist();
      let regenSum = 0, genericityHits = 0, totalRecoveryAttempts = 0, successfulRecoveries = 0;
      let driftHits = 0;
      for (const s of samples) {
        integrityDist[s.integrity.integrityBand] += 1;
        regenSum += s.diagnostics.regenerationFrequency;
        if (s.diagnostics.averageGenericityPressure >= 40) genericityHits += 1;
        totalRecoveryAttempts += s.diagnostics.sectionsRecovered;
        // Approximate successful recoveries as those that yielded acceptable+ integrity.
        if (s.diagnostics.sectionsRecovered > 0 && s.integrity.integrityBand !== 'failed' && s.integrity.integrityBand !== 'weak') {
          successfulRecoveries += s.diagnostics.sectionsRecovered;
        }
        if (s.diagnostics.continuityDegradationTrend === 'degrading') driftHits += 1;
      }

      const mid = Math.max(1, Math.floor(samples.length / 2));
      const operationalFirst = average(samples.slice(0, mid).map((s) => s.diagnostics.averageOperational));
      const operationalLast = average(samples.slice(mid).map((s) => s.diagnostics.averageOperational));
      const terminologyFirst = average(samples.slice(0, mid).map((s) => s.diagnostics.averageTerminologyPreservation));
      const terminologyLast = average(samples.slice(mid).map((s) => s.diagnostics.averageTerminologyPreservation));
      const integrityFirst = average(samples.slice(0, mid).map((s) => s.integrity.postGenerationIntegrityScore));
      const integrityLast = average(samples.slice(mid).map((s) => s.integrity.postGenerationIntegrityScore));

      const operationalContinuityTrend = trendDirection(operationalFirst, operationalLast);
      const terminologyPreservationTrend = trendDirection(terminologyFirst, terminologyLast);
      const articleIntegrityTrend = trendDirection(integrityFirst, integrityLast);

      const blockedShare = integrityDist.failed / sampleSize;
      const weakShare = integrityDist.weak / sampleSize;

      const executionStabilityProfile: 'low' | 'medium' | 'high' = (() => {
        if (blockedShare > 0.20 || articleIntegrityTrend === 'degrading') return 'high';
        if (blockedShare > 0.05 || weakShare > 0.30) return 'medium';
        return 'low';
      })();

      return {
        sectionIntegrityDistribution: integrityDist,
        recoveryEffectiveness: {
          successful: successfulRecoveries,
          total: totalRecoveryAttempts,
          ratio: totalRecoveryAttempts === 0 ? 0 : Number((successfulRecoveries / totalRecoveryAttempts).toFixed(2)),
        },
        regenerationRatePercent: Math.round(regenSum / sampleSize),
        genericitySuppressionRatePercent: Math.round((genericityHits / sampleSize) * 100),
        operationalContinuityTrend,
        terminologyPreservationTrend,
        sectionDriftFrequencyPercent: Math.round((driftHits / sampleSize) * 100),
        articleIntegrityTrend,
        executionStabilityProfile,
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

let _defaultRegistry: GenerationExecutionObservabilityRegistry | null = null;

export function getDefaultGenerationExecutionObservabilityRegistry(): GenerationExecutionObservabilityRegistry {
  if (!_defaultRegistry) _defaultRegistry = createGenerationExecutionObservabilityRegistry();
  return _defaultRegistry;
}

export function setDefaultGenerationExecutionObservabilityRegistry(reg: GenerationExecutionObservabilityRegistry): void {
  _defaultRegistry = reg;
}

export type { ObservabilitySample };
