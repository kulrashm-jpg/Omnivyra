/**
 * Phase 10 — Adaptive learning stress tests.
 *
 * Synthetic feedback registries + assertions across the full adaptive
 * learning stack: signals → calibration → recommendation learning →
 * portfolio adaptation → revision learning → recovery optimization →
 * strategic evolution → explanation → diagnostics.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormAdaptiveLearningStress.ts
 */

import type {
  ContentPortfolioAsset,
  FeedbackEventType,
  NarrativeArchetype,
  TargetBuyerStage,
} from './longFormRecommendationTypes';
import { createFeedbackEventRegistry, type FeedbackEventRegistry, type RecordFeedbackEventInput } from './feedbackEventRegistry';
import { aggregatePerformanceSignals } from './performanceSignalAggregator';
import { learnRecommendationPreferences } from './recommendationLearningEngine';
import { calibrateGovernance } from './governanceCalibrationEngine';
import { adaptPortfolioStrategy } from './adaptivePortfolioIntelligenceEngine';
import { learnFromRevisions } from './revisionLearningAnalyzer';
import { optimizeRecovery } from './recoveryOptimizationEngine';
import { createStrategicEvolutionMemory } from './strategicEvolutionMemory';
import { composeAdaptiveLearningExplanation } from './adaptiveLearningExplanationComposer';
import { createAdaptiveLearningDiagnosticsRegistry } from './adaptiveLearningDiagnostics';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeAsset(seed: {
  title: string;
  strategicNarrative: string;
  archetype: NarrativeArchetype;
  funnelStage: TargetBuyerStage;
  icpFocus: string[];
  capabilityEmphasis: string[];
  authorityThemes: string[];
  terminologyClusters: string[];
  daysAgo?: number;
}): ContentPortfolioAsset {
  idCounter += 1;
  const publishedAt = isoDaysAgo(seed.daysAgo ?? Math.max(1, 60 - idCounter));
  return {
    articleId: `art_${idCounter.toString(36)}`,
    strategicNarrative: seed.strategicNarrative,
    editorialAngle: seed.title,
    icpFocus: seed.icpFocus,
    funnelStage: seed.funnelStage,
    capabilityEmphasis: seed.capabilityEmphasis,
    authorityThemes: seed.authorityThemes,
    terminologyClusters: seed.terminologyClusters,
    narrativeArchetype: seed.archetype,
    contentMode: 'company_context_led',
    publicationStatus: 'published',
    revisionMaturity: 'mature',
    strategicIntentTags: [],
    publishedAt,
    lastUpdatedAt: publishedAt,
    title: seed.title,
  };
}

function buildRegistryWith(events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }>): FeedbackEventRegistry {
  const reg = createFeedbackEventRegistry({ maxEventsPerCompany: 5000 });
  let day = 30;
  for (const e of events) {
    reg.record({
      companyId: e.companyId ?? 'co_test',
      eventType: e.eventType,
      recommendationId: e.recommendationId,
      articleId: e.articleId,
      revisionId: e.revisionId,
      sectionContractId: e.sectionContractId,
      reviewerId: e.reviewerId,
      detail: e.detail,
      scoreContext: e.scoreContext,
      tags: e.tags,
      recoveryOutcome: e.recoveryOutcome,
      timestamp: e.timestamp ?? isoDaysAgo(day),
    });
    day = Math.max(0, day - 0.25);
  }
  return reg;
}

function runFullPipeline(registry: FeedbackEventRegistry, companyId = 'co_test') {
  const signals = aggregatePerformanceSignals({ registry, companyId });
  const calibration = calibrateGovernance({ signals });
  const learning = learnRecommendationPreferences({ registry, companyId });
  const portfolioAdjustments = adaptPortfolioStrategy({ registry, companyId, signals });
  const revisionLearning = learnFromRevisions({ registry, companyId });
  const recoveryOptimization = optimizeRecovery({ registry, companyId });
  return { signals, calibration, learning, portfolioAdjustments, revisionLearning, recoveryOptimization };
}

export interface AdaptiveAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface AdaptiveScenarioResult {
  scenario: string;
  assertions: AdaptiveAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): AdaptiveAssertion {
  return { name, observed, passed, expected };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<AdaptiveScenarioResult> {
  // Balanced signal mix → no significant calibration drift.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 8; i += 1) {
    events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability', 'icp:platform engineers'] });
    events.push({ eventType: 'recommendation_rejected', tags: ['archetype:governance', 'icp:cios'] });
  }
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  const baseline = calibrateGovernance({ signals: r.signals }).baselineThresholds;
  return {
    scenario: 'baseline. balanced signal mix',
    passed: true,
    assertions: [
      ok('thresholds near baseline (continuityFloor)', r.calibration.thresholds.continuityFloor,
        Math.abs(r.calibration.thresholds.continuityFloor - baseline.continuityFloor) <= 2, '≤ 2 from baseline'),
      ok('approvalStrictness unchanged', r.calibration.thresholds.approvalStrictness,
        r.calibration.thresholds.approvalStrictness === baseline.approvalStrictness, baseline.approvalStrictness),
      ok('learning produced ≥ 1 axis adjustment', r.learning.recommendationPreferenceAdjustments.length,
        r.learning.recommendationPreferenceAdjustments.length >= 1, '≥ 1'),
    ],
  };
}

async function scenario1_governanceOverBlocking(): Promise<AdaptiveScenarioResult> {
  // High blocking frequency + acceptance present.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 40; i += 1) events.push({ eventType: 'generation_blocked' });
  for (let i = 0; i < 15; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability'] });
  for (let i = 0; i < 10; i += 1) events.push({ eventType: 'recommendation_rejected', tags: ['archetype:governance'] });
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  return {
    scenario: '1. governance over-blocking',
    passed: true,
    assertions: [
      ok('blocking frequency ≥ 35%', r.signals.governancePressureIndicators.blockingFrequencyPercent,
        r.signals.governancePressureIndicators.blockingFrequencyPercent >= 35, '≥ 35'),
      ok('continuity floor loosened (below baseline 60)', r.calibration.thresholds.continuityFloor,
        r.calibration.thresholds.continuityFloor < 60, '< 60'),
      ok('hallucination ceiling loosened (above baseline 50)', r.calibration.thresholds.hallucinationCeiling,
        r.calibration.thresholds.hallucinationCeiling > 50, '> 50'),
      ok('reasons include over-blocking', r.calibration.adjustmentReasons.join('|'),
        r.calibration.adjustmentReasons.some((rr) => /over-blocking/i.test(rr)), 'mentions over-blocking'),
    ],
  };
}

async function scenario2_governanceUnderSensitivity(): Promise<AdaptiveScenarioResult> {
  // Many neutral acceptances; almost no blocks/recoveries.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 30; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability'] });
  // Just 1 block out of 30 → ~3%.
  events.push({ eventType: 'generation_blocked' });
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  return {
    scenario: '2. governance under-sensitivity',
    passed: true,
    assertions: [
      ok('blocking frequency < 5%', r.signals.governancePressureIndicators.blockingFrequencyPercent,
        r.signals.governancePressureIndicators.blockingFrequencyPercent < 5, '< 5'),
      ok('recovery frequency < 10%', r.signals.governancePressureIndicators.recoveryFrequencyPercent,
        r.signals.governancePressureIndicators.recoveryFrequencyPercent < 10, '< 10'),
      ok('continuity floor tightened (above baseline 60)', r.calibration.thresholds.continuityFloor,
        r.calibration.thresholds.continuityFloor > 60, '> 60'),
      ok('hallucination ceiling tightened (below baseline 50)', r.calibration.thresholds.hallucinationCeiling,
        r.calibration.thresholds.hallucinationCeiling < 50, '< 50'),
      ok('reasons include under-governing', r.calibration.adjustmentReasons.join('|'),
        r.calibration.adjustmentReasons.some((rr) => /too permissive|under-governing/i.test(rr)),
        'mentions under-governing'),
    ],
  };
}

async function scenario3_repeatedCannibalization(): Promise<AdaptiveScenarioResult> {
  // High cannibalization recurrence.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 10; i += 1) events.push({ eventType: 'cannibalization_recurrence', tags: ['archetype:observability', 'icp:platform engineers'] });
  for (let i = 0; i < 30; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:governance'] });
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  return {
    scenario: '3. repeated cannibalization despite suppression',
    passed: true,
    assertions: [
      ok('cannibalization recurrence ≥ 15%', r.signals.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent,
        r.signals.ecosystemEvolutionIndicators.cannibalizationRecurrencePercent >= 15, '≥ 15'),
      ok('cannibalization ceiling tightened (below baseline 40)', r.calibration.thresholds.cannibalizationCeiling,
        r.calibration.thresholds.cannibalizationCeiling < 40, '< 40'),
      ok('narrative fatigue surfaced for observability', r.learning.narrativeFatigueAdjustments.map((a) => a.archetype).join(','),
        r.learning.narrativeFatigueAdjustments.some((a) => a.archetype === 'observability'), 'observability'),
      ok('archetype "observability" demoted', r.learning.recommendationPreferenceAdjustments.find((a) => a.axis === 'archetype' && a.key === 'observability')?.adjustment ?? 0,
        (r.learning.recommendationPreferenceAdjustments.find((a) => a.axis === 'archetype' && a.key === 'observability')?.adjustment ?? 0) < 0, '< 0'),
    ],
  };
}

async function scenario4_chronicApprovalBottlenecks(): Promise<AdaptiveScenarioResult> {
  // Very high approval bottleneck rate.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 40; i += 1) events.push({ eventType: 'approval_bottleneck' });
  for (let i = 0; i < 20; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability'] });
  const reg = buildRegistryWith(events);
  // Baseline strict so we can prove it loosens.
  const signals = aggregatePerformanceSignals({ registry: reg, companyId: 'co_test' });
  const calibration = calibrateGovernance({ signals, baseline: { approvalStrictness: 'strict' } });
  return {
    scenario: '4. chronic approval bottlenecks',
    passed: true,
    assertions: [
      ok('approval bottleneck ≥ 25%', signals.governancePressureIndicators.approvalBottleneckPercent,
        signals.governancePressureIndicators.approvalBottleneckPercent >= 25, '≥ 25'),
      ok('strictness loosened from strict → balanced', calibration.thresholds.approvalStrictness,
        calibration.thresholds.approvalStrictness === 'balanced', 'balanced'),
      ok('reason mentions bottleneck rate', calibration.adjustmentReasons.join('|'),
        calibration.adjustmentReasons.some((rr) => /strict → balanced|bottleneck/i.test(rr)), 'mentions bottleneck'),
    ],
  };
}

async function scenario5_repeatedRecoveryLoops(): Promise<AdaptiveScenarioResult> {
  // High recovery frequency.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 40; i += 1) events.push({ eventType: 'generation_recovered' });
  for (let i = 0; i < 15; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability'] });
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  return {
    scenario: '5. repeated recovery loops',
    passed: true,
    assertions: [
      ok('recovery frequency ≥ 40%', r.signals.governancePressureIndicators.recoveryFrequencyPercent,
        r.signals.governancePressureIndicators.recoveryFrequencyPercent >= 40, '≥ 40'),
      ok('continuity floor relaxed (below baseline 60)', r.calibration.thresholds.continuityFloor,
        r.calibration.thresholds.continuityFloor < 60, '< 60'),
      ok('reasons mention recovery frequency', r.calibration.adjustmentReasons.join('|'),
        r.calibration.adjustmentReasons.some((rr) => /recovery frequency|too strict/i.test(rr)), 'mentions recovery freq'),
    ],
  };
}

async function scenario6_strategicStagnation(): Promise<AdaptiveScenarioResult> {
  // Same positioning across many snapshots while portfolio grows.
  const memory = createStrategicEvolutionMemory();
  const companyId = 'co_test';
  const baseAssets = [
    makeAsset({ title: 'A', strategicNarrative: 'Observability sequenced before evals.', archetype: 'observability',
      funnelStage: 'awareness', icpFocus: ['Engineers'], capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'], terminologyClusters: ['decision traces'], daysAgo: 60 }),
    makeAsset({ title: 'B', strategicNarrative: 'Observability sequenced before evals.', archetype: 'observability',
      funnelStage: 'consideration', icpFocus: ['Engineers'], capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'], terminologyClusters: ['decision traces'], daysAgo: 55 }),
  ];
  memory.takeSnapshot({ companyId, assets: baseAssets, averageNovelty: 70 });
  // Grow portfolio without changing positioning.
  const grown = [...baseAssets];
  for (let i = 0; i < 6; i += 1) {
    grown.push(makeAsset({ title: `Add ${i}`, strategicNarrative: 'Observability sequenced before evals.', archetype: 'observability',
      funnelStage: 'evaluation', icpFocus: ['Engineers'], capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'], terminologyClusters: ['decision traces'], daysAgo: 30 - i * 2 }));
  }
  memory.takeSnapshot({ companyId, assets: grown, averageNovelty: 68 });
  const result = memory.analyzeEvolution(companyId);
  return {
    scenario: '6. strategic stagnation',
    passed: true,
    assertions: [
      ok('strategic_stagnation finding present', result.findings.map((f) => f.finding).join(','),
        result.findings.some((f) => f.finding === 'strategic_stagnation'), 'strategic_stagnation'),
      ok('trajectory score below 70', result.evolutionTrajectoryScore,
        result.evolutionTrajectoryScore < 70, '< 70'),
    ],
  };
}

async function scenario7_noveltyCollapse(): Promise<AdaptiveScenarioResult> {
  // Monotonic drop in average novelty across 4 snapshots, ≥ 10 total drop.
  const memory = createStrategicEvolutionMemory();
  const companyId = 'co_test';
  const baseAssets = [
    makeAsset({ title: 'A', strategicNarrative: 'A.', archetype: 'observability',
      funnelStage: 'awareness', icpFocus: ['Engineers'], capabilityEmphasis: ['x'],
      authorityThemes: ['x'], terminologyClusters: ['x'], daysAgo: 60 }),
  ];
  const novelties = [80, 70, 60, 50];
  for (const n of novelties) {
    memory.takeSnapshot({ companyId, assets: baseAssets, averageNovelty: n });
  }
  const result = memory.analyzeEvolution(companyId);
  return {
    scenario: '7. novelty collapse',
    passed: true,
    assertions: [
      ok('ecosystem_rigidity finding present', result.findings.map((f) => f.finding).join(','),
        result.findings.some((f) => f.finding === 'ecosystem_rigidity'), 'ecosystem_rigidity'),
      ok('finding severity high', result.findings.find((f) => f.finding === 'ecosystem_rigidity')?.severity ?? '',
        result.findings.find((f) => f.finding === 'ecosystem_rigidity')?.severity === 'high', 'high'),
      ok('trajectory score significantly reduced', result.evolutionTrajectoryScore,
        result.evolutionTrajectoryScore < 60, '< 60'),
    ],
  };
}

async function scenario8_reviewerSpecificFriction(): Promise<AdaptiveScenarioResult> {
  // Two reviewers with 3+ revision events each, focused edit-risk tag.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 4; i += 1) events.push({ eventType: 'human_edit_pattern', reviewerId: 'rev_A', tags: ['edit_risk:terminology_removal'] });
  for (let i = 0; i < 4; i += 1) events.push({ eventType: 'human_edit_pattern', reviewerId: 'rev_B', tags: ['edit_risk:tone_mutation'] });
  for (let i = 0; i < 5; i += 1) events.push({ eventType: 'factual_correction', reviewerId: 'rev_A', scoreContext: { factual_specificity: 30 }, tags: ['edit_risk:factual_degradation'] });
  const reg = buildRegistryWith(events);
  const revisionLearning = learnFromRevisions({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '8. reviewer-specific friction patterns',
    passed: true,
    assertions: [
      ok('high-risk patterns ≥ 2', revisionLearning.highRiskEditPatterns.length,
        revisionLearning.highRiskEditPatterns.length >= 2, '≥ 2'),
      ok('reviewer-specific pressure entries ≥ 2', revisionLearning.reviewerSpecificGovernancePressure.length,
        revisionLearning.reviewerSpecificGovernancePressure.length >= 2, '≥ 2'),
      ok('integrity weakness "factual_specificity" surfaced', revisionLearning.recurringIntegrityWeaknesses.map((w) => w.dimension).join(','),
        revisionLearning.recurringIntegrityWeaknesses.some((w) => w.dimension === 'factual_specificity'),
        'factual_specificity'),
      ok('reviewer_specific_friction pattern present', revisionLearning.highRiskEditPatterns.map((p) => p.pattern).join(','),
        revisionLearning.highRiskEditPatterns.some((p) => p.pattern === 'reviewer_specific_friction'),
        'reviewer_specific_friction'),
    ],
  };
}

async function scenario9_authorityMapOverfitting(): Promise<AdaptiveScenarioResult> {
  // One gap label gets ≥ 3 portfolio_recovery mentions → adaptive engine
  // should promote it to high severity.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 5; i += 1) {
    events.push({ eventType: 'portfolio_recovery', tags: ['authority_gap:governance', 'icp:cios'] });
  }
  for (let i = 0; i < 4; i += 1) {
    events.push({ eventType: 'strategic_sequencing_adopted', tags: ['sequencing_target:authority_gap', 'authority_gap:governance'] });
  }
  // Add ignored sequencing for a different target to prove demotion logic also fires.
  for (let i = 0; i < 5; i += 1) {
    events.push({ eventType: 'strategic_sequencing_ignored', tags: ['sequencing_target:capability_depth'] });
  }
  const reg = buildRegistryWith(events);
  const signals = aggregatePerformanceSignals({ registry: reg, companyId: 'co_test' });
  const portfolio = adaptPortfolioStrategy({ registry: reg, companyId: 'co_test', signals });
  return {
    scenario: '9. authority-map overfitting',
    passed: true,
    assertions: [
      ok('governance gap escalated to high severity', portfolio.gapSeverityAdjustments.find((g) => g.nodeLabel === 'governance')?.newSeverity ?? '',
        portfolio.gapSeverityAdjustments.some((g) => g.nodeLabel === 'governance' && g.newSeverity === 'high'),
        'high'),
      ok('authority_gap target sequencing boosted', portfolio.sequencingPriorityAdjustments.find((a) => a.target === 'authority_gap')?.weightDelta ?? 0,
        (portfolio.sequencingPriorityAdjustments.find((a) => a.target === 'authority_gap')?.weightDelta ?? 0) > 0,
        '> 0'),
      ok('capability_depth target sequencing demoted', portfolio.sequencingPriorityAdjustments.find((a) => a.target === 'capability_depth')?.weightDelta ?? 0,
        (portfolio.sequencingPriorityAdjustments.find((a) => a.target === 'capability_depth')?.weightDelta ?? 0) < 0,
        '< 0'),
    ],
  };
}

async function scenario10_adaptationInstability(): Promise<AdaptiveScenarioResult> {
  // Oscillating threshold deltas + oscillating recommendation adjustment
  // counts across many diagnostics samples → low adaptation stability.
  const diagnostics = createAdaptiveLearningDiagnosticsRegistry();
  const companyId = 'co_test';
  for (let i = 0; i < 8; i += 1) {
    const swing = i % 2 === 0;
    // Build a small registry with swinging pressure.
    const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
    if (swing) {
      for (let j = 0; j < 40; j += 1) events.push({ eventType: 'generation_blocked' });
      for (let j = 0; j < 5; j += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability', 'icp:engineers'] });
    } else {
      for (let j = 0; j < 30; j += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:governance', 'icp:cios'] });
      events.push({ eventType: 'generation_blocked' });
    }
    const reg = buildRegistryWith(events);
    const signals = aggregatePerformanceSignals({ registry: reg, companyId });
    const calibration = calibrateGovernance({ signals });
    const learning = learnRecommendationPreferences({ registry: reg, companyId });
    const portfolioAdjustments = adaptPortfolioStrategy({ registry: reg, companyId, signals });
    const recoveryOptimization = optimizeRecovery({ registry: reg, companyId });
    const revisionLearning = learnFromRevisions({ registry: reg, companyId });
    const evoMem = createStrategicEvolutionMemory();
    const evolution = evoMem.analyzeEvolution(companyId);
    diagnostics.record({
      timestamp: new Date().toISOString(),
      companyId,
      calibration,
      signals,
      learning,
      portfolioAdjustments,
      recoveryOptimization,
      evolution,
    });
  }
  const diag = diagnostics.build(companyId);
  // Compare against stable scenario:
  const stableDiag = createAdaptiveLearningDiagnosticsRegistry();
  for (let i = 0; i < 8; i += 1) {
    const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
    for (let j = 0; j < 12; j += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:observability', 'icp:engineers'] });
    for (let j = 0; j < 4; j += 1) events.push({ eventType: 'recommendation_rejected', tags: ['archetype:governance'] });
    const reg = buildRegistryWith(events);
    const signals = aggregatePerformanceSignals({ registry: reg, companyId });
    const calibration = calibrateGovernance({ signals });
    const learning = learnRecommendationPreferences({ registry: reg, companyId });
    const portfolioAdjustments = adaptPortfolioStrategy({ registry: reg, companyId, signals });
    const recoveryOptimization = optimizeRecovery({ registry: reg, companyId });
    const evoMem2 = createStrategicEvolutionMemory();
    stableDiag.record({
      timestamp: new Date().toISOString(),
      companyId,
      calibration,
      signals,
      learning,
      portfolioAdjustments,
      recoveryOptimization,
      evolution: evoMem2.analyzeEvolution(companyId),
    });
  }
  const stable = stableDiag.build(companyId);
  return {
    scenario: '10. adaptation instability',
    passed: true,
    assertions: [
      ok('sample size = 8', diag.sampleSize, diag.sampleSize === 8, '8'),
      ok('oscillating stability < stable stability', `${diag.adaptationStabilityScore} < ${stable.adaptationStabilityScore}`,
        diag.adaptationStabilityScore < stable.adaptationStabilityScore, 'osc < stable'),
      ok('stable diagnostics adaptationStabilityScore ≥ 60', stable.adaptationStabilityScore,
        stable.adaptationStabilityScore >= 60, '≥ 60'),
    ],
  };
}

async function scenario_endToEndExplanation(): Promise<AdaptiveScenarioResult> {
  // End-to-end smoke: composer produces a stable hash given the same inputs twice.
  const events: Array<Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }> = [];
  for (let i = 0; i < 30; i += 1) events.push({ eventType: 'generation_blocked' });
  for (let i = 0; i < 14; i += 1) events.push({ eventType: 'cannibalization_recurrence', tags: ['archetype:observability'] });
  for (let i = 0; i < 12; i += 1) events.push({ eventType: 'recommendation_accepted', tags: ['archetype:governance'] });
  for (let i = 0; i < 5; i += 1) events.push({ eventType: 'recovery_action_outcome', recoveryOutcome: { action: 'rebalance_funnel_stages', succeeded: true, costBand: 'low' } });
  for (let i = 0; i < 3; i += 1) events.push({ eventType: 'recovery_action_outcome', recoveryOutcome: { action: 'regenerate_section', succeeded: false, costBand: 'high' } });
  const reg = buildRegistryWith(events);
  const r = runFullPipeline(reg);
  const evoMem = createStrategicEvolutionMemory();
  const evolution = evoMem.analyzeEvolution('co_test');
  const inputA = {
    learning: r.learning, calibration: r.calibration, signals: r.signals,
    portfolioAdjustments: r.portfolioAdjustments, revisionLearning: r.revisionLearning,
    recoveryOptimization: r.recoveryOptimization, evolution,
  };
  const expA = composeAdaptiveLearningExplanation(inputA);
  const expB = composeAdaptiveLearningExplanation(inputA);
  return {
    scenario: '11. end-to-end explanation determinism',
    passed: true,
    assertions: [
      ok('reasoning hash deterministic', `${expA.reasoningSourceHash}|${expB.reasoningSourceHash}`,
        expA.reasoningSourceHash === expB.reasoningSourceHash, 'A == B'),
      ok('reasoning hash prefix ale_', expA.reasoningSourceHash.slice(0, 4),
        expA.reasoningSourceHash.startsWith('ale_'), 'ale_'),
      ok('recovery strategy = integrity_weighted (regen success low)', r.recoveryOptimization.recommendedStrategy,
        r.recoveryOptimization.recommendedStrategy === 'integrity_weighted', 'integrity_weighted'),
      ok('explanation surfaces blocking', expA.whyGovernanceStrictnessEvolved,
        /blocking frequency/i.test(expA.whyGovernanceStrictnessEvolved), 'mentions blocking'),
      ok('explanation surfaces cannibalization', expA.whyRecommendationPrioritiesChanged,
        /cannibalization/i.test(expA.whyRecommendationPrioritiesChanged), 'mentions cannibalization'),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

export interface AdaptiveStressSuiteReport {
  scenarios: AdaptiveScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: AdaptiveScenarioResult): AdaptiveScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runAdaptiveLearningStressTests(): Promise<AdaptiveStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_governanceOverBlocking(),
    scenario2_governanceUnderSensitivity(),
    scenario3_repeatedCannibalization(),
    scenario4_chronicApprovalBottlenecks(),
    scenario5_repeatedRecoveryLoops(),
    scenario6_strategicStagnation(),
    scenario7_noveltyCollapse(),
    scenario8_reviewerSpecificFriction(),
    scenario9_authorityMapOverfitting(),
    scenario10_adaptationInstability(),
    scenario_endToEndExplanation(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatAdaptiveStressReport(report: AdaptiveStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — adaptive learning');
  lines.push('═══════════════════════════════════════════════════════');
  for (const s of report.scenarios) {
    lines.push('');
    lines.push(`${s.passed ? '[PASS]' : '[FAIL]'} ${s.scenario}`);
    for (const a of s.assertions) {
      lines.push(`   ${a.passed ? '✓' : '✗'} ${a.name}: ${a.observed} (${a.expected})`);
    }
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(` Overall: ${report.overall.passed}/${report.overall.total} scenarios passed`);
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}
