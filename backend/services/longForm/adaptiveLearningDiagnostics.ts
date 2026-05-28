/**
 * Phase 11 — Adaptive learning diagnostics aggregator.
 *
 * In-memory per-process registry that accumulates adaptive-learning passes
 * (calibration + signals + portfolio adjustments + recovery optimization +
 * strategic evolution) and emits trend-aware diagnostics.
 *
 * Surfaces 6 trend axes:
 *   - thresholdEvolutionTrend       (avg |Δ from baseline| over time)
 *   - governancePressureTrend       (block + recovery + bottleneck composite)
 *   - recommendationEvolutionTrend  (count of preference adjustments)
 *   - strategicMaturityTrend        (evolutionTrajectoryScore)
 *   - recoveryOptimizationTrend     (regenerationAvoidanceRatePercent)
 *   - portfolioEvolutionTrend       (sequencing + gap-severity adjustment count)
 *
 * Plus adaptationStabilityScore — high when threshold deltas are small AND
 * recommendation adjustments converge over time (sign of adaptation
 * instability is being penalized; oscillation is bad).
 */

import type {
  AdaptiveLearningDiagnostics,
  AdaptivePortfolioAdjustments,
  CalibrationResult,
  DiagnosticTrend,
  PerformanceSignalAggregation,
  RecommendationLearningOutputs,
  RecoveryOptimizationOutputs,
  StrategicEvolutionResult,
} from './longFormRecommendationTypes';

export interface AdaptiveLearningSample {
  timestamp: string;
  companyId: string;
  calibration: CalibrationResult;
  signals: PerformanceSignalAggregation;
  learning: RecommendationLearningOutputs;
  portfolioAdjustments: AdaptivePortfolioAdjustments;
  recoveryOptimization: RecoveryOptimizationOutputs;
  evolution: StrategicEvolutionResult;
}

export interface AdaptiveLearningDiagnosticsRegistry {
  record(sample: AdaptiveLearningSample): void;
  build(companyId?: string, windowSize?: number): AdaptiveLearningDiagnostics;
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

// Lower is better → invert direction for "rising = bad" metrics.
function invertedTrend(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last < first ? 'improving' : 'degrading';
}

function thresholdDriftMagnitude(c: CalibrationResult): number {
  const t = c.thresholds;
  const b = c.baselineThresholds;
  return Math.abs(t.continuityFloor - b.continuityFloor)
    + Math.abs(t.hallucinationCeiling - b.hallucinationCeiling)
    + Math.abs(t.cannibalizationCeiling - b.cannibalizationCeiling)
    + Math.abs(t.noveltyFloor - b.noveltyFloor)
    + Math.abs(t.authoritySaturationCeiling - b.authoritySaturationCeiling)
    + (t.approvalStrictness !== b.approvalStrictness ? 5 : 0);
}

function pressureCompositeFor(s: PerformanceSignalAggregation): number {
  return s.governancePressureIndicators.blockingFrequencyPercent
    + s.governancePressureIndicators.recoveryFrequencyPercent
    + s.governancePressureIndicators.approvalBottleneckPercent
    + s.governancePressureIndicators.revisionConflictPercent;
}

function recommendationAdjustmentCount(l: RecommendationLearningOutputs): number {
  return l.recommendationPreferenceAdjustments.length
    + l.narrativeFatigueAdjustments.length
    + l.icpPriorityAdjustments.length
    + l.authorityGapPriorityAdjustments.length;
}

function portfolioAdjustmentCount(p: AdaptivePortfolioAdjustments): number {
  return p.sequencingPriorityAdjustments.length + p.gapSeverityAdjustments.length;
}

export function createAdaptiveLearningDiagnosticsRegistry(options?: {
  maxSamplesPerCompany?: number;
}): AdaptiveLearningDiagnosticsRegistry {
  const capacity = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, AdaptiveLearningSample[]>();

  function bucket(companyId: string): AdaptiveLearningSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  function allSamples(companyId?: string): AdaptiveLearningSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: AdaptiveLearningSample[] = [];
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
          thresholdEvolutionTrend: 'unknown',
          governancePressureTrend: 'unknown',
          recommendationEvolutionTrend: 'unknown',
          strategicMaturityTrend: 'unknown',
          recoveryOptimizationTrend: 'unknown',
          portfolioEvolutionTrend: 'unknown',
          adaptationStabilityScore: 0,
          sampleSize: 0,
        };
      }

      // Split into first / second halves.
      const mid = Math.max(1, Math.floor(samples.length / 2));
      const firstHalf = samples.slice(0, mid);
      const secondHalf = samples.slice(mid);

      // 1. threshold evolution — magnitude of drift from baseline. Stable
      //    drift = improving (system found a stable set); growing drift =
      //    degrading (system still hunting).
      const thrFirst = average(firstHalf.map((s) => thresholdDriftMagnitude(s.calibration)));
      const thrLast = average(secondHalf.map((s) => thresholdDriftMagnitude(s.calibration)));
      const thresholdEvolutionTrend = invertedTrend(thrFirst, thrLast, 2);

      // 2. governance pressure — composite of blocking + recovery +
      //    bottleneck + conflict. Lower = better.
      const govFirst = average(firstHalf.map((s) => pressureCompositeFor(s.signals)));
      const govLast = average(secondHalf.map((s) => pressureCompositeFor(s.signals)));
      const governancePressureTrend = invertedTrend(govFirst, govLast, 4);

      // 3. recommendation evolution — count of preference adjustments.
      //    High count of changes = system actively learning. Stable count =
      //    converged.
      const recFirst = average(firstHalf.map((s) => recommendationAdjustmentCount(s.learning)));
      const recLast = average(secondHalf.map((s) => recommendationAdjustmentCount(s.learning)));
      const recommendationEvolutionTrend = trendDirection(recFirst, recLast, 1);

      // 4. strategic maturity — evolutionTrajectoryScore.
      const matFirst = average(firstHalf.map((s) => s.evolution.evolutionTrajectoryScore));
      const matLast = average(secondHalf.map((s) => s.evolution.evolutionTrajectoryScore));
      const strategicMaturityTrend = trendDirection(matFirst, matLast, 4);

      // 5. recovery optimization — regenerationAvoidanceRatePercent.
      const recoFirst = average(firstHalf.map((s) => s.recoveryOptimization.regenerationAvoidanceRatePercent));
      const recoLast = average(secondHalf.map((s) => s.recoveryOptimization.regenerationAvoidanceRatePercent));
      const recoveryOptimizationTrend = trendDirection(recoFirst, recoLast, 3);

      // 6. portfolio evolution — adjustment counts.
      const portFirst = average(firstHalf.map((s) => portfolioAdjustmentCount(s.portfolioAdjustments)));
      const portLast = average(secondHalf.map((s) => portfolioAdjustmentCount(s.portfolioAdjustments)));
      const portfolioEvolutionTrend = trendDirection(portFirst, portLast, 1);

      // 7. adaptation stability — low when threshold magnitudes oscillate
      //    sample-to-sample (variance proxy) AND when recommendation
      //    counts swing wildly.
      const thrValues = samples.map((s) => thresholdDriftMagnitude(s.calibration));
      const thrMean = average(thrValues);
      const thrVariance = average(thrValues.map((v) => (v - thrMean) ** 2));
      const recValues = samples.map((s) => recommendationAdjustmentCount(s.learning));
      const recMean = average(recValues);
      const recVariance = average(recValues.map((v) => (v - recMean) ** 2));
      // Map variance → stability: low variance → high stability.
      // Use a soft inverse: 100 / (1 + variance * scale).
      const thrStability = 100 / (1 + thrVariance * 0.05);
      const recStability = 100 / (1 + recVariance * 0.4);
      const adaptationStabilityScore = Math.round((thrStability + recStability) / 2);

      return {
        thresholdEvolutionTrend,
        governancePressureTrend,
        recommendationEvolutionTrend,
        strategicMaturityTrend,
        recoveryOptimizationTrend,
        portfolioEvolutionTrend,
        adaptationStabilityScore: Math.max(0, Math.min(100, adaptationStabilityScore)),
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

let _defaultRegistry: AdaptiveLearningDiagnosticsRegistry | null = null;

export function getDefaultAdaptiveLearningDiagnosticsRegistry(): AdaptiveLearningDiagnosticsRegistry {
  if (!_defaultRegistry) _defaultRegistry = createAdaptiveLearningDiagnosticsRegistry();
  return _defaultRegistry;
}

export function setDefaultAdaptiveLearningDiagnosticsRegistry(reg: AdaptiveLearningDiagnosticsRegistry): void {
  _defaultRegistry = reg;
}
