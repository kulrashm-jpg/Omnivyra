/**
 * Phase 11 — Portfolio governance stress tests.
 *
 * Synthetic portfolios + assertions across all portfolio governance layers.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormPortfolioGovernanceStress.ts
 */

import type {
  ContentAlignmentMode,
  ContentPortfolioAsset,
  NarrativeArchetype,
  TargetBuyerStage,
} from './longFormRecommendationTypes';
import { buildAuthorityMap } from './authorityMapEngine';
import { analyzeContentCannibalization } from './contentCannibalizationAnalyzer';
import { sequenceNextContent } from './strategicSequencingEngine';
import { analyzeEditorialMemory } from './editorialMemoryEngine';
import { governPortfolioContinuity } from './portfolioContinuityGovernor';
import { analyzeFunnelCoverage } from './funnelCoverageAnalyzer';
import { scorePortfolioContext, rerankRecommendationsByPortfolio } from './portfolioAwareRecommendationExtension';
import { buildPortfolioRecoveryPlan } from './portfolioRecoveryCoordinator';
import { composePortfolioIntelligenceExplanation } from './portfolioIntelligenceExplanationComposer';

// ────────────────────────────────────────────────────────────────────────────
// Asset fixture builder
// ────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

interface AssetSeed {
  title: string;
  strategicNarrative: string;
  editorialAngle: string;
  funnelStage: TargetBuyerStage;
  archetype: NarrativeArchetype;
  icpFocus: string[];
  capabilityEmphasis: string[];
  authorityThemes: string[];
  terminologyClusters: string[];
  contentMode?: ContentAlignmentMode;
  intentTags?: string[];
  daysAgo?: number;
}

function makeAsset(seed: AssetSeed): ContentPortfolioAsset {
  idCounter += 1;
  const publishedAt = isoDaysAgo(seed.daysAgo ?? Math.max(1, 60 - idCounter));
  return {
    articleId: `art_${idCounter.toString(36)}`,
    strategicNarrative: seed.strategicNarrative,
    editorialAngle: seed.editorialAngle,
    icpFocus: seed.icpFocus,
    funnelStage: seed.funnelStage,
    capabilityEmphasis: seed.capabilityEmphasis,
    authorityThemes: seed.authorityThemes,
    terminologyClusters: seed.terminologyClusters,
    narrativeArchetype: seed.archetype,
    contentMode: seed.contentMode ?? 'company_context_led',
    publicationStatus: 'published',
    revisionMaturity: 'mature',
    strategicIntentTags: seed.intentTags ?? [],
    publishedAt,
    lastUpdatedAt: publishedAt,
    title: seed.title,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Common assertion helpers
// ────────────────────────────────────────────────────────────────────────────

export interface PortfolioAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface PortfolioScenarioResult {
  scenario: string;
  assertions: PortfolioAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): PortfolioAssertion {
  return { name, observed, passed, expected };
}

interface PortfolioPassOutput {
  assets: ContentPortfolioAsset[];
  authorityMap: ReturnType<typeof buildAuthorityMap>;
  funnelCoverage: ReturnType<typeof analyzeFunnelCoverage>;
  cannibalization: ReturnType<typeof analyzeContentCannibalization>;
  memory: ReturnType<typeof analyzeEditorialMemory>;
  continuity: ReturnType<typeof governPortfolioContinuity>;
  sequencing: ReturnType<typeof sequenceNextContent>;
  recoveryPlan: ReturnType<typeof buildPortfolioRecoveryPlan>;
}

function runPortfolioPass(assets: ContentPortfolioAsset[]): PortfolioPassOutput {
  const authorityMap = buildAuthorityMap({ assets });
  const funnelCoverage = analyzeFunnelCoverage({ assets });
  const cannibalization = analyzeContentCannibalization({ assets });
  const memory = analyzeEditorialMemory({ assets });
  const continuity = governPortfolioContinuity({ assets, authorityMap, memory });
  const sequencing = sequenceNextContent({ assets, authorityMap, funnelCoverage });
  const recoveryPlan = buildPortfolioRecoveryPlan({ cannibalization, funnelCoverage, authorityMap, continuity });
  return { assets, authorityMap, funnelCoverage, cannibalization, memory, continuity, sequencing, recoveryPlan };
}

// ────────────────────────────────────────────────────────────────────────────
// Common base portfolio
// ────────────────────────────────────────────────────────────────────────────

function baseHealthyPortfolio(): ContentPortfolioAsset[] {
  idCounter = 0;
  return [
    makeAsset({
      title: 'What silent agent failures look like in production',
      strategicNarrative: 'Observability is the runtime checkpoint mechanism.',
      editorialAngle: 'Frame observability as a runtime checkpoint.',
      funnelStage: 'awareness',
      archetype: 'observability',
      icpFocus: ['Platform engineers'],
      capabilityEmphasis: ['decision-trace observability'],
      authorityThemes: ['observability platform'],
      terminologyClusters: ['decision traces'],
      intentTags: ['decision-traces'],
      daysAgo: 60,
    }),
    makeAsset({
      title: 'Governance patterns for production AI agents',
      strategicNarrative: 'Governance scales when policy enforcement is automated.',
      editorialAngle: 'Policy enforcement as the governance primitive.',
      funnelStage: 'consideration',
      archetype: 'governance',
      icpFocus: ['Heads of compliance'],
      capabilityEmphasis: ['policy enforcement engine'],
      authorityThemes: ['ai governance'],
      terminologyClusters: ['policy enforcement'],
      intentTags: ['governance'],
      daysAgo: 45,
    }),
    makeAsset({
      title: 'Orchestrating multi-agent incident response',
      strategicNarrative: 'Coordination beats sophistication in multi-agent operations.',
      editorialAngle: 'Coordination patterns for production reliability.',
      funnelStage: 'evaluation',
      archetype: 'orchestration',
      icpFocus: ['Incident commanders'],
      capabilityEmphasis: ['orchestration runtime'],
      authorityThemes: ['multi-agent orchestration'],
      terminologyClusters: ['agent coordination'],
      intentTags: ['orchestration'],
      daysAgo: 30,
    }),
    makeAsset({
      title: 'Picking an AI ops platform: vendor evaluation criteria',
      strategicNarrative: 'Vendor evaluation should weight runtime auditability above feature parity.',
      editorialAngle: 'Vendor evaluation criteria for AI ops platforms.',
      funnelStage: 'decision',
      archetype: 'comparative_decision',
      icpFocus: ['CTOs'],
      capabilityEmphasis: ['vendor evaluation framework'],
      authorityThemes: ['vendor evaluation'],
      terminologyClusters: ['evaluation matrix'],
      intentTags: ['comparison'],
      daysAgo: 15,
    }),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// 10 adversarial scenarios + baseline
// ────────────────────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<PortfolioScenarioResult> {
  const r = runPortfolioPass(baseHealthyPortfolio());
  return {
    scenario: 'baseline. healthy small portfolio',
    passed: true,
    assertions: [
      ok('ecosystem coherence ≥ 60', r.continuity.ecosystemCoherenceScore, r.continuity.ecosystemCoherenceScore >= 60, '≥ 60'),
      ok('no high-severity continuity issues', r.continuity.detectedIssues.filter((i) => i.severity === 'high').length,
        r.continuity.detectedIssues.filter((i) => i.severity === 'high').length === 0, '0'),
      ok('no cannibalization clusters', r.cannibalization.clusters.length, r.cannibalization.clusters.length === 0, '0'),
    ],
  };
}

async function scenario1_repeatedSEOTopic(): Promise<PortfolioScenarioResult> {
  // Many articles with same head bigram + same archetype + same theme.
  idCounter = 0;
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 5; i += 1) {
    assets.push(makeAsset({
      title: `How to monitor AI agents — guide ${i + 1}`,
      strategicNarrative: 'Decision-trace observability sequenced before evals.',
      editorialAngle: 'Operational walk-through of monitoring agents.',
      funnelStage: 'awareness',
      archetype: 'observability',
      icpFocus: ['Engineering leaders'],
      capabilityEmphasis: ['agent observability'],
      authorityThemes: ['observability', 'agent monitoring'],
      terminologyClusters: ['agent observability', 'decision traces'],
      intentTags: ['how-to'],
      daysAgo: 60 - i * 8,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '1. repeated SEO topic generation',
    passed: true,
    assertions: [
      ok('at least 1 duplication cluster', r.cannibalization.clusters.length, r.cannibalization.clusters.length >= 1, '≥ 1'),
      ok('cluster size ≥ 3', Math.max(0, ...r.cannibalization.clusters.map((c) => c.articleIds.length)),
        Math.max(0, ...r.cannibalization.clusters.map((c) => c.articleIds.length)) >= 3, '≥ 3'),
      ok('recovery deprioritizes redundant recs', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'deprioritize_redundant_recommendation'),
        'deprioritize_redundant_recommendation'),
    ],
  };
}

async function scenario2_narrativeOversaturation(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // 8 articles all in the same archetype.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 8; i += 1) {
    assets.push(makeAsset({
      title: `Observability essay ${i + 1}`,
      strategicNarrative: 'Observability matters in many ways.',
      editorialAngle: `Essay #${i + 1} on observability.`,
      funnelStage: i % 2 === 0 ? 'awareness' : 'consideration',
      archetype: 'observability',
      icpFocus: [i % 3 === 0 ? 'Engineering leaders' : 'Platform engineers'],
      capabilityEmphasis: ['runtime telemetry'],
      authorityThemes: ['observability'],
      terminologyClusters: ['observability'],
      intentTags: ['essay'],
      daysAgo: 60 - i * 5,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '2. narrative oversaturation',
    passed: true,
    assertions: [
      ok('weak narrative zones surfaced', r.authorityMap.weakNarrativeZones.length, r.authorityMap.weakNarrativeZones.length >= 5, '≥ 5'),
      ok('recovery diversifies narratives', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'diversify_narratives'), 'diversify_narratives'),
    ],
  };
}

async function scenario3_icpTunnelVision(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // All articles target the same single ICP — others underserved.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 6; i += 1) {
    assets.push(makeAsset({
      title: `Engineering leaders deep dive ${i + 1}`,
      strategicNarrative: `Engineering leaders should care about X #${i + 1}.`,
      editorialAngle: `Angle ${i + 1} for engineering leaders.`,
      funnelStage: (['awareness','consideration','evaluation','decision','expansion'] as TargetBuyerStage[])[i % 5],
      archetype: (['observability', 'governance', 'orchestration', 'evaluation_maturity', 'authority_positioning'] as NarrativeArchetype[])[i % 5],
      icpFocus: ['Engineering leaders'],
      capabilityEmphasis: ['platform integration'],
      authorityThemes: [`theme_${i}`],
      terminologyClusters: [`term_${i}`],
      daysAgo: 50 - i * 6,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '3. ICP tunnel vision',
    passed: true,
    assertions: [
      // Sequencing should suggest icp expansion OR funnel balance.
      ok('sequencing surfaces gaps', r.sequencing.nextRecommendations.length, r.sequencing.nextRecommendations.length >= 3, '≥ 3'),
      ok('only one unique ICP', new Set(assets.flatMap((a) => a.icpFocus)).size, new Set(assets.flatMap((a) => a.icpFocus)).size === 1, '1'),
    ],
  };
}

async function scenario4_funnelImbalance(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // All TOFU, no MOFU/BOFU.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 5; i += 1) {
    assets.push(makeAsset({
      title: `TOFU primer ${i + 1}`,
      strategicNarrative: `Awareness piece ${i + 1}.`,
      editorialAngle: `Primer ${i + 1}.`,
      funnelStage: 'awareness',
      archetype: 'category_definition',
      icpFocus: [`ICP ${i + 1}`],
      capabilityEmphasis: [`cap ${i + 1}`],
      authorityThemes: [`theme ${i + 1}`],
      terminologyClusters: [`term ${i + 1}`],
      daysAgo: 50 - i * 6,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '4. funnel imbalance (all TOFU)',
    passed: true,
    assertions: [
      ok('funnel imbalance detected', r.funnelCoverage.imbalanceDetected ? 'true' : 'false', r.funnelCoverage.imbalanceDetected, 'true'),
      ok('missing educational progression flagged', r.funnelCoverage.missingEducationalProgression.length, r.funnelCoverage.missingEducationalProgression.length > 0, '> 0'),
      ok('recovery rebalances funnel', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'rebalance_funnel_stages'), 'rebalance_funnel_stages'),
    ],
  };
}

async function scenario5_contradictoryPositioning(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  const assets: ContentPortfolioAsset[] = [
    makeAsset({
      title: 'Sequence observability before evals',
      strategicNarrative: 'Observability only works when sequenced before eval suites.',
      editorialAngle: 'Pre-eval observability is the path.',
      funnelStage: 'evaluation',
      archetype: 'observability',
      icpFocus: ['Engineering leaders'],
      capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'],
      terminologyClusters: ['agent observability'],
      daysAgo: 60,
    }),
    makeAsset({
      title: 'Run observability alongside evals',
      strategicNarrative: 'Observability and evals should run alongside each other instead of sequenced before.',
      editorialAngle: 'Parallel observability and evals.',
      funnelStage: 'evaluation',
      archetype: 'observability',
      icpFocus: ['Engineering leaders'],
      capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'],
      terminologyClusters: ['agent observability'],
      daysAgo: 20,
    }),
  ];
  const r = runPortfolioPass(assets);
  return {
    scenario: '5. contradictory positioning',
    passed: true,
    assertions: [
      ok('STRATEGIC_INCONSISTENCY detected', r.continuity.detectedIssues.map((i) => i.type).join(','),
        r.continuity.detectedIssues.some((i) => i.type === 'STRATEGIC_INCONSISTENCY'), 'STRATEGIC_INCONSISTENCY'),
      ok('recovery resolves positioning', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'resolve_positioning_conflicts'), 'resolve_positioning_conflicts'),
    ],
  };
}

async function scenario6_repetitiveOperationalFraming(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // Same operational framing across many articles.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 5; i += 1) {
    assets.push(makeAsset({
      title: `Operational walk-through ${i + 1}`,
      strategicNarrative: 'Operational walk-through of the runtime telemetry workflow.',
      editorialAngle: 'Operational walk-through of decision traces.',
      funnelStage: 'evaluation',
      archetype: 'orchestration',
      icpFocus: [`ICP ${i + 1}`],
      capabilityEmphasis: ['runtime telemetry'],
      authorityThemes: ['operational walk-throughs'],
      terminologyClusters: ['operational walk-through'],
      intentTags: ['walk-through'],
      daysAgo: 55 - i * 6,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '6. repetitive operational framing',
    passed: true,
    assertions: [
      ok('repeated patterns detected', r.memory.repeatedPatterns.length, r.memory.repeatedPatterns.length >= 1, '≥ 1'),
      ok('editorial novelty drops', r.memory.editorialNoveltyScore, r.memory.editorialNoveltyScore < 70, '< 70'),
    ],
  };
}

async function scenario7_authorityDeadZones(): Promise<PortfolioScenarioResult> {
  // Healthy portfolio + expectedCoverage that includes unaddressed themes.
  const assets = baseHealthyPortfolio();
  const authorityMap = buildAuthorityMap({
    assets,
    expectedCoverage: {
      themes: ['governance', 'compliance reporting'],
      icpPains: ['CFOs at growth-stage SaaS', 'Heads of compliance'],
    },
  });
  return {
    scenario: '7. authority dead zones (vs expected coverage)',
    passed: true,
    assertions: [
      ok('high-severity gaps surface', authorityMap.authorityGapAreas.filter((g) => g.gapSeverity === 'high').length,
        authorityMap.authorityGapAreas.filter((g) => g.gapSeverity === 'high').length >= 2, '≥ 2'),
    ],
  };
}

async function scenario8_overuseTerminology(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // Same 4 terms in every asset.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 6; i += 1) {
    assets.push(makeAsset({
      title: `Article ${i + 1}`,
      strategicNarrative: `Narrative ${i + 1}.`,
      editorialAngle: `Angle ${i + 1}.`,
      funnelStage: (['awareness','consideration','evaluation','decision'] as TargetBuyerStage[])[i % 4],
      archetype: (['observability','governance','orchestration','transformation_path'] as NarrativeArchetype[])[i % 4],
      icpFocus: [`ICP ${i + 1}`],
      capabilityEmphasis: [`cap ${i + 1}`],
      authorityThemes: ['agent observability', 'decision traces', 'runtime telemetry', 'audit trail'],
      terminologyClusters: ['agent observability', 'decision traces', 'runtime telemetry', 'audit trail'],
      daysAgo: 55 - i * 6,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '8. overuse of terminology clusters',
    passed: true,
    assertions: [
      ok('fatigued terminology detected', r.memory.fatiguedTerminology.length, r.memory.fatiguedTerminology.length >= 3, '≥ 3'),
      ok('editorial novelty drops', r.memory.editorialNoveltyScore, r.memory.editorialNoveltyScore < 75, '< 75'),
    ],
  };
}

async function scenario9_strategicDriftOverTime(): Promise<PortfolioScenarioResult> {
  idCounter = 0;
  // First half: observability narrative. Second half: governance narrative.
  const assets: ContentPortfolioAsset[] = [];
  for (let i = 0; i < 4; i += 1) {
    assets.push(makeAsset({
      title: `Observability piece ${i + 1}`,
      strategicNarrative: 'Observability sequenced before evals.',
      editorialAngle: 'Decision-trace observability.',
      funnelStage: 'awareness',
      archetype: 'observability',
      icpFocus: ['Engineering leaders'],
      capabilityEmphasis: ['decision traces'],
      authorityThemes: ['observability'],
      terminologyClusters: ['decision traces'],
      daysAgo: 80 - i * 8,
    }));
  }
  for (let i = 0; i < 4; i += 1) {
    assets.push(makeAsset({
      title: `Governance piece ${i + 1}`,
      strategicNarrative: 'Governance and compliance for AI agents.',
      editorialAngle: 'AI governance framework.',
      funnelStage: 'consideration',
      archetype: 'governance',
      icpFocus: ['Heads of compliance'],
      capabilityEmphasis: ['policy enforcement'],
      authorityThemes: ['governance'],
      terminologyClusters: ['policy enforcement'],
      daysAgo: 35 - i * 6,
    }));
  }
  const r = runPortfolioPass(assets);
  return {
    scenario: '9. strategic drift over time',
    passed: true,
    assertions: [
      ok('positioning drift detected', r.memory.positioningDrift.detected ? 'true' : 'false', r.memory.positioningDrift.detected, 'true'),
      ok('ecosystem drift OR fragmentation flagged', r.continuity.detectedIssues.map((i) => i.type).join(','),
        r.continuity.detectedIssues.some((i) => i.type === 'ECOSYSTEM_DRIFT' || i.type === 'PORTFOLIO_FRAGMENTATION'),
        'ECOSYSTEM_DRIFT or PORTFOLIO_FRAGMENTATION'),
    ],
  };
}

async function scenario10_duplicateRecommendationFamilies(): Promise<PortfolioScenarioResult> {
  // Healthy portfolio + a recommendation that targets a saturated area.
  const assets = baseHealthyPortfolio();
  const authorityMap = buildAuthorityMap({ assets });
  const funnelCoverage = analyzeFunnelCoverage({ assets });
  const cannibalization = analyzeContentCannibalization({ assets });
  const memory = analyzeEditorialMemory({ assets });
  const continuity = governPortfolioContinuity({ assets, authorityMap, memory });
  const recoveryPlan = buildPortfolioRecoveryPlan({ cannibalization, funnelCoverage, authorityMap, continuity });

  const candidateRec = {
    recommendationId: 'rec_duplicate_candidate',
    recommendationTitle: 'A framework for decision-trace observability',
    editorialAngle: 'Introduce the decision-trace framework.',
    contentAlignmentMode: 'company_context_led' as const,
    recommendedContentType: 'guide' as const,
    companyAlignmentScore: 80,
    commercialRelevanceScore: 70,
    authorityBuildingScore: 76,
    operationalDepthScore: 76,
    seoOpportunityScore: 58,
    overallRecommendationStrength: 76,
    whyThisFitsCompany: {
      summary: 'Topic emerges from runtime telemetry.',
      icpProblemMapping: 'Engineering leaders: silent agent failures.',
      capabilityConnection: 'runtime telemetry workflow',
      businessContextOrigin: 'AI Ops platform.',
    },
    targetBuyerStage: 'consideration' as TargetBuyerStage,
    strategicNarrative: 'Decision boundaries instrumented at runtime.',
    recommendedContentDirection: {
      primaryAngle: 'Framework introduction.',
      operationalProof: ['Decision sequence.'],
      avoidPatterns: ['Generic best practices.'],
    },
    narrativeArchetype: 'observability' as NarrativeArchetype,
    familyClusterId: 'cl_obs',
    familyClusterLabel: 'observability · telemetry_and_visibility',
  };

  const context = scorePortfolioContext({ recommendation: candidateRec, assets, authorityMap, funnelCoverage });
  const reranked = rerankRecommendationsByPortfolio({
    recommendations: [candidateRec], assets, authorityMap, funnelCoverage,
  });
  const explanation = composePortfolioIntelligenceExplanation({
    candidate: context, authorityMap, funnelCoverage, cannibalization, continuity, memory, recoveryPlan,
  });

  return {
    scenario: '10. duplicate recommendation families',
    passed: true,
    assertions: [
      ok('cannibalization risk surfaced', context.cannibalizationRiskScore, context.cannibalizationRiskScore >= 30, '≥ 30'),
      ok('matched cluster article id', context.matchedClusterId ?? '(none)', !!context.matchedClusterId, 'present'),
      ok('reranked recommendation context returned', reranked.length, reranked.length === 1, '1'),
      ok('explanation surfaces cannibalization risk', explanation.whyCannibalizationRiskExists.length, explanation.whyCannibalizationRiskExists.length > 30, '> 30 chars'),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

export interface PortfolioStressSuiteReport {
  scenarios: PortfolioScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: PortfolioScenarioResult): PortfolioScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runPortfolioGovernanceStressTests(): Promise<PortfolioStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_repeatedSEOTopic(),
    scenario2_narrativeOversaturation(),
    scenario3_icpTunnelVision(),
    scenario4_funnelImbalance(),
    scenario5_contradictoryPositioning(),
    scenario6_repetitiveOperationalFraming(),
    scenario7_authorityDeadZones(),
    scenario8_overuseTerminology(),
    scenario9_strategicDriftOverTime(),
    scenario10_duplicateRecommendationFamilies(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatPortfolioStressReport(report: PortfolioStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — portfolio governance');
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
