/**
 * Phase 3 — Governance calibration engine.
 *
 * Reads `PerformanceSignalAggregation` and adjusts 6 thresholds away from
 * baseline. Output includes the new thresholds, the baseline (so callers
 * can diff), a confidence score, and human-readable adjustment reasons.
 *
 * Heuristics:
 *   - high blocking frequency       → loosen continuity floor + hallucination ceiling
 *   - low recovery success / chronic recoveries → tighten thresholds
 *   - high cannibalization recurrence → tighten cannibalization ceiling
 *   - low novelty decay (improving)  → loosen novelty floor; degrading → tighten
 *   - high authority saturation     → tighten saturation ceiling
 *   - chronic approval bottlenecks  → switch strictness to 'balanced' or 'permissive'
 *
 * Confidence:
 *   - high sample size + consistent signals → high confidence
 *   - low sample size or conflicting signals → low confidence (small deltas only)
 */

import type {
  ApprovalStrictnessLevel,
  CalibrationResult,
  CalibratedThresholds,
  PerformanceSignalAggregation,
} from './longFormRecommendationTypes';

const BASELINE_THRESHOLDS: CalibratedThresholds = {
  continuityFloor: 60,
  hallucinationCeiling: 50,
  cannibalizationCeiling: 40,
  noveltyFloor: 35,
  authoritySaturationCeiling: 80,
  approvalStrictness: 'balanced',
};

const MAX_ADJUSTMENT: Record<keyof Omit<CalibratedThresholds, 'approvalStrictness'>, number> = {
  continuityFloor: 15,
  hallucinationCeiling: 20,
  cannibalizationCeiling: 15,
  noveltyFloor: 15,
  authoritySaturationCeiling: 15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function adjust(value: number, delta: number, baseline: number, maxAdjust: number): number {
  const candidate = value + delta;
  const distanceFromBaseline = Math.abs(candidate - baseline);
  if (distanceFromBaseline > maxAdjust) {
    return delta > 0 ? baseline + maxAdjust : baseline - maxAdjust;
  }
  return candidate;
}

export interface CalibrateGovernanceInput {
  signals: PerformanceSignalAggregation;
  /** Optional override of baseline thresholds (e.g. company-specific defaults). */
  baseline?: Partial<CalibratedThresholds>;
}

export function calibrateGovernance(input: CalibrateGovernanceInput): CalibrationResult {
  const baseline: CalibratedThresholds = { ...BASELINE_THRESHOLDS, ...(input.baseline ?? {}) };
  const reasons: string[] = [];

  let continuityFloor = baseline.continuityFloor;
  let hallucinationCeiling = baseline.hallucinationCeiling;
  let cannibalizationCeiling = baseline.cannibalizationCeiling;
  let noveltyFloor = baseline.noveltyFloor;
  let authoritySaturationCeiling = baseline.authoritySaturationCeiling;
  let approvalStrictness: ApprovalStrictnessLevel = baseline.approvalStrictness;

  const s = input.signals;
  const sampleSize = s.sampleSize;

  // Confidence scaling — small samples produce small deltas.
  const confidenceFactor = sampleSize < 10 ? 0.25
    : sampleSize < 30 ? 0.5
    : sampleSize < 60 ? 0.75
    : 1.0;

  function scaled(base: number): number {
    return Math.round(base * confidenceFactor);
  }

  // 1. Blocking frequency too high (over-blocking) — loosen continuity + hallucination.
  if (s.governancePressureIndicators.blockingFrequencyPercent >= 35) {
    continuityFloor = adjust(continuityFloor, -scaled(6), baseline.continuityFloor, MAX_ADJUSTMENT.continuityFloor);
    hallucinationCeiling = adjust(hallucinationCeiling, +scaled(8), baseline.hallucinationCeiling, MAX_ADJUSTMENT.hallucinationCeiling);
    reasons.push(`Loosened continuity + hallucination thresholds — blocking frequency ${s.governancePressureIndicators.blockingFrequencyPercent}% suggests over-blocking.`);
  }

  // 2. Recovery frequency very high — also loosen, but more conservatively.
  if (s.governancePressureIndicators.recoveryFrequencyPercent >= 40) {
    continuityFloor = adjust(continuityFloor, -scaled(4), baseline.continuityFloor, MAX_ADJUSTMENT.continuityFloor);
    reasons.push(`Loosened continuity floor — recovery frequency ${s.governancePressureIndicators.recoveryFrequencyPercent}% indicates governance is too strict.`);
  }

  // 3. Low blocking + low recovery — tighten gently (under-governing).
  if (s.governancePressureIndicators.blockingFrequencyPercent < 5
      && s.governancePressureIndicators.recoveryFrequencyPercent < 10
      && sampleSize >= 20) {
    continuityFloor = adjust(continuityFloor, +scaled(4), baseline.continuityFloor, MAX_ADJUSTMENT.continuityFloor);
    hallucinationCeiling = adjust(hallucinationCeiling, -scaled(5), baseline.hallucinationCeiling, MAX_ADJUSTMENT.hallucinationCeiling);
    reasons.push('Tightened thresholds — chronic low recovery + blocking suggests governance is too permissive.');
  }

  // 4. Cannibalization recurrence — tighten ceiling.
  if (s.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent >= 15) {
    cannibalizationCeiling = adjust(cannibalizationCeiling, -scaled(6), baseline.cannibalizationCeiling, MAX_ADJUSTMENT.cannibalizationCeiling);
    reasons.push(`Tightened cannibalization ceiling — recurrence at ${s.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent}%.`);
  }

  // 5. Novelty trends.
  if (s.strategicHealthIndicators.noveltyDecayTrend === 'degrading') {
    noveltyFloor = adjust(noveltyFloor, +scaled(6), baseline.noveltyFloor, MAX_ADJUSTMENT.noveltyFloor);
    reasons.push('Raised novelty floor — novelty decay is degrading.');
  } else if (s.strategicHealthIndicators.noveltyDecayTrend === 'improving') {
    noveltyFloor = adjust(noveltyFloor, -scaled(3), baseline.noveltyFloor, MAX_ADJUSTMENT.noveltyFloor);
    reasons.push('Slightly lowered novelty floor — novelty is improving and can afford a wider band.');
  }

  // 6. Authority saturation.
  if (s.ecosystemEvolutionIndicators.portfolioSaturationTrend === 'degrading') {
    authoritySaturationCeiling = adjust(authoritySaturationCeiling, -scaled(8), baseline.authoritySaturationCeiling, MAX_ADJUSTMENT.authoritySaturationCeiling);
    reasons.push('Tightened authority saturation ceiling — saturation trend is degrading.');
  }

  // 7. Approval bottlenecks — relax strictness.
  if (s.governancePressureIndicators.approvalBottleneckPercent >= 25) {
    if (baseline.approvalStrictness === 'strict') {
      approvalStrictness = 'balanced';
      reasons.push(`Approval strictness loosened: strict → balanced. Bottleneck rate ${s.governancePressureIndicators.approvalBottleneckPercent}%.`);
    } else if (baseline.approvalStrictness === 'balanced' && s.governancePressureIndicators.approvalBottleneckPercent >= 50) {
      approvalStrictness = 'permissive';
      reasons.push(`Approval strictness loosened: balanced → permissive. Bottleneck rate ${s.governancePressureIndicators.approvalBottleneckPercent}%.`);
    }
  } else if (s.governancePressureIndicators.approvalBottleneckPercent < 5
             && s.governancePressureIndicators.revisionConflictPercent < 5
             && s.strategicHealthIndicators.recommendationAcceptanceRatePercent >= 80
             && sampleSize >= 30) {
    if (baseline.approvalStrictness === 'permissive') {
      approvalStrictness = 'balanced';
      reasons.push('Approval strictness raised: permissive → balanced. Pipeline is healthy enough to tolerate stricter review.');
    }
  }

  // Clamp every threshold to sane ranges.
  continuityFloor = clamp(continuityFloor, 30, 90);
  hallucinationCeiling = clamp(hallucinationCeiling, 20, 80);
  cannibalizationCeiling = clamp(cannibalizationCeiling, 10, 70);
  noveltyFloor = clamp(noveltyFloor, 15, 70);
  authoritySaturationCeiling = clamp(authoritySaturationCeiling, 50, 95);

  // Confidence: combine sample size + consistency of signals + adjustment count.
  const signalDirectionality = (() => {
    let consistent = 0;
    let inconsistent = 0;
    const pressures = [
      s.governancePressureIndicators.blockingFrequencyPercent,
      s.governancePressureIndicators.recoveryFrequencyPercent,
      s.governancePressureIndicators.approvalBottleneckPercent,
    ];
    const above = pressures.filter((p) => p >= 25).length;
    const below = pressures.filter((p) => p <= 5).length;
    if (above >= 2) consistent += 1;
    else if (below >= 2) consistent += 1;
    else inconsistent += 1;
    return consistent / Math.max(1, consistent + inconsistent);
  })();
  const calibrationConfidenceScore = Math.round(
    Math.min(100, Math.max(0, confidenceFactor * 60 + signalDirectionality * 30 + Math.min(10, reasons.length * 2))),
  );

  return {
    thresholds: {
      continuityFloor,
      hallucinationCeiling,
      cannibalizationCeiling,
      noveltyFloor,
      authoritySaturationCeiling,
      approvalStrictness,
    },
    calibrationConfidenceScore,
    adjustmentReasons: reasons,
    baselineThresholds: baseline,
  };
}

export { BASELINE_THRESHOLDS };
