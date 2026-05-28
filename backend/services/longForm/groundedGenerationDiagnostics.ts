/**
 * Phase 12 — Grounded generation diagnostics aggregator.
 *
 * In-memory per-process registry accumulating per-run grounded-integrity
 * samples and emitting trend-aware diagnostics.
 */

import type {
  DiagnosticTrend,
  GroundedGenerationDiagnostics,
  PostGenerationSourceIntegrityResult,
  RetrievalGroundingProfile,
  SourceConflictResult,
  SourceReliabilityBand,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

const BANDS: SourceReliabilityBand[] = ['unreliable', 'low', 'moderate', 'high', 'exceptional'];

interface GroundedSample {
  timestamp: string;
  companyId: string;
  profile: RetrievalGroundingProfile;
  integrity: PostGenerationSourceIntegrityResult;
  conflicts: SourceConflictResult;
}

export interface GroundedGenerationDiagnosticsRegistry {
  record(sample: GroundedSample): void;
  build(companyId?: string, windowSize?: number): GroundedGenerationDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function emptyTrustDist(): Record<SourceReliabilityBand, number> {
  const d = {} as Record<SourceReliabilityBand, number>;
  for (const b of BANDS) d[b] = 0;
  return d;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trendDirection(first: number, last: number, threshold = 4): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

export function createGroundedGenerationDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): GroundedGenerationDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, GroundedSample[]>();

  function bucket(companyId: string): GroundedSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): GroundedSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: GroundedSample[] = [];
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
          sourceTrustDistribution: emptyTrustDist(),
          orphanClaimDensity: 0,
          citationIntegrityTrend: 'unknown',
          sourceConflictFrequencyPercent: 0,
          staleSourceUsageTrend: 'unknown',
          groundingCoverageTrend: 'unknown',
          evidenceQualityTrend: 'unknown',
          sampleSize: 0,
        };
      }

      const sourceTrustDistribution = emptyTrustDist();
      let totalOrphanCount = 0;
      let totalArticleCount = sampleSize;
      let conflictHits = 0;

      for (const s of samples) {
        const trustResults = calibrateManySources(s.profile.approvedSources);
        for (const tr of trustResults.values()) {
          sourceTrustDistribution[tr.sourceReliabilityBand] += 1;
        }
        totalOrphanCount += s.integrity.orphanClaims.length;
        if (s.conflicts.conflicts.length > 0) conflictHits += 1;
      }

      const mid = Math.max(1, Math.floor(samples.length / 2));
      const citationFirst = average(samples.slice(0, mid).map((s) => s.integrity.dimensionScores.citationValidity));
      const citationLast = average(samples.slice(mid).map((s) => s.integrity.dimensionScores.citationValidity));
      const staleFirst = average(samples.slice(0, mid).map((s) => 100 - s.integrity.dimensionScores.staleSourceDensity));
      const staleLast = average(samples.slice(mid).map((s) => 100 - s.integrity.dimensionScores.staleSourceDensity));
      const groundingFirst = average(samples.slice(0, mid).map((s) => s.integrity.groundingCoverageScore));
      const groundingLast = average(samples.slice(mid).map((s) => s.integrity.groundingCoverageScore));
      const qualityFirst = average(samples.slice(0, mid).map((s) => s.integrity.dimensionScores.evidenceGroundingQuality));
      const qualityLast = average(samples.slice(mid).map((s) => s.integrity.dimensionScores.evidenceGroundingQuality));

      return {
        sourceTrustDistribution,
        orphanClaimDensity: Number((totalOrphanCount / totalArticleCount).toFixed(2)),
        citationIntegrityTrend: trendDirection(citationFirst, citationLast),
        sourceConflictFrequencyPercent: Math.round((conflictHits / sampleSize) * 100),
        // staleSourceUsage rising-is-bad → invert
        staleSourceUsageTrend: trendDirection(staleLast, staleFirst),
        groundingCoverageTrend: trendDirection(groundingFirst, groundingLast),
        evidenceQualityTrend: trendDirection(qualityFirst, qualityLast),
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

let _defaultRegistry: GroundedGenerationDiagnosticsRegistry | null = null;

export function getDefaultGroundedGenerationDiagnosticsRegistry(): GroundedGenerationDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createGroundedGenerationDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultGroundedGenerationDiagnosticsRegistry(reg: GroundedGenerationDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}

export type { GroundedSample };
