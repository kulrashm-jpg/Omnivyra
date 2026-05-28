/**
 * Phase 13 — Factual governance diagnostics aggregator.
 *
 * In-memory per-process registry that accumulates factual-integrity samples
 * across runs and emits trend-aware diagnostics.
 */

import type {
  DiagnosticTrend,
  FactualGovernanceDiagnostics,
  FactualRecoveryAction,
  PostGenerationFactualResult,
} from './longFormRecommendationTypes';

interface FactualSample {
  timestamp: string;
  companyId: string;
  factual: PostGenerationFactualResult;
  recoveryActions: FactualRecoveryAction[];
  softenedCount: number;
  removedFabricationsCount: number;
}

export interface FactualGovernanceDiagnosticsRegistry {
  record(sample: FactualSample): void;
  build(companyId?: string, windowSize?: number): FactualGovernanceDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 4): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

export function createFactualGovernanceDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): FactualGovernanceDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, FactualSample[]>();

  function bucket(companyId: string): FactualSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): FactualSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: FactualSample[] = [];
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
          hallucinationFrequencyPercent: 0,
          unsupportedClaimDensity: 0,
          certaintySofteningFrequencyPercent: 0,
          evidenceCoverageTrend: 'unknown',
          authorityInflationTrend: 'unknown',
          trustCalibrationTrend: 'unknown',
          factualRecoveryEffectivenessPercent: 0,
          sampleSize: 0,
        };
      }

      let hallucinationHits = 0;
      let unsupportedSum = 0;
      let softenedHits = 0;
      let recoveryAttempts = 0;
      let recoverySuccesses = 0;
      for (const s of samples) {
        if (s.factual.hallucinationRiskBand === 'high' || s.factual.hallucinationRiskBand === 'critical') hallucinationHits += 1;
        unsupportedSum += s.factual.unsupportedClaims.length;
        if (s.softenedCount > 0) softenedHits += 1;
        if (s.recoveryActions.length > 0) {
          recoveryAttempts += 1;
          if (
            s.factual.hallucinationRiskBand !== 'critical'
            && s.factual.hallucinationRiskBand !== 'high'
          ) recoverySuccesses += 1;
        }
      }

      const mid = Math.max(1, Math.floor(samples.length / 2));
      const evidenceFirst = average(samples.slice(0, mid).map((s) => s.factual.dimensionScores.evidenceCoverage));
      const evidenceLast = average(samples.slice(mid).map((s) => s.factual.dimensionScores.evidenceCoverage));
      const authorityFirst = average(samples.slice(0, mid).map((s) => 100 - s.factual.dimensionScores.authorityCalibration));
      const authorityLast = average(samples.slice(mid).map((s) => 100 - s.factual.dimensionScores.authorityCalibration));
      const trustFirst = average(samples.slice(0, mid).map((s) => s.factual.factualIntegrityScore));
      const trustLast = average(samples.slice(mid).map((s) => s.factual.factualIntegrityScore));

      return {
        hallucinationFrequencyPercent: Math.round((hallucinationHits / sampleSize) * 100),
        unsupportedClaimDensity: Number((unsupportedSum / sampleSize).toFixed(2)),
        certaintySofteningFrequencyPercent: Math.round((softenedHits / sampleSize) * 100),
        evidenceCoverageTrend: trendDirection(evidenceFirst, evidenceLast),
        // For authority inflation: rising-is-bad → invert into trend.
        authorityInflationTrend: trendDirection(authorityLast, authorityFirst),
        trustCalibrationTrend: trendDirection(trustFirst, trustLast),
        factualRecoveryEffectivenessPercent: recoveryAttempts === 0
          ? 0
          : Math.round((recoverySuccesses / recoveryAttempts) * 100),
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

let _defaultRegistry: FactualGovernanceDiagnosticsRegistry | null = null;

export function getDefaultFactualGovernanceDiagnosticsRegistry(): FactualGovernanceDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createFactualGovernanceDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultFactualGovernanceDiagnosticsRegistry(reg: FactualGovernanceDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}

export type { FactualSample };
