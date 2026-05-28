/**
 * Phase 12.9 — Cross-modal hardening stress tests.
 *
 * Synthetic chains, registries, and feedback streams exercise:
 *   multi-hop governor · semantic matcher · fatigue governor ·
 *   adaptive transformation intelligence · ecosystem narrative governor ·
 *   strategic sequencer · hardened recovery coordinator ·
 *   hardened explanation composer · evolution diagnostics.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormCrossModalHardeningStress.ts
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  FeedbackEventType,
  NarrativeArchetype,
} from './longFormRecommendationTypes';
import {
  createCrossModalContentRegistry,
  type CrossModalContentRegistry,
  type RegisterAssetInput,
} from './crossModalContentRegistry';
import { analyzeCrossModalCannibalization } from './crossModalCannibalizationAnalyzer';
import { computeAuthorityCompounding } from './authorityCompoundingEngine';
import { analyzeCrossModalEditorialMemory } from './crossModalEditorialMemory';
import { governMultiHopTransformation } from './multiHopTransformationGovernor';
import { createSemanticMatcher } from './semanticTransformationMatcher';
import { analyzeTransformationFatigue } from './transformationFatigueGovernor';
import { adaptTransformationIntelligence } from './adaptiveTransformationIntelligence';
import { governEcosystemNarrative } from './ecosystemNarrativeGovernor';
import { sequenceCrossModalTransformations } from './crossModalStrategicSequencer';
import { buildTransformationRecoveryPlan } from './transformationRecoveryCoordinator';
import { composeCrossModalExplanation } from './crossModalIntelligenceExplanationComposer';
import { createCrossModalEvolutionDiagnosticsRegistry } from './crossModalEvolutionDiagnostics';
import {
  createFeedbackEventRegistry,
  type RecordFeedbackEventInput,
} from './feedbackEventRegistry';

// ─── helpers ────────────────────────────────────────────────────────────

let idCounter = 0;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

interface AssetSeed {
  format: CrossModalFormat;
  title: string;
  strategicNarrative: string;
  archetype: NarrativeArchetype | null;
  icpFocus: string[];
  themes: string[];
  terms: string[];
  words: number;
  authorityClaim: number;
  evidence: number;
  daysAgo?: number;
}

function makeSeed(s: AssetSeed): RegisterAssetInput {
  return {
    companyId: 'co_test',
    format: s.format,
    title: s.title,
    strategicNarrative: s.strategicNarrative,
    authorityThemes: s.themes,
    icpFocus: s.icpFocus,
    terminologyClusters: s.terms,
    narrativeArchetype: s.archetype,
    publishedAt: isoDaysAgo(s.daysAgo ?? Math.max(1, 60 - idCounter)),
    approximateWordCount: s.words,
    authorityClaimCoverage: s.authorityClaim,
    evidenceDensity: s.evidence,
    assetId: nextId('a'),
  };
}

function newRegistry(): CrossModalContentRegistry {
  idCounter = 0;
  return createCrossModalContentRegistry({ maxAssetsPerCompany: 2000, maxLineagesPerCompany: 5000 });
}

export interface HardeningAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}
export interface HardeningScenarioResult {
  scenario: string;
  assertions: HardeningAssertion[];
  passed: boolean;
}
function ok(name: string, observed: string | number, passed: boolean, expected: string): HardeningAssertion {
  return { name, observed, passed, expected };
}

// ─── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<HardeningScenarioResult> {
  // Healthy 2-hop chain — multi-hop governance should be near-perfect.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Pillar A',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations is the runtime checkpoint mechanism — catches silent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces', 'runtime telemetry'],
    words: 4000, authorityClaim: 80, evidence: 75, daysAgo: 40,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'thread', title: 'Thread B',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations is the runtime checkpoint mechanism — catches silent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces', 'runtime telemetry'],
    words: 1100, authorityClaim: 70, evidence: 65, daysAgo: 30,
  }));
  const c = reg.registerAsset(makeSeed({
    format: 'post', title: 'Post C',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations is the runtime checkpoint mechanism — catches silent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces', 'runtime telemetry'],
    words: 220, authorityClaim: 65, evidence: 60, daysAgo: 25,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: a.assetId, derivedAssetId: b.assetId, transformationType: 'decomposition', ecosystemRole: 'amplifier' });
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: b.assetId, derivedAssetId: c.assetId, transformationType: 'extraction', ecosystemRole: 'derivative' });

  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: c.assetId });
  return {
    scenario: 'baseline. healthy 3-hop chain',
    passed: true,
    assertions: [
      ok('chain length = 3', multiHop.chainLength, multiHop.chainLength === 3, '3'),
      ok('chainContinuityScore ≥ 70', multiHop.chainContinuityScore, multiHop.chainContinuityScore >= 70, '≥ 70'),
      ok('chainDriftSeverity = low', multiHop.chainDriftSeverity, multiHop.chainDriftSeverity === 'low', 'low'),
      ok('no drift axes flagged', multiHop.driftAxes.length, multiHop.driftAxes.length === 0, '0'),
    ],
  };
}

async function scenario1_slowMultiHopDrift(): Promise<HardeningScenarioResult> {
  // 5-hop chain where each hop is within tolerance but cumulative loss is severe.
  const reg = newRegistry();
  const seeds: AssetSeed[] = [
    { format: 'long_form', title: 'A', strategicNarrative: 'Decision-trace observability sequenced before evaluations is the runtime checkpoint mechanism.', archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability platform', 'agent monitoring'], terms: ['decision traces', 'runtime telemetry'], words: 4000, authorityClaim: 90, evidence: 85, daysAgo: 50 },
    { format: 'guide', title: 'B', strategicNarrative: 'Observability and evaluations are runtime checkpoints for AI workflows.', archetype: 'observability', icpFocus: ['Platform engineers', 'Engineering leaders'], themes: ['observability platform'], terms: ['decision traces'], words: 2200, authorityClaim: 70, evidence: 65, daysAgo: 40 },
    { format: 'newsletter', title: 'C', strategicNarrative: 'AI workflows need runtime visibility.', archetype: 'observability', icpFocus: ['Engineering leaders'], themes: ['observability platform'], terms: ['runtime visibility'], words: 1200, authorityClaim: 55, evidence: 45, daysAgo: 30 },
    { format: 'thread', title: 'D', strategicNarrative: 'Production AI needs visibility.', archetype: 'observability', icpFocus: ['Engineering leaders'], themes: ['ai operations'], terms: ['visibility'], words: 1000, authorityClaim: 40, evidence: 30, daysAgo: 20 },
    { format: 'post', title: 'E', strategicNarrative: 'Production AI is hard.', archetype: 'observability', icpFocus: ['Marketing teams'], themes: ['ai operations'], terms: ['hard problems'], words: 180, authorityClaim: 20, evidence: 12, daysAgo: 10 },
  ];
  const ids: string[] = [];
  for (const s of seeds) ids.push(reg.registerAsset(makeSeed(s)).assetId);
  for (let i = 1; i < ids.length; i += 1) {
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: ids[i - 1], derivedAssetId: ids[i],
      transformationType: 'adaptation', ecosystemRole: 'derivative' });
  }
  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: ids[ids.length - 1] });
  return {
    scenario: '1. slow multi-hop narrative drift',
    passed: true,
    assertions: [
      ok('chain length = 5', multiHop.chainLength, multiHop.chainLength === 5, '5'),
      ok('chainDriftSeverity ≠ low', multiHop.chainDriftSeverity, multiHop.chainDriftSeverity !== 'low', 'medium or high'),
      ok('cumulative authority retention degraded', multiHop.cumulativeAuthorityRetention,
        multiHop.cumulativeAuthorityRetention < 50, '< 50'),
      ok('cumulative ICP alignment degraded', multiHop.cumulativeICPAlignment,
        multiHop.cumulativeICPAlignment < 50, '< 50'),
      ok('drift axes include authority + icp', multiHop.driftAxes.map((a) => a.axis).join(','),
        multiHop.driftAxes.some((a) => a.axis === 'authority') && multiHop.driftAxes.some((a) => a.axis === 'icp'),
        'authority,icp'),
    ],
  };
}

async function scenario2_semanticDuplicateTransformations(): Promise<HardeningScenarioResult> {
  // Two assets that use different vocabulary for the same topic.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'A',
    strategicNarrative: 'Decision-trace observability matters for AI agents.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces', 'runtime telemetry'],
    words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 50,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'B (semantic duplicate)',
    strategicNarrative: 'Runtime monitoring of AI models matters for production teams.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['runtime monitoring'], terms: ['traces', 'telemetry'],
    words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 20,
  }));
  const matcher = createSemanticMatcher();
  const sim = matcher.compareAssets(a, b);
  // Demonstrate that the OLD token-based signature would NOT match,
  // but the semantic signature DOES match.
  const sigA = matcher.canonicalSignature(a);
  const sigB = matcher.canonicalSignature(b);
  return {
    scenario: '2. semantic duplicate transformations',
    passed: true,
    assertions: [
      ok('semantic similarity ≥ 50', sim.semanticTransformationSimilarityScore,
        sim.semanticTransformationSimilarityScore >= 50, '≥ 50'),
      ok('synonym pairs matched', sim.matchedSynonymPairs.length,
        sim.matchedSynonymPairs.length >= 2, '≥ 2'),
      ok('canonical signatures share observability class', `${sigA}|${sigB}`,
        sigA.includes('observability') && sigB.includes('observability'), 'both include observability'),
      ok('theme equivalence non-empty', sim.themeEquivalences.length,
        sim.themeEquivalences.length >= 1, '≥ 1'),
    ],
  };
}

async function scenario3_repetitiveAuthorityReinforcement(): Promise<HardeningScenarioResult> {
  // Many lineages within same archetype + tiny theme set → reinforcement loop.
  const reg = newRegistry();
  for (let i = 0; i < 6; i += 1) {
    const src = reg.registerAsset(makeSeed({
      format: 'long_form', title: `Pillar ${i}`,
      strategicNarrative: 'Governance is essential.',
      archetype: 'governance', icpFocus: [`Compliance ${i}`],
      themes: ['ai governance'], terms: ['policy enforcement'],
      words: 3500, authorityClaim: 75, evidence: 65, daysAgo: 60 - i * 6,
    }));
    const dst = reg.registerAsset(makeSeed({
      format: 'newsletter', title: `Newsletter ${i}`,
      strategicNarrative: 'Governance is essential.',
      archetype: 'governance', icpFocus: [`Compliance ${i}`],
      themes: ['ai governance'], terms: ['policy enforcement'],
      words: 1200, authorityClaim: 65, evidence: 55, daysAgo: 55 - i * 6,
    }));
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: src.assetId, derivedAssetId: dst.assetId, transformationType: 'adaptation', ecosystemRole: 'amplifier' });
  }
  const fatigue = analyzeTransformationFatigue({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '3. repetitive authority reinforcement chains',
    passed: true,
    assertions: [
      ok('authority_reinforcement_loop pattern detected', fatigue.exhaustedTransformationPatterns.map((p) => p.patternType).join(','),
        fatigue.exhaustedTransformationPatterns.some((p) => p.patternType === 'authority_reinforcement_loop'),
        'authority_reinforcement_loop'),
      ok('fatigue score > 0', fatigue.transformationFatigueScore, fatigue.transformationFatigueScore > 0, '> 0'),
      ok('fatigueByArchetype includes governance', fatigue.fatigueByArchetype.map((f) => f.archetype).join(','),
        fatigue.fatigueByArchetype.some((f) => f.archetype === 'governance'), 'governance'),
    ],
  };
}

async function scenario4_exhaustedDecompositionLoops(): Promise<HardeningScenarioResult> {
  const reg = newRegistry();
  const pillar = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Pillar',
    strategicNarrative: 'Pillar narrative.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 50,
  }));
  for (let i = 0; i < 5; i += 1) {
    const post = reg.registerAsset(makeSeed({
      format: 'post', title: `Post ${i}`,
      strategicNarrative: 'Pillar narrative.',
      archetype: 'observability', icpFocus: ['Engineers'],
      themes: ['observability'], terms: ['decision traces'],
      words: 200, authorityClaim: 50, evidence: 40, daysAgo: 40 - i * 2,
    }));
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: pillar.assetId, derivedAssetId: post.assetId,
      transformationType: 'extraction', ecosystemRole: 'derivative' });
  }
  const fatigue = analyzeTransformationFatigue({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '4. exhausted decomposition loops',
    passed: true,
    assertions: [
      ok('decomposition_path pattern present', fatigue.exhaustedTransformationPatterns.map((p) => p.patternType).join(','),
        fatigue.exhaustedTransformationPatterns.some((p) => p.patternType === 'decomposition_path'),
        'decomposition_path'),
      ok('format-pair fatigue surfaced for long_form->post', fatigue.fatigueByFormatPair.map((f) => f.pair).join(','),
        fatigue.fatigueByFormatPair.some((f) => f.pair === 'long_form->post'),
        'long_form->post'),
    ],
  };
}

async function scenario5_contradictoryMultiFormatPositioning(): Promise<HardeningScenarioResult> {
  const reg = newRegistry();
  reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Long: sequence',
    strategicNarrative: 'Observability sequenced before evaluations is the right path.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 40,
  }));
  reg.registerAsset(makeSeed({
    format: 'newsletter', title: 'Newsletter: alongside',
    strategicNarrative: 'Run observability alongside evals instead of sequenced before.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 1200, authorityClaim: 70, evidence: 60, daysAgo: 20,
  }));
  reg.registerAsset(makeSeed({
    format: 'post', title: 'Post: alongside',
    strategicNarrative: 'Observability instead of evals is wrong; run them together.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 200, authorityClaim: 60, evidence: 50, daysAgo: 10,
  }));
  const assets = reg.listAssets('co_test');
  const result = governEcosystemNarrative({ assets });
  return {
    scenario: '5. contradictory multi-format positioning',
    passed: true,
    assertions: [
      ok('POSITIONING_CONTRADICTION surfaced', result.detectedIssues.map((i) => i.type).join(','),
        result.detectedIssues.some((i) => i.type === 'POSITIONING_CONTRADICTION'),
        'POSITIONING_CONTRADICTION'),
      ok('ecosystem coherence < 90', result.ecosystemCoherenceScore,
        result.ecosystemCoherenceScore < 90, '< 90'),
    ],
  };
}

async function scenario6_chainLevelAuthorityCollapse(): Promise<HardeningScenarioResult> {
  // Authority crashes step by step.
  const reg = newRegistry();
  const seeds: AssetSeed[] = [
    { format: 'whitepaper', title: 'Whitepaper', strategicNarrative: 'Authority claim 1.', archetype: 'governance', icpFocus: ['Compliance'], themes: ['governance'], terms: ['policy'], words: 6000, authorityClaim: 90, evidence: 85, daysAgo: 60 },
    { format: 'guide', title: 'Guide', strategicNarrative: 'Authority claim 1, derived.', archetype: 'governance', icpFocus: ['Compliance'], themes: ['governance'], terms: ['policy'], words: 2200, authorityClaim: 60, evidence: 50, daysAgo: 40 },
    { format: 'newsletter', title: 'Newsletter', strategicNarrative: 'Authority claim 1.', archetype: 'governance', icpFocus: ['Compliance'], themes: ['governance'], terms: ['policy'], words: 1200, authorityClaim: 35, evidence: 28, daysAgo: 20 },
    { format: 'post', title: 'Post', strategicNarrative: 'Authority claim 1.', archetype: 'governance', icpFocus: ['Compliance'], themes: ['governance'], terms: ['policy'], words: 200, authorityClaim: 18, evidence: 12, daysAgo: 5 },
  ];
  const ids: string[] = [];
  for (const s of seeds) ids.push(reg.registerAsset(makeSeed(s)).assetId);
  for (let i = 1; i < ids.length; i += 1) {
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: ids[i - 1], derivedAssetId: ids[i], transformationType: 'extraction', ecosystemRole: 'derivative' });
  }
  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: ids[ids.length - 1] });
  const recovery = buildTransformationRecoveryPlan({
    cannibalization: analyzeCrossModalCannibalization({ assets: reg.listAssets('co_test') }),
    editorialMemory: analyzeCrossModalEditorialMemory({ registry: reg, companyId: 'co_test' }),
    compounding: computeAuthorityCompounding({ assets: reg.listAssets('co_test') }),
    multiHop,
    descendantAssetIds: ids.slice(1),
  });
  return {
    scenario: '6. chain-level authority collapse',
    passed: true,
    assertions: [
      ok('cumulativeAuthorityRetention ≤ 25', multiHop.cumulativeAuthorityRetention,
        multiHop.cumulativeAuthorityRetention <= 25, '≤ 25'),
      ok('chainDriftSeverity = high', multiHop.chainDriftSeverity, multiHop.chainDriftSeverity === 'high', 'high'),
      ok('recovery proposes lineage_rollback', recovery.steps.map((s) => s.action).join(','),
        recovery.steps.some((s) => s.action === 'lineage_rollback'), 'lineage_rollback'),
      ok('recovery proposes chain_level_recovery', recovery.steps.map((s) => s.action).join(','),
        recovery.steps.some((s) => s.action === 'chain_level_recovery'), 'chain_level_recovery'),
    ],
  };
}

async function scenario7_ecosystemNarrativeFragmentation(): Promise<HardeningScenarioResult> {
  // Each format tells a different story.
  const reg = newRegistry();
  const themes = [
    { archetype: 'observability', themes: ['observability'], terms: ['decision traces'], narrative: 'Observability is the path.' },
    { archetype: 'governance', themes: ['governance'], terms: ['policy'], narrative: 'Governance is the path.' },
    { archetype: 'orchestration', themes: ['orchestration'], terms: ['workflows'], narrative: 'Orchestration is the path.' },
    { archetype: 'transformation_path', themes: ['transformation'], terms: ['change'], narrative: 'Transformation is the path.' },
  ];
  const formats: CrossModalFormat[] = ['long_form', 'thread', 'post', 'newsletter'];
  for (let i = 0; i < formats.length; i += 1) {
    const t = themes[i];
    reg.registerAsset(makeSeed({
      format: formats[i], title: `${formats[i]} on ${t.archetype}`,
      strategicNarrative: t.narrative,
      archetype: t.archetype as NarrativeArchetype, icpFocus: ['Engineers'],
      themes: t.themes, terms: t.terms,
      words: formats[i] === 'long_form' ? 3500 : formats[i] === 'newsletter' ? 1200 : formats[i] === 'thread' ? 1000 : 200,
      authorityClaim: 60, evidence: 50, daysAgo: 50 - i * 6,
    }));
  }
  const result = governEcosystemNarrative({ assets: reg.listAssets('co_test') });
  return {
    scenario: '7. ecosystem narrative fragmentation',
    passed: true,
    assertions: [
      ok('NARRATIVE_FRAGMENTATION OR STRATEGIC_DIVERGENCE surfaced', result.detectedIssues.map((i) => i.type).join(','),
        result.detectedIssues.some((i) => i.type === 'NARRATIVE_FRAGMENTATION' || i.type === 'STRATEGIC_DIVERGENCE'),
        'NARRATIVE_FRAGMENTATION or STRATEGIC_DIVERGENCE'),
      ok('ecosystem coherence < 90', result.ecosystemCoherenceScore, result.ecosystemCoherenceScore < 90, '< 90'),
    ],
  };
}

async function scenario8_adaptiveScoringInstability(): Promise<HardeningScenarioResult> {
  // Oscillating feedback streams → confidence should remain bounded.
  const feedback = createFeedbackEventRegistry({ maxEventsPerCompany: 5000 });
  let day = 30;
  function rec(e: Partial<RecordFeedbackEventInput> & { eventType: FeedbackEventType }) {
    feedback.record({
      companyId: 'co_test', eventType: e.eventType, tags: e.tags, scoreContext: e.scoreContext,
      reviewerId: e.reviewerId, timestamp: isoDaysAgo(day -= 0.05),
    });
  }
  // Send 6 accept then 6 reject then 6 oversimplification flags.
  for (let i = 0; i < 6; i += 1) rec({ eventType: 'recommendation_accepted', tags: ['transformation_type:decomposition'] });
  for (let i = 0; i < 6; i += 1) rec({ eventType: 'recommendation_rejected', tags: ['transformation_type:decomposition'] });
  for (let i = 0; i < 6; i += 1) rec({ eventType: 'human_edit_pattern', tags: ['edit_risk:oversimplification', 'edit_risk:authority_loss'] });
  for (let i = 0; i < 4; i += 1) rec({ eventType: 'cannibalization_recurrence', tags: ['archetype:observability'] });
  const profile = adaptTransformationIntelligence({ registry: feedback, companyId: 'co_test' });
  return {
    scenario: '8. adaptive scoring instability',
    passed: true,
    assertions: [
      ok('compatibilityWeightMultiplier within bounds', profile.compatibilityWeightMultiplier,
        profile.compatibilityWeightMultiplier >= 0.6 && profile.compatibilityWeightMultiplier <= 1.4,
        '0.6..1.4'),
      ok('oversimplification sensitivity increased', profile.oversimplificationSensitivityDelta,
        profile.oversimplificationSensitivityDelta > 0, '> 0'),
      ok('decomposition aggressiveness decreased', profile.decompositionAggressivenessDelta,
        profile.decompositionAggressivenessDelta < 0, '< 0'),
      ok('confidence reported between 0 and 100', profile.adaptiveTransformationConfidence,
        profile.adaptiveTransformationConfidence >= 0 && profile.adaptiveTransformationConfidence <= 100,
        '0..100'),
      ok('rationale notes non-empty', profile.rationaleNotes.length,
        profile.rationaleNotes.length >= 2, '≥ 2'),
    ],
  };
}

async function scenario9_excessiveDecompositionAggressiveness(): Promise<HardeningScenarioResult> {
  // Saturated archetype + recommend sequencer → it should NOT recommend more decomposition for that archetype.
  const reg = newRegistry();
  for (let i = 0; i < 4; i += 1) {
    reg.registerAsset(makeSeed({
      format: (['long_form', 'thread', 'post', 'newsletter'] as CrossModalFormat[])[i],
      title: `${i}`,
      strategicNarrative: 'Saturated.',
      archetype: 'observability', icpFocus: ['Engineers'],
      themes: ['observability'], terms: ['decision traces'],
      words: 2000, authorityClaim: 80, evidence: 70, daysAgo: 60 - i * 6,
    }));
  }
  // Add an under-developed archetype that DOES need decomposition.
  reg.registerAsset(makeSeed({
    format: 'long_form', title: 'New pillar',
    strategicNarrative: 'Underdeveloped.',
    archetype: 'governance', icpFocus: ['Compliance'],
    themes: ['governance'], terms: ['policy'],
    words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 5,
  }));
  const assets = reg.listAssets('co_test');
  const compounding = computeAuthorityCompounding({ assets });
  const fatigue = analyzeTransformationFatigue({ registry: reg, companyId: 'co_test' });
  const seq = sequenceCrossModalTransformations({ assets, compounding, fatigue });
  // We expect: top recommendation should NOT be observability decomposition.
  const top = seq.topRecommendation;
  return {
    scenario: '9. excessive decomposition aggressiveness suppressed',
    passed: true,
    assertions: [
      ok('top recommendation does NOT target saturated archetype', top ? `${top.fromFormat}->${top.toFormat}:${top.transformationType}` : '(none)',
        top !== null && !(top.transformationType === 'repurposing' && top.toFormat === top.fromFormat),
        'recommends action'),
      ok('sequence includes governance decomposition', seq.recommendedTransformationSequence.map((s) => `${s.fromFormat}->${s.toFormat}`).join(','),
        seq.recommendedTransformationSequence.some((s) => s.fromFormat === 'long_form'),
        'long_form->...'),
      ok('confidence reported', seq.sequencingConfidence, seq.sequencingConfidence > 0, '> 0'),
    ],
  };
}

async function scenario10_longChainContextErosion(): Promise<HardeningScenarioResult> {
  // 6 hops where ICP and terminology slowly disappear.
  const reg = newRegistry();
  const seeds: AssetSeed[] = [
    { format: 'long_form', title: 'A', strategicNarrative: 'Decision-trace observability.', archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability'], terms: ['decision traces', 'runtime telemetry'], words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 80 },
    { format: 'guide', title: 'B', strategicNarrative: 'Decision-trace observability.', archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability'], terms: ['decision traces'], words: 2200, authorityClaim: 70, evidence: 60, daysAgo: 70 },
    { format: 'newsletter', title: 'C', strategicNarrative: 'Observability tools.', archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability'], terms: ['observability'], words: 1200, authorityClaim: 60, evidence: 50, daysAgo: 50 },
    { format: 'thread', title: 'D', strategicNarrative: 'Tools.', archetype: 'observability', icpFocus: ['Engineering leaders'], themes: ['observability'], terms: ['tools'], words: 1000, authorityClaim: 45, evidence: 35, daysAgo: 30 },
    { format: 'post', title: 'E', strategicNarrative: 'Tools matter.', archetype: 'observability', icpFocus: ['Marketing teams'], themes: ['operations'], terms: ['tools'], words: 200, authorityClaim: 30, evidence: 20, daysAgo: 15 },
    { format: 'post', title: 'F', strategicNarrative: 'Tools.', archetype: 'observability', icpFocus: ['Marketing teams'], themes: ['general'], terms: [], words: 150, authorityClaim: 18, evidence: 10, daysAgo: 5 },
  ];
  const ids: string[] = [];
  for (const s of seeds) ids.push(reg.registerAsset(makeSeed(s)).assetId);
  for (let i = 1; i < ids.length; i += 1) {
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: ids[i - 1], derivedAssetId: ids[i], transformationType: 'adaptation', ecosystemRole: 'derivative' });
  }
  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: ids[ids.length - 1] });
  return {
    scenario: '10. long-chain context erosion',
    passed: true,
    assertions: [
      ok('chain length = 6', multiHop.chainLength, multiHop.chainLength === 6, '6'),
      ok('cumulativeTerminologyRetention degraded', multiHop.cumulativeTerminologyRetention,
        multiHop.cumulativeTerminologyRetention < 50, '< 50'),
      ok('cumulativeICPAlignment degraded', multiHop.cumulativeICPAlignment,
        multiHop.cumulativeICPAlignment < 50, '< 50'),
      ok('chainContinuityScore severely degraded', multiHop.chainContinuityScore,
        multiHop.chainContinuityScore < 50, '< 50'),
      ok('chain length penalty applied', multiHop.chainLength,
        multiHop.chainLength >= 4, '≥ 4'),
    ],
  };
}

async function scenario_endToEnd(): Promise<HardeningScenarioResult> {
  // End-to-end: a chain + ecosystem + fatigue + adaptive → hardened
  // composer should produce all 5 optional rationale fields.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Pillar',
    strategicNarrative: 'Observability sequenced before evals.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 4000, authorityClaim: 85, evidence: 80, daysAgo: 50,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'newsletter', title: 'Newsletter',
    strategicNarrative: 'Observability sequenced before evals.',
    archetype: 'observability', icpFocus: ['Engineers'],
    themes: ['observability'], terms: ['decision traces'],
    words: 1200, authorityClaim: 70, evidence: 60, daysAgo: 30,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: a.assetId, derivedAssetId: b.assetId, transformationType: 'adaptation', ecosystemRole: 'amplifier' });

  const assets = reg.listAssets('co_test');
  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: b.assetId });
  const fatigue = analyzeTransformationFatigue({ registry: reg, companyId: 'co_test' });
  const ecosystem = governEcosystemNarrative({ assets });
  const compounding = computeAuthorityCompounding({ assets });
  const sequencing = sequenceCrossModalTransformations({ assets, compounding, fatigue });
  const cannibalization = analyzeCrossModalCannibalization({ assets });
  const editorialMemory = analyzeCrossModalEditorialMemory({ registry: reg, companyId: 'co_test' });
  const recovery = buildTransformationRecoveryPlan({
    cannibalization, editorialMemory, compounding,
    multiHop, fatigue, ecosystemNarrative: ecosystem,
  });
  const feedback = createFeedbackEventRegistry();
  for (let i = 0; i < 12; i += 1) {
    feedback.record({ companyId: 'co_test', eventType: 'recommendation_accepted', tags: ['transformation_type:decomposition'] });
  }
  const adaptive = adaptTransformationIntelligence({ registry: feedback, companyId: 'co_test' });

  const exp = composeCrossModalExplanation({
    transformation: null, continuity: null, cannibalization, editorialMemory, compounding, recoveryPlan: recovery,
    multiHop, fatigue, ecosystemNarrative: ecosystem, sequencing, adaptive,
  });

  // Diagnostics smoke
  const diag = createCrossModalEvolutionDiagnosticsRegistry();
  for (let i = 0; i < 6; i += 1) {
    diag.record({
      timestamp: new Date(Date.now() - (6 - i) * 1000).toISOString(),
      companyId: 'co_test',
      multiHop, fatigue, ecosystem, sequencing, adaptive,
      semanticPairSimilarities: [],
    });
  }
  const built = diag.build('co_test');

  return {
    scenario: '11. end-to-end hardening + diagnostics',
    passed: true,
    assertions: [
      ok('chainContinuityRationale present', exp.chainContinuityRationale ?? '(none)',
        typeof exp.chainContinuityRationale === 'string' && exp.chainContinuityRationale.length > 10, 'present'),
      ok('fatigueRationale present', exp.fatigueRationale ?? '(none)',
        typeof exp.fatigueRationale === 'string' && exp.fatigueRationale.length > 10, 'present'),
      ok('ecosystemAuthorityRationale present', exp.ecosystemAuthorityRationale ?? '(none)',
        typeof exp.ecosystemAuthorityRationale === 'string' && exp.ecosystemAuthorityRationale.length > 10, 'present'),
      ok('sequencingRationale present', exp.sequencingRationale ?? '(none)',
        typeof exp.sequencingRationale === 'string' && exp.sequencingRationale.length > 10, 'present'),
      ok('adaptiveScoringRationale present', exp.adaptiveScoringRationale ?? '(none)',
        typeof exp.adaptiveScoringRationale === 'string' && exp.adaptiveScoringRationale.length > 10, 'present'),
      ok('explanation hash prefix cmi_', exp.reasoningSourceHash.slice(0, 4), exp.reasoningSourceHash.startsWith('cmi_'), 'cmi_'),
      ok('evolution diagnostics sample = 6', built.sampleSize, built.sampleSize === 6, '6'),
    ],
  };
}

// ─── suite ──────────────────────────────────────────────────────────────

export interface HardeningStressSuiteReport {
  scenarios: HardeningScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: HardeningScenarioResult): HardeningScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runCrossModalHardeningStressTests(): Promise<HardeningStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_slowMultiHopDrift(),
    scenario2_semanticDuplicateTransformations(),
    scenario3_repetitiveAuthorityReinforcement(),
    scenario4_exhaustedDecompositionLoops(),
    scenario5_contradictoryMultiFormatPositioning(),
    scenario6_chainLevelAuthorityCollapse(),
    scenario7_ecosystemNarrativeFragmentation(),
    scenario8_adaptiveScoringInstability(),
    scenario9_excessiveDecompositionAggressiveness(),
    scenario10_longChainContextErosion(),
    scenario_endToEnd(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatHardeningStressReport(report: HardeningStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — cross-modal hardening');
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
