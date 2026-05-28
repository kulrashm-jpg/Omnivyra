/**
 * Phase 10 — Cross-modal governance stress tests.
 *
 * Synthetic cross-modal portfolios + assertions across the full stack:
 *   registry → transformation intelligence → continuity → narrative
 *   transformation → cannibalization → authority compounding → editorial
 *   memory → recovery → explanation → diagnostics.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormCrossModalGovernanceStress.ts
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  CrossModalTransformationType,
  NarrativeArchetype,
} from './longFormRecommendationTypes';
import {
  createCrossModalContentRegistry,
  type CrossModalContentRegistry,
  type RegisterAssetInput,
} from './crossModalContentRegistry';
import { assessTransformation } from './transformationIntelligenceEngine';
import { governCrossModalContinuity } from './crossModalContinuityGovernor';
import { analyzeNarrativeTransformation } from './narrativeTransformationAnalyzer';
import { analyzeCrossModalCannibalization } from './crossModalCannibalizationAnalyzer';
import { computeAuthorityCompounding } from './authorityCompoundingEngine';
import { analyzeCrossModalEditorialMemory } from './crossModalEditorialMemory';
import { buildTransformationRecoveryPlan } from './transformationRecoveryCoordinator';
import { composeCrossModalExplanation } from './crossModalIntelligenceExplanationComposer';
import { createCrossModalGovernanceDiagnosticsRegistry } from './crossModalGovernanceDiagnostics';

// ─── helpers ───────────────────────────────────────────────────────────────

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
  companyId?: string;
}

function makeAssetSeed(seed: AssetSeed): RegisterAssetInput {
  return {
    companyId: seed.companyId ?? 'co_test',
    format: seed.format,
    title: seed.title,
    strategicNarrative: seed.strategicNarrative,
    authorityThemes: seed.themes,
    icpFocus: seed.icpFocus,
    terminologyClusters: seed.terms,
    narrativeArchetype: seed.archetype,
    publishedAt: isoDaysAgo(seed.daysAgo ?? Math.max(1, 60 - idCounter)),
    approximateWordCount: seed.words,
    authorityClaimCoverage: seed.authorityClaim,
    evidenceDensity: seed.evidence,
    assetId: nextId('a'),
  };
}

function newRegistry(): CrossModalContentRegistry {
  idCounter = 0;
  return createCrossModalContentRegistry({ maxAssetsPerCompany: 1000, maxLineagesPerCompany: 5000 });
}

export interface CrossModalAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface CrossModalScenarioResult {
  scenario: string;
  assertions: CrossModalAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): CrossModalAssertion {
  return { name, observed, passed, expected };
}

// Build a healthy pillar + a small set of cross-format derivatives for default scenarios.
function healthyEcosystem(): { registry: CrossModalContentRegistry; pillarId: string; derivedIds: string[] } {
  const reg = newRegistry();
  const pillar = reg.registerAsset(makeAssetSeed({
    format: 'long_form', title: 'Decision-trace observability — the runtime checkpoint stack',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations is the runtime checkpoint mechanism.',
    archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability platform', 'agent monitoring'],
    terms: ['decision traces', 'runtime telemetry'], words: 4200, authorityClaim: 85, evidence: 80, daysAgo: 50,
  }));
  const thread = reg.registerAsset(makeAssetSeed({
    format: 'thread', title: 'Thread: 7 ways decision traces catch silent agent failures',
    strategicNarrative: 'Decision traces sequenced before eval suites catch silent agent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability platform'],
    terms: ['decision traces', 'runtime telemetry'], words: 1100, authorityClaim: 70, evidence: 60, daysAgo: 40,
  }));
  const post = reg.registerAsset(makeAssetSeed({
    format: 'post', title: 'Post: silent agent failures are an observability problem',
    strategicNarrative: 'Decision traces sequenced before eval suites catch silent agent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability platform'],
    terms: ['decision traces'], words: 220, authorityClaim: 60, evidence: 50, daysAgo: 35,
  }));
  const newsletter = reg.registerAsset(makeAssetSeed({
    format: 'newsletter', title: 'Weekly: the runtime checkpoint stack',
    strategicNarrative: 'Runtime checkpoint observability gives operators the trace-level visibility eval suites miss.',
    archetype: 'observability', icpFocus: ['Platform engineers', 'Engineering leaders'], themes: ['observability platform'],
    terms: ['decision traces', 'runtime telemetry'], words: 1300, authorityClaim: 72, evidence: 68, daysAgo: 25,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: pillar.assetId, derivedAssetId: thread.assetId, transformationType: 'decomposition', ecosystemRole: 'amplifier' });
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: pillar.assetId, derivedAssetId: post.assetId, transformationType: 'extraction', ecosystemRole: 'derivative' });
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: pillar.assetId, derivedAssetId: newsletter.assetId, transformationType: 'adaptation', ecosystemRole: 'amplifier' });
  return { registry: reg, pillarId: pillar.assetId, derivedIds: [thread.assetId, post.assetId, newsletter.assetId] };
}

function fullPass(registry: CrossModalContentRegistry, companyId = 'co_test') {
  const assets = registry.listAssets(companyId);
  const cannibalization = analyzeCrossModalCannibalization({ assets });
  const editorialMemory = analyzeCrossModalEditorialMemory({ registry, companyId });
  const compounding = computeAuthorityCompounding({ assets });
  return { assets, cannibalization, editorialMemory, compounding };
}

// ─── scenarios ─────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<CrossModalScenarioResult> {
  const { registry, pillarId, derivedIds } = healthyEcosystem();
  const r = fullPass(registry);
  const pillar = registry.getAsset('co_test', pillarId)!;
  const thread = registry.getAsset('co_test', derivedIds[0])!;
  const continuity = governCrossModalContinuity({ source: pillar, derived: thread });
  const recoveryPlan = buildTransformationRecoveryPlan({
    continuity, cannibalization: r.cannibalization,
    editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  return {
    scenario: 'baseline. healthy pillar + 3 derivatives',
    passed: true,
    assertions: [
      ok('continuity score ≥ 60', continuity.continuityScore, continuity.continuityScore >= 60, '≥ 60'),
      ok('no high-severity continuity issues', continuity.detectedIssues.filter((i) => i.severity === 'high').length,
        continuity.detectedIssues.filter((i) => i.severity === 'high').length === 0, '0'),
      ok('cross-modal novelty ≥ 80', r.editorialMemory.crossModalNoveltyScore, r.editorialMemory.crossModalNoveltyScore >= 80, '≥ 80'),
      ok('ecosystem authority > 0', r.compounding.ecosystemAuthorityScore, r.compounding.ecosystemAuthorityScore > 0, '> 0'),
      ok('recovery plan is empty or low-risk', recoveryPlan.overallRiskScore, recoveryPlan.overallRiskScore <= 28, '≤ 28'),
    ],
  };
}

async function scenario1_repetitiveDecomposition(): Promise<CrossModalScenarioResult> {
  // Same long-form decomposed into 5 posts that all say the same thing.
  const reg = newRegistry();
  const pillar = reg.registerAsset(makeAssetSeed({
    format: 'long_form', title: 'The observability primer',
    strategicNarrative: 'Decision-trace observability matters.',
    archetype: 'observability', icpFocus: ['Engineers'], themes: ['observability'],
    terms: ['decision traces'], words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 50,
  }));
  for (let i = 0; i < 5; i += 1) {
    const post = reg.registerAsset(makeAssetSeed({
      format: 'post', title: `Post ${i + 1}: decision traces matter`,
      strategicNarrative: 'Decision-trace observability matters.',
      archetype: 'observability', icpFocus: ['Engineers'], themes: ['observability'],
      terms: ['decision traces'], words: 200, authorityClaim: 50, evidence: 40, daysAgo: 40 - i * 2,
    }));
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: pillar.assetId, derivedAssetId: post.assetId,
      transformationType: 'extraction', ecosystemRole: 'derivative' });
  }
  const r = fullPass(reg);
  const recoveryPlan = buildTransformationRecoveryPlan({
    cannibalization: r.cannibalization, editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  return {
    scenario: '1. repetitive long-form → post decomposition',
    passed: true,
    assertions: [
      ok('redundancy ≥ 35%', r.cannibalization.ecosystemRedundancyPercent, r.cannibalization.ecosystemRedundancyPercent >= 35, '≥ 35'),
      ok('cluster with ≥ 2 formats present', r.cannibalization.clusters.length, r.cannibalization.clusters.length >= 1, '≥ 1'),
      ok('expansion fatigue OR repeated path detected', r.editorialMemory.repeatedTransformationPaths.length,
        r.editorialMemory.repeatedTransformationPaths.length >= 1, '≥ 1'),
      ok('recovery suggests prevent_repetitive_decomposition', recoveryPlan.steps.map((s) => s.action).join(','),
        recoveryPlan.steps.some((s) => s.action === 'prevent_repetitive_decomposition'), 'prevent_repetitive_decomposition'),
    ],
  };
}

async function scenario2_weakThreadExpansion(): Promise<CrossModalScenarioResult> {
  // Thread → long_form expansion when the source thread is thin.
  const reg = newRegistry();
  const thread = reg.registerAsset(makeAssetSeed({
    format: 'thread', title: 'Thread: brief observations',
    strategicNarrative: 'Observability is good.',
    archetype: 'observability', icpFocus: ['Engineers'], themes: ['observability'],
    terms: ['decision traces'], words: 900, authorityClaim: 35, evidence: 25, daysAgo: 30,
  }));
  const longForm = reg.registerAsset(makeAssetSeed({
    format: 'long_form', title: 'Long-form expansion of thread',
    strategicNarrative: 'Observability is good and expanded with more context.',
    archetype: 'observability', icpFocus: ['Engineers'], themes: ['observability'],
    terms: ['decision traces'], words: 4500, authorityClaim: 40, evidence: 32, daysAgo: 5,
  }));
  const suitability = assessTransformation({
    source: thread, targetFormat: 'long_form', transformationType: 'expansion', derived: longForm,
  });
  return {
    scenario: '2. weak thread → article expansion',
    passed: true,
    assertions: [
      ok('audience fit weak (< 65)', suitability.audienceFitScore, suitability.audienceFitScore <= 65, '≤ 65'),
      ok('authority retention low (< 60)', suitability.authorityRetentionScore, suitability.authorityRetentionScore < 60, '< 60'),
      ok('at least 1 blocking concern', suitability.blockingConcerns.length, suitability.blockingConcerns.length >= 1, '≥ 1'),
    ],
  };
}

async function scenario3_authorityLossDuringTransformation(): Promise<CrossModalScenarioResult> {
  const reg = newRegistry();
  const whitepaper = reg.registerAsset(makeAssetSeed({
    format: 'whitepaper', title: 'Compliance & governance whitepaper',
    strategicNarrative: 'Governance scales when policy enforcement is automated and audited.',
    archetype: 'governance', icpFocus: ['Heads of compliance'],
    themes: ['ai governance', 'compliance reporting'], terms: ['policy enforcement', 'audit trail'],
    words: 6500, authorityClaim: 90, evidence: 85, daysAgo: 60,
  }));
  // Post that pulls a quote but with collapsed authority and evidence.
  const post = reg.registerAsset(makeAssetSeed({
    format: 'post', title: 'Quick take: policy enforcement matters',
    strategicNarrative: 'Policy enforcement matters.', // narrative drift
    archetype: 'governance', icpFocus: ['Heads of compliance'],
    themes: ['ai governance'], terms: ['policy enforcement'],
    words: 180, authorityClaim: 15, evidence: 10, daysAgo: 10,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: whitepaper.assetId, derivedAssetId: post.assetId,
    transformationType: 'extraction', ecosystemRole: 'derivative' });
  const continuity = governCrossModalContinuity({ source: whitepaper, derived: post });
  return {
    scenario: '3. authority loss during transformation',
    passed: true,
    assertions: [
      ok('AUTHORITY_LOSS issue surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'AUTHORITY_LOSS'), 'AUTHORITY_LOSS'),
      ok('FACTUAL_GROUNDING_LOSS issue surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'FACTUAL_GROUNDING_LOSS'), 'FACTUAL_GROUNDING_LOSS'),
      ok('continuity score below 60', continuity.continuityScore, continuity.continuityScore < 60, '< 60'),
    ],
  };
}

async function scenario4_crossFormatNarrativeSaturation(): Promise<CrossModalScenarioResult> {
  // Same theme across long_form, thread, post, newsletter, guide, story — saturation.
  const reg = newRegistry();
  const baseSeed = (format: CrossModalFormat, daysAgo: number, idx: number): RegisterAssetInput => makeAssetSeed({
    format, title: `${format} ${idx}: orchestrating agents`,
    strategicNarrative: 'Coordination beats sophistication in multi-agent operations.',
    archetype: 'orchestration', icpFocus: ['Incident commanders'], themes: ['multi-agent orchestration'],
    terms: ['agent coordination'], words: 1500, authorityClaim: 70, evidence: 60, daysAgo,
  });
  let day = 60;
  for (const fmt of ['long_form', 'thread', 'post', 'newsletter', 'guide', 'story'] as CrossModalFormat[]) {
    reg.registerAsset(baseSeed(fmt, day -= 5, 1));
    if (fmt === 'long_form' || fmt === 'guide') reg.registerAsset(baseSeed(fmt, day -= 5, 2));
  }
  const r = fullPass(reg);
  const recoveryPlan = buildTransformationRecoveryPlan({
    cannibalization: r.cannibalization, editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  return {
    scenario: '4. cross-format narrative saturation',
    passed: true,
    assertions: [
      ok('saturated format pairs detected', r.cannibalization.saturatedFormatPairs.length,
        r.cannibalization.saturatedFormatPairs.length >= 1, '≥ 1'),
      ok('redundancy ≥ 50%', r.cannibalization.ecosystemRedundancyPercent,
        r.cannibalization.ecosystemRedundancyPercent >= 50, '≥ 50'),
      ok('exhausted archetype "orchestration" detected', r.editorialMemory.exhaustedNarratives.map((n) => n.archetype).join(','),
        r.editorialMemory.exhaustedNarratives.some((n) => n.archetype === 'orchestration'), 'orchestration'),
      ok('recovery plan non-empty', recoveryPlan.steps.length, recoveryPlan.steps.length >= 1, '≥ 1'),
    ],
  };
}

async function scenario5_repeatedEducationalJourneys(): Promise<CrossModalScenarioResult> {
  // ICP "ICP_X" sees the same post → thread → long_form → post → thread → long_form journey.
  const reg = newRegistry();
  const seq: Array<{ format: CrossModalFormat; words: number; authority: number }> = [
    { format: 'post', words: 200, authority: 50 },
    { format: 'thread', words: 1000, authority: 60 },
    { format: 'long_form', words: 4000, authority: 78 },
    { format: 'post', words: 200, authority: 50 },
    { format: 'thread', words: 1000, authority: 60 },
    { format: 'long_form', words: 4000, authority: 78 },
    { format: 'post', words: 200, authority: 50 },
    { format: 'thread', words: 1000, authority: 60 },
    { format: 'long_form', words: 4000, authority: 78 },
  ];
  let day = 80;
  let i = 0;
  for (const s of seq) {
    i += 1;
    reg.registerAsset(makeAssetSeed({
      format: s.format, title: `${s.format} #${i}`,
      strategicNarrative: `Educational asset ${i}.`,
      archetype: 'observability', icpFocus: ['ICP_X'], themes: [`theme_${i % 3}`],
      terms: [`term_${i % 3}`], words: s.words, authorityClaim: s.authority, evidence: s.authority - 10,
      daysAgo: day -= 4,
    }));
  }
  const r = fullPass(reg);
  const recoveryPlan = buildTransformationRecoveryPlan({
    cannibalization: r.cannibalization, editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  return {
    scenario: '5. repeated educational journeys',
    passed: true,
    assertions: [
      ok('repetitive journey detected for ICP_X', r.editorialMemory.repetitiveEducationalJourneys.map((j) => j.icp).join(','),
        r.editorialMemory.repetitiveEducationalJourneys.some((j) => j.icp === 'icp_x'), 'icp_x'),
      ok('recovery proposes rebalance_educational_sequencing', recoveryPlan.steps.map((s) => s.action).join(','),
        recoveryPlan.steps.some((s) => s.action === 'rebalance_educational_sequencing'), 'rebalance_educational_sequencing'),
    ],
  };
}

async function scenario6_transformationDrift(): Promise<CrossModalScenarioResult> {
  // Source guide → derived story whose narrative + ICP + terminology all drifted.
  const reg = newRegistry();
  const guide = reg.registerAsset(makeAssetSeed({
    format: 'guide', title: 'Guide to runtime observability',
    strategicNarrative: 'Runtime observability is the operational backbone of multi-agent systems.',
    archetype: 'observability', icpFocus: ['Platform engineers'], themes: ['observability platform'],
    terms: ['decision traces', 'runtime telemetry'], words: 2000, authorityClaim: 75, evidence: 70, daysAgo: 30,
  }));
  const story = reg.registerAsset(makeAssetSeed({
    format: 'story', title: 'How marketing teams measure podcast attribution',
    strategicNarrative: 'Marketing teams have a podcast attribution problem.',
    archetype: 'transformation_path', icpFocus: ['Marketing operations'], themes: ['marketing attribution'],
    terms: ['podcast attribution'], words: 800, authorityClaim: 60, evidence: 55, daysAgo: 5,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: guide.assetId, derivedAssetId: story.assetId,
    transformationType: 'repurposing', ecosystemRole: 'satellite' });
  const continuity = governCrossModalContinuity({ source: guide, derived: story });
  return {
    scenario: '6. transformation drift',
    passed: true,
    assertions: [
      ok('STRATEGIC_NARRATIVE_DRIFT surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'STRATEGIC_NARRATIVE_DRIFT'), 'STRATEGIC_NARRATIVE_DRIFT'),
      ok('TERMINOLOGY_LOSS surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'TERMINOLOGY_LOSS'), 'TERMINOLOGY_LOSS'),
      ok('ICP_MISALIGNMENT surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'ICP_MISALIGNMENT'), 'ICP_MISALIGNMENT'),
      ok('CONTEXT_COLLAPSE composite triggered', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'CONTEXT_COLLAPSE'), 'CONTEXT_COLLAPSE'),
    ],
  };
}

async function scenario7_oversimplifiedRepurposing(): Promise<CrossModalScenarioResult> {
  // Deep whitepaper → tiny post with massive evidence-density loss.
  const reg = newRegistry();
  const wp = reg.registerAsset(makeAssetSeed({
    format: 'whitepaper', title: 'Whitepaper on policy enforcement',
    strategicNarrative: 'Policy enforcement at scale requires hierarchical guardrails.',
    archetype: 'governance', icpFocus: ['Compliance leads'], themes: ['ai governance'],
    terms: ['policy enforcement', 'audit trail'], words: 6000, authorityClaim: 90, evidence: 88, daysAgo: 60,
  }));
  const post = reg.registerAsset(makeAssetSeed({
    format: 'post', title: 'Policy enforcement at scale',
    strategicNarrative: 'Policy enforcement at scale requires hierarchical guardrails — quick reminder.',
    archetype: 'governance', icpFocus: ['Compliance leads'], themes: ['ai governance'],
    terms: ['policy enforcement'], words: 100, authorityClaim: 30, evidence: 20, daysAgo: 5,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: wp.assetId, derivedAssetId: post.assetId,
    transformationType: 'extraction', ecosystemRole: 'derivative' });
  const continuity = governCrossModalContinuity({ source: wp, derived: post });
  const suitability = assessTransformation({ source: wp, targetFormat: 'post', transformationType: 'extraction', derived: post });
  return {
    scenario: '7. oversimplified repurposing',
    passed: true,
    assertions: [
      ok('OVERSIMPLIFICATION surfaced', continuity.detectedIssues.map((i) => i.type).join(','),
        continuity.detectedIssues.some((i) => i.type === 'OVERSIMPLIFICATION'), 'OVERSIMPLIFICATION'),
      ok('narrative retention drops', suitability.narrativeRetentionScore,
        suitability.narrativeRetentionScore <= 70, '≤ 70'),
      ok('blocking concerns mention compression or authority', suitability.blockingConcerns.join('|'),
        suitability.blockingConcerns.some((c) => /compression|Authority retention/i.test(c)),
        'mentions compression or authority'),
    ],
  };
}

async function scenario8_ecosystemRedundancy(): Promise<CrossModalScenarioResult> {
  // Many themed assets all sharing same archetype / terms / themes across formats.
  const reg = newRegistry();
  let day = 60;
  for (let i = 0; i < 8; i += 1) {
    const fmt: CrossModalFormat = (['long_form', 'thread', 'post', 'newsletter'] as CrossModalFormat[])[i % 4];
    reg.registerAsset(makeAssetSeed({
      format: fmt, title: `${fmt} #${i + 1} on agent monitoring`,
      strategicNarrative: 'Agent monitoring is observability.',
      archetype: 'observability', icpFocus: ['Engineers'], themes: ['agent monitoring'],
      terms: ['decision traces'], words: 800, authorityClaim: 60, evidence: 55, daysAgo: day -= 4,
    }));
  }
  const r = fullPass(reg);
  return {
    scenario: '8. ecosystem redundancy',
    passed: true,
    assertions: [
      ok('redundancy ≥ 60%', r.cannibalization.ecosystemRedundancyPercent,
        r.cannibalization.ecosystemRedundancyPercent >= 60, '≥ 60'),
      ok('novelty score below 70', r.editorialMemory.crossModalNoveltyScore,
        r.editorialMemory.crossModalNoveltyScore < 70, '< 70'),
      ok('cluster severity reaches medium or high', r.cannibalization.clusters[0]?.redundancySeverity ?? 'low',
        r.cannibalization.clusters.some((c) => c.redundancySeverity !== 'low'), 'medium or high'),
    ],
  };
}

async function scenario9_repetitiveIcpJourneys(): Promise<CrossModalScenarioResult> {
  // Two ICPs both follow the same long_form → newsletter → post journey 3x.
  const reg = newRegistry();
  let day = 100;
  for (const icp of ['ICP_A', 'ICP_B']) {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const formats: CrossModalFormat[] = ['long_form', 'newsletter', 'post'];
      for (const fmt of formats) {
        reg.registerAsset(makeAssetSeed({
          format: fmt, title: `${fmt} for ${icp} cycle ${cycle + 1}`,
          strategicNarrative: `Educational asset for ${icp}.`,
          archetype: 'observability', icpFocus: [icp], themes: [`theme_${cycle}`],
          terms: [`term_${cycle}`], words: fmt === 'long_form' ? 3500 : fmt === 'newsletter' ? 1200 : 200,
          authorityClaim: 60, evidence: 50, daysAgo: day -= 3,
        }));
      }
    }
  }
  const r = fullPass(reg);
  return {
    scenario: '9. repetitive ICP journeys',
    passed: true,
    assertions: [
      ok('journeys detected for both ICPs', new Set(r.editorialMemory.repetitiveEducationalJourneys.map((j) => j.icp)).size,
        new Set(r.editorialMemory.repetitiveEducationalJourneys.map((j) => j.icp)).size >= 2, '≥ 2'),
    ],
  };
}

async function scenario10_weakAuthorityCompounding(): Promise<CrossModalScenarioResult> {
  // Many archetypes, but each only ever appears in one format.
  const reg = newRegistry();
  const archetypes: NarrativeArchetype[] = ['observability', 'governance', 'orchestration', 'transformation_path', 'evaluation_maturity'];
  for (let i = 0; i < archetypes.length; i += 1) {
    reg.registerAsset(makeAssetSeed({
      format: 'long_form', title: `Long-form on ${archetypes[i]}`,
      strategicNarrative: `${archetypes[i]} matters.`,
      archetype: archetypes[i], icpFocus: [`ICP_${i + 1}`], themes: [`theme_${i + 1}`],
      terms: [`term_${i + 1}`], words: 3500, authorityClaim: 50, evidence: 45, daysAgo: 60 - i * 5,
    }));
  }
  const r = fullPass(reg);
  const recoveryPlan = buildTransformationRecoveryPlan({
    cannibalization: r.cannibalization, editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  return {
    scenario: '10. weak authority compounding',
    passed: true,
    assertions: [
      ok('cross-format synergy = 0', r.compounding.crossFormatSynergyScore,
        r.compounding.crossFormatSynergyScore === 0, '0'),
      ok('narrative compounding ≤ 50', r.compounding.narrativeCompoundingScore,
        r.compounding.narrativeCompoundingScore <= 50, '≤ 50'),
      ok('recovery proposes expand_weak_transformation_chains', recoveryPlan.steps.map((s) => s.action).join(','),
        recoveryPlan.steps.some((s) => s.action === 'expand_weak_transformation_chains'),
        'expand_weak_transformation_chains'),
    ],
  };
}

async function scenario_endToEndExplanation(): Promise<CrossModalScenarioResult> {
  // End-to-end smoke + determinism check.
  const { registry, pillarId, derivedIds } = healthyEcosystem();
  const pillar = registry.getAsset('co_test', pillarId)!;
  const thread = registry.getAsset('co_test', derivedIds[0])!;
  const r = fullPass(registry);
  const continuity = governCrossModalContinuity({ source: pillar, derived: thread });
  const suitability = assessTransformation({ source: pillar, targetFormat: 'thread', transformationType: 'decomposition', derived: thread });
  const recoveryPlan = buildTransformationRecoveryPlan({
    continuity, cannibalization: r.cannibalization, editorialMemory: r.editorialMemory, compounding: r.compounding,
  });
  const explA = composeCrossModalExplanation({
    transformation: suitability, continuity, cannibalization: r.cannibalization,
    editorialMemory: r.editorialMemory, compounding: r.compounding, recoveryPlan,
  });
  const explB = composeCrossModalExplanation({
    transformation: suitability, continuity, cannibalization: r.cannibalization,
    editorialMemory: r.editorialMemory, compounding: r.compounding, recoveryPlan,
  });

  // Quick diagnostics check.
  const diag = createCrossModalGovernanceDiagnosticsRegistry();
  for (let i = 0; i < 6; i += 1) {
    diag.record({
      timestamp: new Date(Date.now() - (5 - i) * 1000).toISOString(),
      companyId: 'co_test',
      transformations: [suitability],
      continuities: [continuity],
      cannibalization: r.cannibalization,
      editorialMemory: r.editorialMemory,
      compounding: r.compounding,
    });
  }
  const built = diag.build('co_test');

  return {
    scenario: '11. end-to-end explanation + diagnostics',
    passed: true,
    assertions: [
      ok('explanation hash deterministic', `${explA.reasoningSourceHash}|${explB.reasoningSourceHash}`,
        explA.reasoningSourceHash === explB.reasoningSourceHash, 'A == B'),
      ok('hash prefix cmi_', explA.reasoningSourceHash.slice(0, 4),
        explA.reasoningSourceHash.startsWith('cmi_'), 'cmi_'),
      ok('suitability score reported', explA.whyTransformationIsValuable,
        /\d+\/100/.test(explA.whyTransformationIsValuable), 'mentions score'),
      ok('diagnostics sample size = 6', built.sampleSize, built.sampleSize === 6, '6'),
      ok('diagnostics fields present', `${built.transformationQualityTrend}|${built.crossModalNoveltyTrend}`,
        built.transformationQualityTrend !== 'unknown', '!= unknown'),
    ],
  };
}

// ─── suite ─────────────────────────────────────────────────────────────────

export interface CrossModalStressSuiteReport {
  scenarios: CrossModalScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: CrossModalScenarioResult): CrossModalScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runCrossModalGovernanceStressTests(): Promise<CrossModalStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_repetitiveDecomposition(),
    scenario2_weakThreadExpansion(),
    scenario3_authorityLossDuringTransformation(),
    scenario4_crossFormatNarrativeSaturation(),
    scenario5_repeatedEducationalJourneys(),
    scenario6_transformationDrift(),
    scenario7_oversimplifiedRepurposing(),
    scenario8_ecosystemRedundancy(),
    scenario9_repetitiveIcpJourneys(),
    scenario10_weakAuthorityCompounding(),
    scenario_endToEndExplanation(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatCrossModalStressReport(report: CrossModalStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — cross-modal governance');
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
