/**
 * Phase 9 — Generation preparation diagnostics aggregator.
 *
 * Walks a window of recent orchestration results to surface:
 *   • readiness distribution
 *   • gating frequency (executed / warned / blocked)
 *   • recovery success likelihood distribution
 *   • continuity / integrity trends (slope vs first half of window)
 *   • planner drift frequency
 *   • execution risk profile
 *
 * Storage is in-memory (per-process). Like the upstream lifecycle registry,
 * persistence is intentionally out of scope for this phase.
 */

import type {
  DiagnosticTrend,
  GenerationGateDecision,
  GenerationPreparationDiagnostics,
  GenerationReadinessAssessment,
  GenerationReadinessBand,
  PlannerGenerationContinuityResult,
  RecoveryAttemptPlan,
  RecoveryRecommendationItem,
} from './longFormRecommendationTypes';

const READINESS_BANDS: GenerationReadinessBand[] = ['blocked', 'weak', 'acceptable', 'strong', 'exceptional'];

function emptyReadinessDist(): Record<GenerationReadinessBand, number> {
  const d = {} as Record<GenerationReadinessBand, number>;
  for (const b of READINESS_BANDS) d[b] = 0;
  return d;
}

// ────────────────────────────────────────────────────────────────────────────
// Sample storage
// ────────────────────────────────────────────────────────────────────────────

interface DiagnosticsSample {
  timestamp: string;
  companyId: string;
  readiness: GenerationReadinessAssessment;
  gate: GenerationGateDecision;
  plannerContinuity: PlannerGenerationContinuityResult;
  recoveryRecommendations: RecoveryRecommendationItem[];
  recoveryAttemptPlan: RecoveryAttemptPlan;
}

export interface GenerationPreparationDiagnosticsRegistry {
  record(sample: DiagnosticsSample): void;
  build(companyId?: string, windowSize?: number): GenerationPreparationDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function trendDirection(first: number, last: number): DiagnosticTrend {
  if (Math.abs(last - first) < 4) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

function executionRiskProfile(
  blockedShare: number,
  warnedShare: number,
  continuityTrend: DiagnosticTrend,
): 'low' | 'medium' | 'high' {
  if (blockedShare > 0.30 || continuityTrend === 'degrading') return 'high';
  if (blockedShare > 0.10 || warnedShare > 0.40) return 'medium';
  return 'low';
}

export function createGenerationPreparationDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): GenerationPreparationDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, DiagnosticsSample[]>();

  function bucket(companyId: string): DiagnosticsSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): DiagnosticsSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: DiagnosticsSample[] = [];
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
      let samples = allSamples(companyId);
      samples = samples.slice(-windowSize);
      const sampleSize = samples.length;
      if (sampleSize === 0) {
        return {
          readinessDistribution: emptyReadinessDist(),
          gatingFrequency: { executed: 0, warned: 0, blocked: 0 },
          recoverySuccessLikelihood: { low: 0, medium: 0, high: 0 },
          continuityDegradationTrend: 'unknown',
          plannerDriftFrequency: 0,
          strategicIntegrityTrend: 'unknown',
          operationalIntegrityTrend: 'unknown',
          executionRiskProfile: 'low',
          sampleSize: 0,
        };
      }

      const readinessDistribution = emptyReadinessDist();
      const gatingFrequency = { executed: 0, warned: 0, blocked: 0 };
      const recoverySuccessLikelihood = { low: 0, medium: 0, high: 0 };
      let plannerDriftCount = 0;

      for (const s of samples) {
        readinessDistribution[s.readiness.readinessBand] += 1;
        if (s.gate.decision === 'execute') gatingFrequency.executed += 1;
        else if (s.gate.decision === 'warn') gatingFrequency.warned += 1;
        else gatingFrequency.blocked += 1;
        if (s.plannerContinuity.detections.some((d) => d.severity === 'high' || d.severity === 'medium')) {
          plannerDriftCount += 1;
        }
        for (const r of s.recoveryRecommendations) {
          recoverySuccessLikelihood[r.estimatedLikelihoodOfSuccess] += 1;
        }
      }

      // Trends: compare averages of first half vs second half of window.
      const mid = Math.max(1, Math.floor(samples.length / 2));
      const firstHalf = samples.slice(0, mid);
      const secondHalf = samples.slice(mid);

      function avg(arr: DiagnosticsSample[], extractor: (s: DiagnosticsSample) => number): number {
        if (arr.length === 0) return 0;
        return arr.reduce((sum, s) => sum + extractor(s), 0) / arr.length;
      }

      const continuityFirst = avg(firstHalf, (s) => s.readiness.dimensionScores.continuityIntegrity);
      const continuityLast = avg(secondHalf, (s) => s.readiness.dimensionScores.continuityIntegrity);
      const strategicFirst = avg(firstHalf, (s) => s.readiness.dimensionScores.strategicIntegrity);
      const strategicLast = avg(secondHalf, (s) => s.readiness.dimensionScores.strategicIntegrity);
      const operationalFirst = avg(firstHalf, (s) => s.readiness.dimensionScores.operationalSpecificity);
      const operationalLast = avg(secondHalf, (s) => s.readiness.dimensionScores.operationalSpecificity);

      const continuityDegradationTrend = trendDirection(continuityFirst, continuityLast);
      const strategicIntegrityTrend = trendDirection(strategicFirst, strategicLast);
      const operationalIntegrityTrend = trendDirection(operationalFirst, operationalLast);

      const blockedShare = gatingFrequency.blocked / sampleSize;
      const warnedShare = gatingFrequency.warned / sampleSize;

      return {
        readinessDistribution,
        gatingFrequency,
        recoverySuccessLikelihood,
        continuityDegradationTrend,
        plannerDriftFrequency: Math.round((plannerDriftCount / sampleSize) * 100),
        strategicIntegrityTrend,
        operationalIntegrityTrend,
        executionRiskProfile: executionRiskProfile(blockedShare, warnedShare, continuityDegradationTrend),
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

let _defaultRegistry: GenerationPreparationDiagnosticsRegistry | null = null;

export function getDefaultGenerationPreparationDiagnosticsRegistry(): GenerationPreparationDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createGenerationPreparationDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultGenerationPreparationDiagnosticsRegistry(reg: GenerationPreparationDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}

export type { DiagnosticsSample };
