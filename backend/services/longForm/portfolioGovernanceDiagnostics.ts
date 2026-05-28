/**
 * Phase 12 — Portfolio governance diagnostics aggregator.
 *
 * In-memory per-process registry accumulating portfolio-pass samples and
 * emitting trend-aware diagnostics.
 */

import type {
  AuthorityMap,
  CannibalizationAnalysisResult,
  DiagnosticTrend,
  EditorialNoveltyResult,
  FunnelCoverageResult,
  PortfolioContinuityResult,
  PortfolioGovernanceDiagnostics,
} from './longFormRecommendationTypes';

interface PortfolioSample {
  timestamp: string;
  companyId: string;
  authorityMap: AuthorityMap;
  funnelCoverage: FunnelCoverageResult;
  cannibalization: CannibalizationAnalysisResult;
  continuity: PortfolioContinuityResult;
  memory: EditorialNoveltyResult;
}

export interface PortfolioGovernanceDiagnosticsRegistry {
  record(sample: PortfolioSample): void;
  build(companyId?: string, windowSize?: number): PortfolioGovernanceDiagnostics;
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

export function createPortfolioGovernanceDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): PortfolioGovernanceDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, PortfolioSample[]>();

  function bucket(companyId: string): PortfolioSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): PortfolioSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: PortfolioSample[] = [];
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
          authorityCoverageTrend: 'unknown',
          saturationTrend: 'unknown',
          cannibalizationFrequencyPercent: 0,
          portfolioFreshnessTrend: 'unknown',
          funnelCoverageEvolutionTrend: 'unknown',
          ecosystemCoherenceTrend: 'unknown',
          narrativeFatigueTrend: 'unknown',
          sampleSize: 0,
        };
      }

      let cannibalizationHits = 0;
      for (const s of samples) {
        if (s.cannibalization.clusters.length > 0) cannibalizationHits += 1;
      }

      const mid = Math.max(1, Math.floor(samples.length / 2));
      const authFirst = average(samples.slice(0, mid).map((s) => s.authorityMap.totalCoverage));
      const authLast = average(samples.slice(mid).map((s) => s.authorityMap.totalCoverage));
      const satFirst = average(samples.slice(0, mid).map((s) => s.authorityMap.oversaturatedAreas.length));
      const satLast = average(samples.slice(mid).map((s) => s.authorityMap.oversaturatedAreas.length));
      const freshFirst = average(samples.slice(0, mid).map((s) => s.memory.strategicFreshnessScore));
      const freshLast = average(samples.slice(mid).map((s) => s.memory.strategicFreshnessScore));
      const funnelDiversityFirst = average(samples.slice(0, mid).map((s) => 100 - Math.abs(s.funnelCoverage.tofuShare - 0.35) * 100 - Math.abs(s.funnelCoverage.mofuShare - 0.40) * 100 - Math.abs(s.funnelCoverage.bofuShare - 0.25) * 100));
      const funnelDiversityLast = average(samples.slice(mid).map((s) => 100 - Math.abs(s.funnelCoverage.tofuShare - 0.35) * 100 - Math.abs(s.funnelCoverage.mofuShare - 0.40) * 100 - Math.abs(s.funnelCoverage.bofuShare - 0.25) * 100));
      const coherenceFirst = average(samples.slice(0, mid).map((s) => s.continuity.ecosystemCoherenceScore));
      const coherenceLast = average(samples.slice(mid).map((s) => s.continuity.ecosystemCoherenceScore));
      const fatigueFirst = average(samples.slice(0, mid).map((s) => s.memory.fatiguedTerminology.length));
      const fatigueLast = average(samples.slice(mid).map((s) => s.memory.fatiguedTerminology.length));

      return {
        authorityCoverageTrend: trendDirection(authFirst, authLast),
        // Rising saturation = bad → invert direction.
        saturationTrend: trendDirection(satLast, satFirst),
        cannibalizationFrequencyPercent: Math.round((cannibalizationHits / sampleSize) * 100),
        portfolioFreshnessTrend: trendDirection(freshFirst, freshLast),
        funnelCoverageEvolutionTrend: trendDirection(funnelDiversityFirst, funnelDiversityLast),
        ecosystemCoherenceTrend: trendDirection(coherenceFirst, coherenceLast),
        // Rising fatigue = bad → invert direction.
        narrativeFatigueTrend: trendDirection(fatigueLast, fatigueFirst),
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

let _defaultRegistry: PortfolioGovernanceDiagnosticsRegistry | null = null;

export function getDefaultPortfolioGovernanceDiagnosticsRegistry(): PortfolioGovernanceDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createPortfolioGovernanceDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultPortfolioGovernanceDiagnosticsRegistry(reg: PortfolioGovernanceDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}

export type { PortfolioSample };
