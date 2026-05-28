/**
 * Phase 8 — Quality stress tests.
 *
 * Self-contained harness. Builds 7 synthetic scenarios that stress the
 * deterministic parts of the long-form recommendation pipeline (foundation
 * derivation, family clustering, narrative shape guard, set balancer,
 * memory novelty). NO LLM calls — reproducible and free.
 *
 * Scenarios:
 *   1. weak company context           — only 2 sections populated
 *   2. sparse ICP data                — no marketPainPoints
 *   3. overloaded capability lists    — 20 capability entries
 *   4. highly generic SaaS company    — buzzword-heavy positioning
 *   5. overlapping service categories — capabilities all semantically close
 *   6. AI buzzword-heavy profile      — every field mentions "AI" "agents"
 *   7. multi-product organization     — 4 unrelated capability clusters
 *
 * Each scenario asserts a set of quality floors (returned as PASS / FAIL).
 *
 * Run via:
 *   npx tsx scripts/ops/longFormRecommendationStress.ts
 * or programmatically:
 *   import { runStressTests } from '...recommendationStressTests';
 */

import {
  buildCompanyContextFoundation,
  type CompanyContextFoundation,
} from './companyContextFoundation';
import type { CompanyProfile } from '../companyProfileService';
import {
  type LongFormRecommendation,
  type NarrativeArchetype,
} from './longFormRecommendationTypes';
import { groupRecommendationsByFamily } from './recommendationFamilyClustering';
import { applyNarrativeShapeGuard } from './narrativeShapeGuard';
import { balanceRecommendationSet } from './recommendationSetBalancer';
import {
  buildFingerprintFromRecommendation,
  scoreRecommendationNovelty,
} from './recommendationMemory';

// ────────────────────────────────────────────────────────────────────────────
// Profile fixtures
// ────────────────────────────────────────────────────────────────────────────

function blankProfile(): CompanyProfile {
  return { company_id: 'stress_company' } as CompanyProfile;
}

function withFields(overrides: Partial<CompanyProfile>): CompanyProfile {
  return { ...blankProfile(), ...overrides } as CompanyProfile;
}

const PROFILES: Record<string, CompanyProfile> = {
  weakContext: withFields({
    name: 'Stub Co',
    industry: 'Software',
    target_audience: 'Engineering teams',
  }),
  sparseIcp: withFields({
    name: 'Sparse Co',
    industry: 'B2B SaaS',
    category: 'Developer Tools',
    products_services: 'Code review automation',
    products_services_list: ['Code review automation', 'Repository insights'],
    brand_positioning: 'Faster human-grade code review',
    competitive_advantages: 'AST-aware rules; team-specific learning',
  }),
  overloadedCapabilities: withFields({
    name: 'Overload Co',
    industry: 'Platform',
    category: 'AI Ops Platform',
    target_audience: 'Platform engineers at growth-stage SaaS',
    products_services_list: Array.from({ length: 20 }, (_, i) => `Capability bundle ${i + 1}`),
    core_problem_statement: 'Production AI agents drift silently',
    pain_symptoms: ['Output drift', 'Cost spikes', 'Eval gaps'],
    strategic_inputs: {
      strategic_aspects: ['Telemetry', 'Evaluation', 'Governance', 'Cost', 'Adoption'],
      offerings_by_aspect: {
        Telemetry: ['Agent run tracing', 'Latency breakdown', 'Error budgets'],
        Evaluation: ['Live eval suites', 'Regression detection'],
        Governance: ['Policy enforcement', 'Audit trails'],
        Cost: ['Token budgets', 'Cache strategy'],
        Adoption: ['Rollout playbooks', 'Workspace migration'],
      },
      strategic_objectives: ['Predictable AI behavior', 'Lower per-agent cost'],
    } as unknown as CompanyProfile['strategic_inputs'],
  }),
  genericSaas: withFields({
    name: 'Generic SaaS',
    industry: 'SaaS',
    category: 'Productivity',
    target_audience: 'Teams who want to do more',
    brand_positioning: 'The best way to work',
    unique_value: 'Streamline your workflow',
    products_services: 'Productivity suite',
    products_services_list: ['Productivity suite'],
    competitive_advantages: 'Easy to use',
  }),
  overlappingCategories: withFields({
    name: 'Overlap Co',
    industry: 'AI',
    category: 'AI Ops',
    products_services_list: [
      'agent observability platform',
      'agent run tracing',
      'agent telemetry pipeline',
      'agent monitoring dashboards',
      'agent visibility layer',
    ],
    target_audience: 'AI engineering leads',
    core_problem_statement: 'Lack of visibility into agent behavior',
    pain_symptoms: ['Unexplained agent failures', 'Drift between staging and prod'],
  }),
  buzzwordHeavy: withFields({
    name: 'Buzz AI',
    industry: 'Artificial Intelligence',
    category: 'AI Agents',
    target_audience: 'Forward-thinking enterprises ready for AI transformation',
    brand_positioning: 'Leverage AI to transform your business and unlock growth',
    unique_value: 'Cutting-edge AI agents that revolutionize workflows',
    products_services_list: ['AI Agents', 'AI Copilot', 'AI Workflow', 'AI Insights'],
    competitive_advantages: 'Best-in-class AI; next-gen automation',
    pain_symptoms: ['Falling behind on AI', 'Manual processes'],
    core_problem_statement: 'Teams not leveraging AI fast enough',
  }),
  multiProduct: withFields({
    name: 'Multi Co',
    industry: 'Enterprise Software',
    category: 'Platform',
    target_audience: 'CIOs at Fortune 500',
    products_services_list: [
      'Identity governance',
      'Finance reconciliation',
      'Field service routing',
      'Customer feedback analytics',
    ],
    strategic_inputs: {
      strategic_aspects: ['Identity', 'Finance', 'Field Ops', 'CX'],
      offerings_by_aspect: {
        Identity: ['Access reviews', 'Provisioning'],
        Finance: ['Auto-reconciliation', 'Variance detection'],
        'Field Ops': ['Dispatch optimization', 'Tech routing'],
        CX: ['Sentiment clustering', 'Voice-of-customer'],
      },
      strategic_objectives: ['Unified control plane', 'Lower TCO'],
    } as unknown as CompanyProfile['strategic_inputs'],
    pain_symptoms: ['Tool sprawl', 'Inconsistent identity posture', 'Manual reconciliation'],
    core_problem_statement: 'Enterprise data is scattered across disconnected platforms',
  }),
};

// ────────────────────────────────────────────────────────────────────────────
// Candidate synthesizer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build N synthetic candidates from a foundation. Uses the foundation's
 * own ICP/capability strings so generated candidates carry company-specific
 * tokens — this lets the deterministic pipeline downstream actually
 * differentiate them.
 */
function synthesizeCandidates(
  foundation: CompanyContextFoundation,
  count: number,
): LongFormRecommendation[] {
  const icps = foundation.marketUnderstanding.marketPainPoints.length > 0
    ? foundation.marketUnderstanding.marketPainPoints
    : ['general operational friction'];
  const caps = [
    ...foundation.capabilityMapping.workflowCategories,
    ...foundation.capabilityMapping.enables,
  ];
  const capPool = caps.length > 0 ? caps : ['core capability'];
  const archetypeKeywords: Array<{ archetype: NarrativeArchetype; phrase: string }> = [
    { archetype: 'observability', phrase: 'observability over' },
    { archetype: 'governance', phrase: 'governance around' },
    { archetype: 'workflow_fragmentation', phrase: 'fragmented workflow in' },
    { archetype: 'evaluation_maturity', phrase: 'evaluation maturity for' },
    { archetype: 'scaling_bottleneck', phrase: 'scaling bottleneck inside' },
    { archetype: 'operational_efficiency', phrase: 'operational efficiency of' },
    { archetype: 'orchestration', phrase: 'orchestration across' },
    { archetype: 'ai_adoption_risk', phrase: 'AI adoption risk in' },
  ];
  const titlePrefixes = [
    'How', 'Why', 'A framework for', 'What is', 'Inside how', 'The case for',
  ];

  const out: LongFormRecommendation[] = [];
  for (let i = 0; i < count; i += 1) {
    const icp = icps[i % icps.length];
    const cap = capPool[i % capPool.length];
    const archMeta = archetypeKeywords[i % archetypeKeywords.length];
    const prefix = titlePrefixes[i % titlePrefixes.length];
    const title = `${prefix} ${archMeta.phrase} ${cap} for ${foundation.marketUnderstanding.targetMarket ?? foundation.businessIdentity.companyCategory ?? 'this audience'}`;
    out.push({
      recommendationId: `stress_${i}`,
      recommendationTitle: title.slice(0, 120),
      editorialAngle: `Treat ${cap} as the mechanism that resolves ${icp}, sequenced before generic best-practice advice.`,
      contentAlignmentMode: 'company_context_led',
      recommendedContentType: 'guide',
      companyAlignmentScore: 60 + ((i * 7) % 30),
      commercialRelevanceScore: 55 + ((i * 11) % 30),
      authorityBuildingScore: 50 + ((i * 13) % 35),
      operationalDepthScore: 50 + ((i * 17) % 30),
      seoOpportunityScore: 40 + ((i * 19) % 30),
      overallRecommendationStrength: 60 + ((i * 23) % 25),
      whyThisFitsCompany: {
        summary: `Topic emerges from ${cap} addressing ${icp}.`,
        icpProblemMapping: `Direct mapping to ${foundation.marketUnderstanding.icps[0] ?? foundation.marketUnderstanding.targetMarket ?? 'target persona'}: ${icp}.`,
        capabilityConnection: `Anchored in ${cap}.`,
        businessContextOrigin: `Derived from ${foundation.businessIdentity.companyCategory ?? 'category'} positioning.`,
      },
      targetBuyerStage: (['awareness', 'consideration', 'evaluation', 'decision', 'expansion'] as const)[i % 5],
      strategicNarrative: `${foundation.strategicPov.differentiation[0] ?? 'Our approach'} only works when ${cap} is sequenced before generic best-practice advice. This piece walks through that sequence for ${icp}.`,
      recommendedContentDirection: {
        primaryAngle: `Operational walk-through of ${cap} applied to ${icp}.`,
        operationalProof: [
          `Concrete decision sequence inside ${cap}.`,
          `Failure mode when teams skip this sequence — visible as ${icp}.`,
        ],
        avoidPatterns: ['Generic best-practices framing.', 'Vendor-neutral overview.'],
      },
      narrativeArchetype: archMeta.archetype,
    });
  }
  return out;
}

// Forcibly-collapsed candidates to test that the shape guard penalizes them.
function synthesizeCollapsedCandidates(): LongFormRecommendation[] {
  const titles = [
    'The ultimate guide to scaling AI agents',
    'The ultimate guide to AI observability',
    'The future of AI agents',
    'Best practices for AI agent governance',
    'Why AI agents matter for your team',
    'How to scale AI agents',
  ];
  return titles.map((title, i) => ({
    recommendationId: `collapsed_${i}`,
    recommendationTitle: title,
    editorialAngle: 'Broad overview of the space.',
    contentAlignmentMode: 'independent_editorial' as const,
    recommendedContentType: 'guide' as const,
    companyAlignmentScore: 70,
    commercialRelevanceScore: 60,
    authorityBuildingScore: 50,
    operationalDepthScore: 45,
    seoOpportunityScore: 70,
    overallRecommendationStrength: 70 - i, // descending so leader is index 0
    whyThisFitsCompany: {
      summary: 'Broadly applicable.',
      icpProblemMapping: 'Generic SaaS team',
      capabilityConnection: 'AI capability',
      businessContextOrigin: 'AI category positioning',
    },
    targetBuyerStage: 'awareness' as const,
    strategicNarrative: 'AI is changing the way teams work.',
    recommendedContentDirection: {
      primaryAngle: 'Overview piece.',
      operationalProof: ['Broad industry example.'],
      avoidPatterns: ['Too much specificity.'],
    },
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Assertions
// ────────────────────────────────────────────────────────────────────────────

export interface StressAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface StressScenarioResult {
  scenario: string;
  foundationPopulatedSections: number;
  candidateCount: number;
  acceptedCount: number;
  clusterDiversityScore: number;
  overallDiversityScore: number;
  shapeEntropy: number;
  noveltyVsItself: number;
  assertions: StressAssertion[];
  passed: boolean;
}

export interface StressTestSuiteReport {
  scenarios: StressScenarioResult[];
  overall: {
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
    averageDiversity: number;
    averageShapeEntropy: number;
  };
}

function runScenario(
  scenarioName: string,
  profile: CompanyProfile,
  options?: {
    candidateCount?: number;
    useCollapsedFixtures?: boolean;
    expectations?: Partial<{
      minPopulatedSections: number;
      minClusterDiversity: number;
      minOverallDiversity: number;
      minShapeEntropy: number;
      maxBannedShapeCount: number;
    }>;
  },
): StressScenarioResult {
  const foundation = buildCompanyContextFoundation(profile);
  const candidates = options?.useCollapsedFixtures
    ? synthesizeCollapsedCandidates()
    : synthesizeCandidates(foundation, options?.candidateCount ?? 10);

  // Cluster + suppress duplicates.
  const clusterResult = groupRecommendationsByFamily(candidates, { keepSecondarySimilarity: 0.05 });
  // Narrative shape guard.
  const shapeResult = applyNarrativeShapeGuard(clusterResult.enriched);
  // Balance for diversity.
  const balanceResult = balanceRecommendationSet(shapeResult.recommendations, 6);

  // Self-novelty: each accepted recommendation scored against the others as
  // "recent fingerprints" — proxy for batch novelty.
  const fingerprints = balanceResult.selected.map((r) => buildFingerprintFromRecommendation('stress_company', r));
  const noveltyScores = fingerprints.map((fp, i) =>
    scoreRecommendationNovelty(fp, fingerprints.filter((_, j) => j !== i)),
  );
  const noveltyVsItself = noveltyScores.length === 0
    ? 100
    : Math.round(noveltyScores.reduce((s, n) => s + n, 0) / noveltyScores.length);

  const bannedShapes = ['ultimate_guide', 'best_practices', 'how_to_scale', 'future_of', 'why_x_matters'] as const;
  const bannedShapeCount = bannedShapes.reduce(
    (s, k) => s + (shapeResult.shapeDistribution[k] ?? 0),
    0,
  );

  const exp = {
    minPopulatedSections: options?.expectations?.minPopulatedSections ?? 1,
    minClusterDiversity: options?.expectations?.minClusterDiversity ?? 40,
    minOverallDiversity: options?.expectations?.minOverallDiversity ?? 45,
    minShapeEntropy: options?.expectations?.minShapeEntropy ?? 35,
    maxBannedShapeCount: options?.expectations?.maxBannedShapeCount ?? 1,
  };

  const assertions: StressAssertion[] = [
    {
      name: 'foundation populated sections meets floor',
      observed: foundation.populatedSections.length,
      expected: `≥ ${exp.minPopulatedSections}`,
      passed: foundation.populatedSections.length >= exp.minPopulatedSections,
    },
    {
      name: 'cluster diversity score meets floor',
      observed: clusterResult.report.clusterDiversityScore,
      expected: `≥ ${exp.minClusterDiversity}`,
      passed: clusterResult.report.clusterDiversityScore >= exp.minClusterDiversity,
    },
    {
      name: 'set coverage overall diversity meets floor',
      observed: balanceResult.coverage.overallDiversityScore,
      expected: `≥ ${exp.minOverallDiversity}`,
      passed: balanceResult.coverage.overallDiversityScore >= exp.minOverallDiversity,
    },
    {
      name: 'narrative shape uniqueness (avg) meets floor',
      observed: shapeResult.recommendations.length === 0
        ? 100
        : Math.round(
            shapeResult.recommendations.reduce((s, r) => s + (r.narrativeShapeUniquenessScore ?? 100), 0)
            / shapeResult.recommendations.length,
          ),
      expected: `≥ ${exp.minShapeEntropy}`,
      passed: (() => {
        if (shapeResult.recommendations.length === 0) return true;
        const avg = shapeResult.recommendations.reduce((s, r) => s + (r.narrativeShapeUniquenessScore ?? 100), 0) / shapeResult.recommendations.length;
        return avg >= exp.minShapeEntropy;
      })(),
    },
    {
      name: 'banned shapes do not dominate batch',
      observed: bannedShapeCount,
      expected: `≤ ${exp.maxBannedShapeCount}`,
      passed: bannedShapeCount <= exp.maxBannedShapeCount,
    },
  ];

  const passed = assertions.every((a) => a.passed);
  return {
    scenario: scenarioName,
    foundationPopulatedSections: foundation.populatedSections.length,
    candidateCount: candidates.length,
    acceptedCount: balanceResult.selected.length,
    clusterDiversityScore: clusterResult.report.clusterDiversityScore,
    overallDiversityScore: balanceResult.coverage.overallDiversityScore,
    shapeEntropy: shapeResult.recommendations.length === 0
      ? 100
      : Math.round(
          shapeResult.recommendations.reduce((s, r) => s + (r.narrativeShapeUniquenessScore ?? 100), 0)
          / shapeResult.recommendations.length,
        ),
    noveltyVsItself,
    assertions,
    passed,
  };
}

export function runStressTests(): StressTestSuiteReport {
  const scenarios: StressScenarioResult[] = [
    runScenario('1. weak company context', PROFILES.weakContext, {
      candidateCount: 8,
      expectations: { minPopulatedSections: 1, minClusterDiversity: 30, minOverallDiversity: 35 },
    }),
    runScenario('2. sparse ICP data', PROFILES.sparseIcp, {
      candidateCount: 8,
      expectations: { minPopulatedSections: 2 },
    }),
    runScenario('3. overloaded capability lists', PROFILES.overloadedCapabilities, {
      candidateCount: 12,
      expectations: { minPopulatedSections: 4, minClusterDiversity: 50, minOverallDiversity: 55 },
    }),
    runScenario('4. highly generic SaaS company', PROFILES.genericSaas, {
      candidateCount: 8,
      expectations: { minClusterDiversity: 30, minOverallDiversity: 30 },
    }),
    runScenario('5. overlapping service categories', PROFILES.overlappingCategories, {
      candidateCount: 10,
      // Overlapping capabilities SHOULD collapse — diversity will be lower; floor reflects that.
      expectations: { minClusterDiversity: 25, minOverallDiversity: 35 },
    }),
    runScenario('6. AI buzzword-heavy profile', PROFILES.buzzwordHeavy, {
      candidateCount: 10,
      expectations: { minOverallDiversity: 35 },
    }),
    runScenario('7. multi-product organization', PROFILES.multiProduct, {
      candidateCount: 12,
      expectations: { minPopulatedSections: 4, minClusterDiversity: 60, minOverallDiversity: 60 },
    }),
    runScenario('8. collapsed-shapes adversarial input', PROFILES.buzzwordHeavy, {
      useCollapsedFixtures: true,
      // Adversarial fixtures collapse on every diversity axis by design; we
      // assert only that the shape guard caps banned shapes and the cluster
      // engine surfaces something coherent (low absolute diversity is expected).
      expectations: { maxBannedShapeCount: 5, minShapeEntropy: 20, minOverallDiversity: 30 },
    }),
  ];

  const passedScenarios = scenarios.filter((s) => s.passed).length;
  const averageDiversity = Math.round(
    scenarios.reduce((s, x) => s + x.overallDiversityScore, 0) / scenarios.length,
  );
  const averageShapeEntropy = Math.round(
    scenarios.reduce((s, x) => s + x.shapeEntropy, 0) / scenarios.length,
  );

  return {
    scenarios,
    overall: {
      totalScenarios: scenarios.length,
      passedScenarios,
      failedScenarios: scenarios.length - passedScenarios,
      averageDiversity,
      averageShapeEntropy,
    },
  };
}

/**
 * Pretty-print for CLI consumption.
 */
export function formatStressTestReport(report: StressTestSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — stress test report');
  lines.push('═══════════════════════════════════════════════════════');
  for (const s of report.scenarios) {
    lines.push('');
    lines.push(`${s.passed ? '[PASS]' : '[FAIL]'} ${s.scenario}`);
    lines.push(`   populatedSections=${s.foundationPopulatedSections}  candidates=${s.candidateCount}  accepted=${s.acceptedCount}`);
    lines.push(`   clusterDiversity=${s.clusterDiversityScore}  overallDiversity=${s.overallDiversityScore}  shapeEntropy=${s.shapeEntropy}  noveltyVsBatch=${s.noveltyVsItself}`);
    for (const a of s.assertions) {
      const tag = a.passed ? ' ✓' : ' ✗';
      lines.push(`   ${tag} ${a.name}: ${a.observed} (${a.expected})`);
    }
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(` Overall: ${report.overall.passedScenarios}/${report.overall.totalScenarios} scenarios passed`);
  lines.push(` Avg diversity=${report.overall.averageDiversity}  avg shape entropy=${report.overall.averageShapeEntropy}`);
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}
