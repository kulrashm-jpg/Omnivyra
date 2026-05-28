/**
 * Phase 9 — Adaptive learning explanation composer.
 *
 * Canonical reasoning source → stable hash for same state. Explains what the
 * adaptive learning layer learned, what thresholds adapted, why
 * recommendation priorities changed, why governance strictness evolved, and
 * what strategic patterns emerged from the feedback registry.
 */

import type {
  AdaptiveLearningExplanation,
  AdaptivePortfolioAdjustments,
  CalibrationResult,
  PerformanceSignalAggregation,
  RecommendationLearningOutputs,
  RecoveryOptimizationOutputs,
  RevisionLearningOutputs,
  StrategicEvolutionResult,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function topN<T>(items: T[], n: number): T[] {
  return items.slice(0, n);
}

export interface ComposeAdaptiveLearningExplanationInput {
  learning: RecommendationLearningOutputs;
  calibration: CalibrationResult;
  signals: PerformanceSignalAggregation;
  portfolioAdjustments: AdaptivePortfolioAdjustments;
  revisionLearning: RevisionLearningOutputs;
  recoveryOptimization: RecoveryOptimizationOutputs;
  evolution: StrategicEvolutionResult;
}

export function composeAdaptiveLearningExplanation(
  input: ComposeAdaptiveLearningExplanationInput,
): AdaptiveLearningExplanation {
  const {
    learning,
    calibration,
    signals,
    portfolioAdjustments,
    revisionLearning,
    recoveryOptimization,
    evolution,
  } = input;

  // ── Canonical reasoning source (drives the hash) ─────────────────────────
  const canonical = {
    learning: {
      prefCount: learning.recommendationPreferenceAdjustments.length,
      topPref: topN(learning.recommendationPreferenceAdjustments, 3).map((a) => `${a.axis}:${a.key}:${a.adjustment >= 0 ? '+' : ''}${a.adjustment}`),
      fatigueCount: learning.narrativeFatigueAdjustments.length,
      topFatigue: topN(learning.narrativeFatigueAdjustments, 3).map((a) => `${a.archetype}:+${a.fatigueIncrement}`),
      icpCount: learning.icpPriorityAdjustments.length,
      topIcp: topN(learning.icpPriorityAdjustments, 3).map((a) => `${a.icp}:${a.priorityDelta >= 0 ? '+' : ''}${a.priorityDelta}`),
      gapCount: learning.authorityGapPriorityAdjustments.length,
    },
    calibration: {
      diffs: {
        continuityFloor: calibration.thresholds.continuityFloor - calibration.baselineThresholds.continuityFloor,
        hallucinationCeiling: calibration.thresholds.hallucinationCeiling - calibration.baselineThresholds.hallucinationCeiling,
        cannibalizationCeiling: calibration.thresholds.cannibalizationCeiling - calibration.baselineThresholds.cannibalizationCeiling,
        noveltyFloor: calibration.thresholds.noveltyFloor - calibration.baselineThresholds.noveltyFloor,
        authoritySaturationCeiling: calibration.thresholds.authoritySaturationCeiling - calibration.baselineThresholds.authoritySaturationCeiling,
      },
      strictnessChanged: calibration.thresholds.approvalStrictness !== calibration.baselineThresholds.approvalStrictness,
      baselineStrictness: calibration.baselineThresholds.approvalStrictness,
      newStrictness: calibration.thresholds.approvalStrictness,
      confidence: calibration.calibrationConfidenceScore,
      reasonCount: calibration.adjustmentReasons.length,
    },
    signals: {
      sample: signals.sampleSize,
      block: signals.governancePressureIndicators.blockingFrequencyPercent,
      recovery: signals.governancePressureIndicators.recoveryFrequencyPercent,
      bottleneck: signals.governancePressureIndicators.approvalBottleneckPercent,
      accept: signals.strategicHealthIndicators.recommendationAcceptanceRatePercent,
      novelty: signals.strategicHealthIndicators.noveltyDecayTrend,
      coherence: signals.strategicHealthIndicators.portfolioCoherenceTrend,
      cannib: signals.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent,
      saturation: signals.ecosystemEvolutionIndicators.portfolioSaturationTrend,
    },
    portfolio: {
      seqAdjustCount: portfolioAdjustments.sequencingPriorityAdjustments.length,
      topSeq: topN(portfolioAdjustments.sequencingPriorityAdjustments, 3).map((s) => `${s.target}:${s.weightDelta >= 0 ? '+' : ''}${s.weightDelta}`),
      gapAdjustCount: portfolioAdjustments.gapSeverityAdjustments.length,
      satDelta: portfolioAdjustments.saturationSensitivityDelta,
      novDelta: portfolioAdjustments.noveltyWeightingDelta,
    },
    revision: {
      patternCount: revisionLearning.highRiskEditPatterns.length,
      topPattern: revisionLearning.highRiskEditPatterns[0]?.pattern ?? null,
      reviewerPressureCount: revisionLearning.reviewerSpecificGovernancePressure.length,
      weaknessCount: revisionLearning.recurringIntegrityWeaknesses.length,
    },
    recovery: {
      strategy: recoveryOptimization.recommendedStrategy,
      avoidRate: recoveryOptimization.regenerationAvoidanceRatePercent,
      costBand: recoveryOptimization.averageRecoveryCostBand,
      actionCount: recoveryOptimization.optimizedActionOrdering.length,
    },
    evolution: {
      snapshots: evolution.snapshots.length,
      findings: evolution.findings.map((f) => `${f.finding}:${f.severity}`),
      trajectory: evolution.evolutionTrajectoryScore,
    },
  };

  // ── 1. What the system learned ───────────────────────────────────────────
  const learnedFragments: string[] = [];
  if (canonical.learning.prefCount > 0) {
    learnedFragments.push(`${canonical.learning.prefCount} recommendation preference adjustment(s) (top: ${canonical.learning.topPref.join('; ')})`);
  }
  if (canonical.learning.fatigueCount > 0) {
    learnedFragments.push(`${canonical.learning.fatigueCount} narrative fatigue increment(s) (${canonical.learning.topFatigue.join('; ')})`);
  }
  if (canonical.learning.icpCount > 0) {
    learnedFragments.push(`${canonical.learning.icpCount} ICP priority shift(s) (${canonical.learning.topIcp.join('; ')})`);
  }
  if (canonical.learning.gapCount > 0) {
    learnedFragments.push(`${canonical.learning.gapCount} authority gap(s) elevated by learning`);
  }
  const whatTheSystemLearned = learnedFragments.length === 0
    ? `No learning signals observed yet (sample size ${canonical.signals.sample}).`
    : `Across ${canonical.signals.sample} feedback events, the system learned: ${learnedFragments.join('; ')}.`;

  // ── 2. What thresholds adapted ───────────────────────────────────────────
  const thresholdFragments: string[] = [];
  if (canonical.calibration.diffs.continuityFloor !== 0) {
    thresholdFragments.push(`continuityFloor ${canonical.calibration.diffs.continuityFloor > 0 ? '+' : ''}${canonical.calibration.diffs.continuityFloor}`);
  }
  if (canonical.calibration.diffs.hallucinationCeiling !== 0) {
    thresholdFragments.push(`hallucinationCeiling ${canonical.calibration.diffs.hallucinationCeiling > 0 ? '+' : ''}${canonical.calibration.diffs.hallucinationCeiling}`);
  }
  if (canonical.calibration.diffs.cannibalizationCeiling !== 0) {
    thresholdFragments.push(`cannibalizationCeiling ${canonical.calibration.diffs.cannibalizationCeiling > 0 ? '+' : ''}${canonical.calibration.diffs.cannibalizationCeiling}`);
  }
  if (canonical.calibration.diffs.noveltyFloor !== 0) {
    thresholdFragments.push(`noveltyFloor ${canonical.calibration.diffs.noveltyFloor > 0 ? '+' : ''}${canonical.calibration.diffs.noveltyFloor}`);
  }
  if (canonical.calibration.diffs.authoritySaturationCeiling !== 0) {
    thresholdFragments.push(`authoritySaturationCeiling ${canonical.calibration.diffs.authoritySaturationCeiling > 0 ? '+' : ''}${canonical.calibration.diffs.authoritySaturationCeiling}`);
  }
  if (canonical.calibration.strictnessChanged) {
    thresholdFragments.push(`approvalStrictness ${canonical.calibration.baselineStrictness} → ${canonical.calibration.newStrictness}`);
  }
  const whatThresholdsAdapted = thresholdFragments.length === 0
    ? `No threshold drift from baseline (confidence ${canonical.calibration.confidence}/100).`
    : `Thresholds calibrated away from baseline: ${thresholdFragments.join('; ')} (confidence ${canonical.calibration.confidence}/100, ${canonical.calibration.reasonCount} rule(s) triggered).`;

  // ── 3. Why recommendation priorities changed ─────────────────────────────
  const recPriFragments: string[] = [];
  if (canonical.signals.accept >= 70) {
    recPriFragments.push(`acceptance rate ${canonical.signals.accept}% — boosting accepted axes`);
  } else if (canonical.signals.accept > 0 && canonical.signals.accept < 30) {
    recPriFragments.push(`acceptance rate only ${canonical.signals.accept}% — demoting low-acceptance axes`);
  }
  if (canonical.learning.fatigueCount > 0) {
    recPriFragments.push(`narrative fatigue accruing on ${canonical.learning.fatigueCount} archetype(s) — suppressing repeats`);
  }
  if (canonical.signals.cannib >= 15) {
    recPriFragments.push(`cannibalization recurrence ${canonical.signals.cannib}% — penalizing overlapping recommendations`);
  }
  if (canonical.portfolio.seqAdjustCount > 0) {
    recPriFragments.push(`sequencing weights shifted (${canonical.portfolio.topSeq.join('; ')})`);
  }
  const whyRecommendationPrioritiesChanged = recPriFragments.length === 0
    ? 'Recommendation priorities unchanged — no learning pressure on the ranking signals.'
    : `Recommendation priorities shifted because: ${recPriFragments.join('; ')}.`;

  // ── 4. Why governance strictness evolved ─────────────────────────────────
  const govFragments: string[] = [];
  if (canonical.signals.block >= 35) {
    govFragments.push(`blocking frequency ${canonical.signals.block}% → governance was loosening to reduce over-blocking`);
  }
  if (canonical.signals.recovery >= 40) {
    govFragments.push(`recovery frequency ${canonical.signals.recovery}% → continuity floor relaxed`);
  }
  if (canonical.signals.bottleneck >= 25) {
    govFragments.push(`approval bottleneck ${canonical.signals.bottleneck}% → strictness shifted toward permissive`);
  }
  if (canonical.signals.block < 5 && canonical.signals.recovery < 10 && canonical.signals.sample >= 20) {
    govFragments.push('under-governance detected (low block + low recovery) → thresholds tightened gently');
  }
  if (canonical.signals.novelty === 'degrading') {
    govFragments.push('novelty decay degrading → novelty floor raised');
  } else if (canonical.signals.novelty === 'improving') {
    govFragments.push('novelty improving → novelty floor relaxed');
  }
  if (canonical.signals.saturation === 'degrading') {
    govFragments.push('saturation trend degrading → authority saturation ceiling tightened');
  }
  if (canonical.revision.reviewerPressureCount > 0) {
    govFragments.push(`${canonical.revision.reviewerPressureCount} reviewer-specific friction zone(s) detected — reviewer pressure surfaced`);
  }
  const whyGovernanceStrictnessEvolved = govFragments.length === 0
    ? `Governance strictness held steady — pressure signals within acceptable band (sample size ${canonical.signals.sample}).`
    : `Governance strictness evolved because: ${govFragments.join('; ')}.`;

  // ── 5. What strategic patterns emerged ───────────────────────────────────
  const stratFragments: string[] = [];
  if (canonical.evolution.findings.length > 0) {
    stratFragments.push(`${canonical.evolution.findings.length} strategic finding(s) across ${canonical.evolution.snapshots} snapshot(s): ${canonical.evolution.findings.join(', ')}`);
  }
  if (canonical.recovery.strategy !== 'cheapest_first') {
    stratFragments.push(`recovery strategy promoted to ${canonical.recovery.strategy} (avoidance rate ${canonical.recovery.avoidRate}%, avg cost ${canonical.recovery.costBand})`);
  } else if (canonical.recovery.actionCount > 0) {
    stratFragments.push(`recovery strategy held at cheapest_first (${canonical.recovery.actionCount} action profile(s) tracked)`);
  }
  if (canonical.revision.patternCount > 0) {
    stratFragments.push(`${canonical.revision.patternCount} recurring edit pattern(s) detected (top: ${canonical.revision.topPattern})`);
  }
  if (canonical.revision.weaknessCount > 0) {
    stratFragments.push(`${canonical.revision.weaknessCount} recurring integrity weakness(es) detected`);
  }
  if (canonical.portfolio.satDelta !== 0 || canonical.portfolio.novDelta !== 0) {
    stratFragments.push(`portfolio sensitivities re-weighted (saturation Δ${canonical.portfolio.satDelta >= 0 ? '+' : ''}${canonical.portfolio.satDelta}, novelty Δ${canonical.portfolio.novDelta >= 0 ? '+' : ''}${canonical.portfolio.novDelta})`);
  }
  stratFragments.push(`evolution trajectory score ${canonical.evolution.trajectory}/100`);
  const whatStrategicPatternsEmerged = `Strategic learning surfaced: ${stratFragments.join('; ')}.`;

  return {
    whatTheSystemLearned,
    whatThresholdsAdapted,
    whyRecommendationPrioritiesChanged,
    whyGovernanceStrictnessEvolved,
    whatStrategicPatternsEmerged,
    reasoningSourceHash: `ale_${stableHash(JSON.stringify(canonical))}`,
  };
}
