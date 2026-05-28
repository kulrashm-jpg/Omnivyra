/**
 * Phase 11 — Cross-modal governance diagnostics aggregator.
 *
 * In-memory per-process registry accumulating cross-modal-pass samples and
 * emitting trend-aware diagnostics across 6 axes:
 *   transformationQualityTrend     avg transformationSuitabilityScore
 *   authorityCompoundingTrend      avg ecosystemAuthorityScore
 *   crossFormatSaturationTrend     avg ecosystemRedundancyPercent (inverted)
 *   narrativeRetentionTrend        avg narrativeRetentionScore
 *   transformationDriftTrend       avg continuity-issue count (inverted)
 *   crossModalNoveltyTrend         avg crossModalNoveltyScore
 */

import type {
  AuthorityCompoundingResult,
  CrossModalCannibalizationResult,
  CrossModalContinuityResult,
  CrossModalEditorialMemoryResult,
  CrossModalGovernanceDiagnostics,
  DiagnosticTrend,
  TransformationSuitabilityResult,
} from './longFormRecommendationTypes';

export interface CrossModalSample {
  timestamp: string;
  companyId: string;
  transformations: TransformationSuitabilityResult[];
  continuities: CrossModalContinuityResult[];
  cannibalization: CrossModalCannibalizationResult;
  editorialMemory: CrossModalEditorialMemoryResult;
  compounding: AuthorityCompoundingResult;
}

export interface CrossModalGovernanceDiagnosticsRegistry {
  record(sample: CrossModalSample): void;
  build(companyId?: string, windowSize?: number): CrossModalGovernanceDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

// Lower is better → invert.
function invertedTrend(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last < first ? 'improving' : 'degrading';
}

export function createCrossModalGovernanceDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): CrossModalGovernanceDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, CrossModalSample[]>();

  function bucket(companyId: string): CrossModalSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): CrossModalSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: CrossModalSample[] = [];
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
          transformationQualityTrend: 'unknown',
          authorityCompoundingTrend: 'unknown',
          crossFormatSaturationTrend: 'unknown',
          narrativeRetentionTrend: 'unknown',
          transformationDriftTrend: 'unknown',
          crossModalNoveltyTrend: 'unknown',
          sampleSize: 0,
        };
      }
      const mid = Math.max(1, Math.floor(sampleSize / 2));
      const firstHalf = samples.slice(0, mid);
      const secondHalf = samples.slice(mid);

      const avgSuitability = (group: CrossModalSample[]) => {
        const all: number[] = [];
        for (const s of group) for (const t of s.transformations) all.push(t.transformationSuitabilityScore);
        return average(all);
      };
      const avgNarrative = (group: CrossModalSample[]) => {
        const all: number[] = [];
        for (const s of group) for (const t of s.transformations) all.push(t.narrativeRetentionScore);
        return average(all);
      };
      const avgIssueCount = (group: CrossModalSample[]) => {
        const all: number[] = [];
        for (const s of group) for (const c of s.continuities) all.push(c.detectedIssues.length);
        return average(all);
      };

      const transformationQualityTrend = trendDirection(avgSuitability(firstHalf), avgSuitability(secondHalf));
      const narrativeRetentionTrend = trendDirection(avgNarrative(firstHalf), avgNarrative(secondHalf));
      const transformationDriftTrend = invertedTrend(avgIssueCount(firstHalf), avgIssueCount(secondHalf), 1);
      const authorityCompoundingTrend = trendDirection(
        average(firstHalf.map((s) => s.compounding.ecosystemAuthorityScore)),
        average(secondHalf.map((s) => s.compounding.ecosystemAuthorityScore)),
      );
      const crossFormatSaturationTrend = invertedTrend(
        average(firstHalf.map((s) => s.cannibalization.ecosystemRedundancyPercent)),
        average(secondHalf.map((s) => s.cannibalization.ecosystemRedundancyPercent)),
      );
      const crossModalNoveltyTrend = trendDirection(
        average(firstHalf.map((s) => s.editorialMemory.crossModalNoveltyScore)),
        average(secondHalf.map((s) => s.editorialMemory.crossModalNoveltyScore)),
      );

      return {
        transformationQualityTrend,
        authorityCompoundingTrend,
        crossFormatSaturationTrend,
        narrativeRetentionTrend,
        transformationDriftTrend,
        crossModalNoveltyTrend,
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

let _defaultRegistry: CrossModalGovernanceDiagnosticsRegistry | null = null;

export function getDefaultCrossModalGovernanceDiagnosticsRegistry(): CrossModalGovernanceDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createCrossModalGovernanceDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultCrossModalGovernanceDiagnosticsRegistry(reg: CrossModalGovernanceDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}
