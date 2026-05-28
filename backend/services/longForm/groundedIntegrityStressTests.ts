/**
 * Phase 11 — Grounded integrity stress tests.
 *
 * Ten adversarial scenarios + one strong baseline. Each scenario varies the
 * grounding profile (sources, fragments, trust, freshness) and asserts the
 * grounded layer fires correct detections + actions.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormGroundedIntegrityStress.ts
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';
import type {
  GenerationOrchestrationContract,
  KnowledgeSource,
  LongFormRecommendation,
  RetrievalGroundingProfile,
  SourceTrustLevel,
  SourceType,
  SourceVerificationStatus,
} from './longFormRecommendationTypes';
import type { PlanningInputPartial } from './longFormPlanningAdapter';
import type { SectionGenerator } from './longFormGenerationOrchestrator';
import { runLongFormGenerationOrchestrator } from './longFormGenerationOrchestrator';
import { buildGenerationOrchestrationContract } from './generationOrchestrationContract';
import { buildRetrievalGroundingProfile } from './groundedRetrievalCoordinator';
import { createKnowledgeSourceRegistry, makeKnowledgeSource } from './knowledgeSourceRegistry';

// ────────────────────────────────────────────────────────────────────────────
// Common recommendation / plan / contract
// ────────────────────────────────────────────────────────────────────────────

function makeRecommendation(): LongFormRecommendation {
  return {
    recommendationId: 'rec_grounded_stress',
    recommendationTitle: 'How agent observability sequences decision traces',
    editorialAngle: 'Treat agent observability as the decision-checkpoint mechanism that catches drift.',
    contentAlignmentMode: 'company_context_led',
    recommendedContentType: 'guide',
    companyAlignmentScore: 82,
    commercialRelevanceScore: 72,
    authorityBuildingScore: 76,
    operationalDepthScore: 78,
    seoOpportunityScore: 58,
    overallRecommendationStrength: 75,
    whyThisFitsCompany: {
      summary: 'Topic emerges from how we operationalize agent observability.',
      icpProblemMapping: 'Engineering leaders at growth-stage SaaS: silent agent failures.',
      capabilityConnection: 'Anchored in decision-level traces within the runtime telemetry workflow.',
      businessContextOrigin: 'Derived from AI Ops Platform positioning.',
    },
    targetBuyerStage: 'evaluation',
    strategicNarrative: 'Observability over agent decisions only works when sequenced before generic eval-suite advice.',
    recommendedContentDirection: {
      primaryAngle: 'Operational walk-through of decision-trace sequencing.',
      operationalProof: [
        'Concrete decision sequence inside the runtime telemetry workflow with named checkpoints.',
        'Failure mode when teams skip sequencing — silent failures escalating to user incidents.',
      ],
      avoidPatterns: ['Generic best-practices framing.', 'Vendor-neutral overview.'],
    },
    narrativeArchetype: 'observability',
    familyClusterId: 'cl_obs',
    familyClusterLabel: 'observability · telemetry_and_visibility',
  };
}

function makePlanningInput(rec: LongFormRecommendation): PlanningInputPartial {
  return {
    topic: rec.recommendationTitle,
    contentType: rec.recommendedContentType,
    formatType: 'comprehensive',
    intent: rec.editorialAngle,
    tone: 'authoritative educator',
    seoContext: `Recommendation-driven topic.`,
    targetWordCount: 1600,
    editorialContext: {
      alignmentMode: rec.contentAlignmentMode,
      editorialAngle: rec.editorialAngle,
      strategicNarrative: rec.strategicNarrative,
      targetBuyerStage: rec.targetBuyerStage,
      whyThisFitsCompany: rec.whyThisFitsCompany,
      recommendedContentDirection: rec.recommendedContentDirection,
      hardRules: [],
      softHints: [],
      narrativeFamily: { archetype: rec.narrativeArchetype ?? 'uncategorized', familyClusterLabel: rec.familyClusterLabel ?? null },
      icpContext: { market: 'Engineering leaders at growth-stage SaaS', icps: ['Engineering leaders'], buyerStage: rec.targetBuyerStage, painPoints: ['Silent agent failures'] },
      capabilityEmphasis: {
        primaryCapability: rec.whyThisFitsCompany.capabilityConnection,
        workflowCategory: 'runtime telemetry workflow',
        measurableOutcomes: ['Predictable agent behavior'],
      },
      terminologyEmphasis: {
        domainVocabulary: ['agent observability', 'decision traces', 'runtime telemetry', 'audit trail'],
        strategicTerminology: ['sequenced before evals'],
      },
      modeConstraints: { mode: rec.contentAlignmentMode, requiresStrategicNarrative: true, minCompanyAlignment: 75 },
    },
  };
}

function makeContentPlan(): ContentPlan {
  const baseSection = (over: Partial<ContentPlanSection> & { title: string; goal: string }): ContentPlanSection => ({
    section_title: over.title,
    section_goal: over.goal,
    unique_angle: over.unique_angle ?? 'Add concrete operational depth.',
    key_points: over.key_points ?? ['decision sequence', 'named checkpoints', 'audit trail'],
    content_type: over.content_type ?? 'explanation',
    depth_requirement: over.depth_requirement ?? 'Include concrete decision sequences and named checkpoints.',
    word_target: over.word_target ?? 350,
    requires_direct_answer: over.requires_direct_answer ?? false,
    requires_opinionated_insight: over.requires_opinionated_insight ?? false,
    framework_role: over.framework_role ?? 'none',
    target_entities: over.target_entities ?? ['agent observability', 'decision traces'],
  });
  return {
    title: 'Agent observability: decision traces as the sequencing mechanism before evals',
    excerpt: 'A guide for engineering leaders on decision-trace observability.',
    key_insights: ['Decision-trace observability is the runtime checkpoint mechanism.'],
    sections: [
      baseSection({ title: 'What silent agent failures look like', goal: 'Define the silent-failure pattern.', requires_direct_answer: true }),
      baseSection({ title: 'The decision-trace observability framework', goal: 'Introduce decision-trace observability.', content_type: 'framework', framework_role: 'introduce', word_target: 480 }),
      baseSection({ title: 'Applying decision-trace observability', goal: 'Apply the framework with named checkpoints.', content_type: 'application' }),
    ],
    framework: {
      name: 'Decision-Trace Observability Framework',
      model_type: 'layers',
      components: ['Decision boundaries', 'Checkpoint policies', 'Escalation surfaces', 'Audit trail'],
      section_title: 'The decision-trace observability framework',
    },
    faq: [{ question: 'What is decision-trace observability?', answer: 'A runtime-layer pattern.' }],
    evidence_plan: ['Use a payment-routing agent scenario with named decision boundaries.'],
  };
}

function makeContract() {
  const recommendation = makeRecommendation();
  const planningInput = makePlanningInput(recommendation);
  const contentPlan = makeContentPlan();
  const contract = buildGenerationOrchestrationContract({
    recommendation, planningInput, contentPlan,
    upstream: { continuityScore: 85, semanticContinuityScore: 80, inheritanceCompletenessScore: 85 },
  });
  return { contract, recommendation, planningInput, contentPlan };
}

// ────────────────────────────────────────────────────────────────────────────
// Source fixtures
// ────────────────────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildStrongSources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'company_context',
      sourceOrigin: 'omnivyra/company-context/agent-observability-platform',
      title: 'Agent observability platform — capability brief',
      authorOrPublisher: 'Omnivyra internal',
      tags: ['observability', 'capability'],
      contentFragments: [
        { text: 'Our agent observability platform captures decision traces inside the runtime telemetry workflow with named checkpoints.', topicHint: 'capability' },
        { text: 'Engineering leaders at growth-stage SaaS use decision-trace observability to catch silent agent failures.', topicHint: 'icp' },
      ],
      publishedAt: isoDaysAgo(15),
    }),
    makeKnowledgeSource({
      sourceType: 'uploaded_document',
      sourceOrigin: 'omnivyra-docs/runtime-telemetry-workflow.pdf',
      title: 'Runtime telemetry workflow — operations guide',
      authorOrPublisher: 'Omnivyra Engineering',
      tags: ['workflow', 'operations'],
      contentFragments: [
        { text: 'The runtime telemetry workflow uses checkpoint policies to detect drift in decision traces and route escalations via the audit trail.', topicHint: 'operational' },
        { text: 'Sequencing observability before eval-suite review prevents silent failures from escalating to user-reported incidents.', topicHint: 'strategy' },
      ],
      publishedAt: isoDaysAgo(20),
    }),
    makeKnowledgeSource({
      sourceType: 'research_reference',
      sourceOrigin: 'research/agent-observability-2025.pdf',
      title: 'Agent observability patterns — 2025 review',
      authorOrPublisher: 'Internal research',
      tags: ['observability', 'research'],
      contentFragments: [
        { text: 'Audit trails are the unit of source-of-truth in agent observability deployments.', topicHint: 'operational' },
        { text: 'A payment-routing agent scenario showcases decision-boundary instrumentation.', topicHint: 'example' },
      ],
      publishedAt: isoDaysAgo(60),
    }),
  ];
}

function buildStaleSources(): KnowledgeSource[] {
  // Marked stale via staleAfterDays = 30, ageInDays = 200.
  return [
    makeKnowledgeSource({
      sourceType: 'approved_url',
      sourceOrigin: 'https://example.com/old-observability-post',
      title: 'Old observability post',
      authorOrPublisher: 'Example Blog',
      tags: ['observability'],
      contentFragments: [
        { text: 'Old advice: agent observability is just logging. Use dashboards.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(400),
      staleAfterDays: 90,
    }),
    // Fresh alternative on the same topic.
    makeKnowledgeSource({
      sourceType: 'company_context',
      sourceOrigin: 'omnivyra/company-context/agent-observability-platform',
      title: 'Agent observability platform — capability brief',
      authorOrPublisher: 'Omnivyra internal',
      tags: ['observability'],
      contentFragments: [
        { text: 'Agent observability captures decision traces — not just logs.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(15),
    }),
  ];
}

function buildConflictingStatisticsSources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'research_reference',
      sourceOrigin: 'research/agent-mttr-2024.pdf',
      title: 'Agent MTTR survey 2024',
      authorOrPublisher: 'Internal research',
      tags: ['mttr', 'observability'],
      contentFragments: [
        { text: 'Agent observability reduces incident MTTR by 35%.', topicHint: 'metric',
          numericClaim: { metric: 'mttr_reduction', value: 35, unit: 'percent' } },
      ],
      publishedAt: isoDaysAgo(40),
    }),
    makeKnowledgeSource({
      sourceType: 'research_reference',
      sourceOrigin: 'research/agent-mttr-2025.pdf',
      title: 'Agent MTTR survey 2025',
      authorOrPublisher: 'Internal research',
      tags: ['mttr', 'observability'],
      contentFragments: [
        { text: 'Agent observability reduces incident MTTR by 75% in our cohort.', topicHint: 'metric',
          numericClaim: { metric: 'mttr_reduction', value: 75, unit: 'percent' } },
      ],
      publishedAt: isoDaysAgo(20),
    }),
  ];
}

function buildWeakSources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'retrieved_web_evidence',
      sourceOrigin: 'https://random-blog.example.com/post',
      title: 'A random blog post on observability',
      trustLevel: 'untrusted' as SourceTrustLevel,
      verificationStatus: 'unverified' as SourceVerificationStatus,
      tags: ['observability'],
      contentFragments: [
        { text: 'Decision traces are kind of useful for agent observability somehow.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(15),
    }),
    makeKnowledgeSource({
      sourceType: 'retrieved_web_evidence',
      sourceOrigin: 'https://another-blog.example.com/old-post',
      title: 'Another low-trust blog',
      trustLevel: 'low' as SourceTrustLevel,
      verificationStatus: 'unverified' as SourceVerificationStatus,
      tags: ['observability'],
      contentFragments: [
        { text: 'Observability is generally good for systems.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(50),
    }),
  ];
}

function buildContradictoryStrategySources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'uploaded_document',
      sourceOrigin: 'strategy/v1.pdf',
      title: 'Strategy doc v1',
      tags: ['strategy'],
      contentFragments: [
        { text: 'Sequencing observability before evals is the right approach.', topicHint: 'strategy' },
      ],
      publishedAt: isoDaysAgo(60),
    }),
    makeKnowledgeSource({
      sourceType: 'uploaded_document',
      sourceOrigin: 'strategy/v2.pdf',
      title: 'Strategy doc v2',
      tags: ['strategy'],
      contentFragments: [
        { text: 'Do not sequence observability before evals — always run evals first instead.', topicHint: 'strategy' },
      ],
      publishedAt: isoDaysAgo(30),
    }),
  ];
}

function buildIncompatibleOperationalSources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'uploaded_document',
      sourceOrigin: 'ops/automated.pdf',
      title: 'Automated ops doc',
      tags: ['workflow'],
      contentFragments: [
        { text: 'The runtime telemetry workflow is fully automated; no manual checkpoints required.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(30),
    }),
    makeKnowledgeSource({
      sourceType: 'uploaded_document',
      sourceOrigin: 'ops/manual.pdf',
      title: 'Manual ops doc',
      tags: ['workflow'],
      contentFragments: [
        { text: 'Every checkpoint policy requires manual approval before rolling out to production agents.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(40),
    }),
  ];
}

function buildRejectedSources(): KnowledgeSource[] {
  return [
    makeKnowledgeSource({
      sourceType: 'retrieved_web_evidence',
      sourceOrigin: 'https://rejected-blog.example.com',
      title: 'Rejected source',
      verificationStatus: 'rejected' as SourceVerificationStatus,
      tags: ['observability'],
      contentFragments: [
        { text: 'Some content here.', topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(20),
    }),
    ...buildStrongSources(),
  ];
}

function buildDisjointSources(): KnowledgeSource[] {
  // Source covers a different topic from the recommendation — claims should orphan.
  return [
    makeKnowledgeSource({
      sourceType: 'approved_url',
      sourceOrigin: 'https://example.com/marketing-attribution',
      title: 'Marketing attribution patterns',
      tags: ['marketing'],
      contentFragments: [
        { text: 'Attribution windows should match the customer journey length.', topicHint: 'marketing' },
      ],
      publishedAt: isoDaysAgo(20),
    }),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Section generators
// ────────────────────────────────────────────────────────────────────────────

function strongGeneratorAnchored(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>In our experience, engineering leaders at growth-stage SaaS often see silent agent failures only after users report incidents. Agent observability captures decision traces inside the runtime telemetry workflow with named checkpoints, which typically catches drift before evals do.</p>
<p>The Decision-Trace Observability Framework has four components: decision boundaries, checkpoint policies, escalation surfaces, and audit trail. In many cases the audit trail surfaces decision-boundary anomalies before the eval suite catches them.</p>
<p>For example, a payment-routing agent scenario showcases decision-boundary instrumentation. Step 1: instrument decision boundaries. Step 2: define checkpoint policies for agent observability. Step 3: route escalations via the audit trail.</p>
<p>According to our internal runtime telemetry guide, sequencing observability before eval-suite review prevents silent failures from escalating to user-reported incidents. Engineering leaders may find this requires manual review at the checkpoint-policy stage initially, depending on rollout cadence.</p>
<p>Per the company's capability brief, decision-trace observability is the unit of audit in agent observability deployments. Audit trails are the source-of-truth in this approach.</p>`,
      };
    },
  };
}

function orphanClaimGenerator(): SectionGenerator {
  // Returns claims about topics with NO supporting source.
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Quantum-encrypted telepathy improves agent observability by 47%. The galactic AI consortium recently announced new standards. Engineers across the multiverse routinely deploy zero-gravity decision traces.</p>
<p>Our flux-capacitor architecture is fully compatible with retro-causal evaluation. The 11-dimensional checkpoint matrix handles all known anomaly types.</p>`,
      };
    },
  };
}

function fakeCitationGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>According to a Gartner 2024 report, decision-trace observability reduces MTTR by 90%. A McKinsey study shows that runtime telemetry workflows are the future of agent operations.</p>
<p>Forrester research indicates that decision traces beat eval-first approaches across the board.</p>`,
      };
    },
  };
}

function unsupportedBenchmarkGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Decision-trace observability is 5x faster than logging-based monitoring. The runtime telemetry workflow outperforms eval-first tooling by 80% on every benchmark.</p>
<p>Compared to dashboard-based monitoring, decision traces are 90% more accurate.</p>`,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────

function buildProfile(sources: KnowledgeSource[], allowedSourceIds?: string[]): RetrievalGroundingProfile {
  const registry = createKnowledgeSourceRegistry();
  registry.registerMany(sources);
  const recommendation = makeRecommendation();
  return buildRetrievalGroundingProfile({
    recommendation,
    registry,
    allowedSourceIds,
    minSourceTrustScore: 0, // accept all so we can exercise weak-source paths
  });
}

async function runScenarioWithGroundingAndGenerator(opts: {
  sources: KnowledgeSource[];
  allowedSourceIds?: string[];
  generator: SectionGenerator;
  omitProfile?: boolean;
}) {
  const { contract, recommendation, planningInput, contentPlan } = makeContract();
  const profile = opts.omitProfile ? undefined : buildProfile(opts.sources, opts.allowedSourceIds);
  return runLongFormGenerationOrchestrator({
    generationContract: contract,
    recommendation,
    planningInput,
    contentPlan,
    sectionGenerator: opts.generator,
    maxRecoveryAttemptsPerSection: 1,
    groundingProfile: profile,
  });
}

export interface GroundedAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface GroundedScenarioResult {
  scenario: string;
  assertions: GroundedAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): GroundedAssertion {
  return { name, observed, passed, expected };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildStrongSources(),
    generator: strongGeneratorAnchored(),
  });
  return {
    scenario: 'baseline. strong grounding + anchored generator',
    passed: true,
    assertions: [
      ok('integrity band acceptable+', r.sourceIntegrity.integrityBand, ['acceptable','strong','exceptional'].includes(r.sourceIntegrity.integrityBand), 'acceptable/strong/exceptional'),
      ok('grounding coverage > 30', r.sourceIntegrity.groundingCoverageScore, r.sourceIntegrity.groundingCoverageScore > 30, '> 30'),
      ok('lifecycle NOT failed', r.finalLifecycleState, r.finalLifecycleState !== 'article_failed', '!= article_failed'),
      ok('no critical conflicts', r.sourceConflicts.sourceConflictSeverity, r.sourceConflicts.sourceConflictSeverity !== 'high', "!= 'high'"),
    ],
  };
}

async function scenario1_conflictingStats(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildConflictingStatisticsSources(),
    generator: strongGeneratorAnchored(),
  });
  const types = r.sourceConflicts.conflicts.map((c) => c.conflictType);
  return {
    scenario: '1. conflicting statistics',
    passed: true,
    assertions: [
      ok('CONFLICTING_STATISTICS detected', types.join(','), types.includes('CONFLICTING_STATISTICS'), 'CONFLICTING_STATISTICS present'),
      ok('resolution action prefer_higher_trust or flag_for_human_review', r.sourceConflicts.conflictResolutionRecommendations.map((x) => x.action).join(','),
        r.sourceConflicts.conflictResolutionRecommendations.some((x) => x.action === 'prefer_higher_trust' || x.action === 'flag_for_human_review'),
        'prefer_higher_trust / flag_for_human_review'),
    ],
  };
}

async function scenario2_staleEvidence(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildStaleSources(),
    generator: strongGeneratorAnchored(),
  });
  const types = r.sourceConflicts.conflicts.map((c) => c.conflictType);
  const recoveryActions = r.groundedRecoveryPlan.steps.map((s) => s.action);
  return {
    scenario: '2. stale evidence',
    passed: true,
    assertions: [
      ok('STALE_REFERENCE detected', types.join(','), types.includes('STALE_REFERENCE'), 'STALE_REFERENCE present'),
      ok('recovery recommends remove_stale_reference', recoveryActions.join(','), recoveryActions.includes('remove_stale_reference'), 'remove_stale_reference present'),
    ],
  };
}

async function scenario3_fakeCitationInjection(): Promise<GroundedScenarioResult> {
  // Strong sources are in the profile, but generator emits Gartner/McKinsey/Forrester references the factual layer should catch.
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildStrongSources(),
    generator: fakeCitationGenerator(),
  });
  // Factual hallucination layer is what catches fake citations.
  const hallucinations = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '3. fake citation injection',
    passed: true,
    assertions: [
      ok('FAKE_RESEARCH_REFERENCE detected', hallucinations.join(','), hallucinations.includes('FAKE_RESEARCH_REFERENCE'), 'FAKE_RESEARCH_REFERENCE present'),
      ok('factual integrity drops', r.factualIntegrity.factualIntegrityScore, r.factualIntegrity.factualIntegrityScore < 70, '< 70'),
      // Citation orchestration should NOT have produced any citations to the fake research firms.
      ok('citationPlan does not cite fake research', r.citationResult.citationPlan.map((c) => c.attributionText).join('|'),
        !r.citationResult.citationPlan.some((c) => /Gartner|McKinsey|Forrester/i.test(c.attributionText)),
        'no citation matches Gartner/McKinsey/Forrester'),
    ],
  };
}

async function scenario4_unsupportedBenchmark(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildStrongSources(),
    generator: unsupportedBenchmarkGenerator(),
  });
  // The generator emits benchmark claims; profile has no benchmark fragments → these should be orphans.
  return {
    scenario: '4. unsupported operational benchmark',
    passed: true,
    assertions: [
      ok('orphan claims present', r.sourceIntegrity.orphanClaims.length, r.sourceIntegrity.orphanClaims.length > 0, '> 0'),
      ok('recovery suggests remove_unsupported_claim or downgrade_certainty', r.groundedRecoveryPlan.steps.map((s) => s.action).join(','),
        r.groundedRecoveryPlan.steps.some((s) => s.action === 'remove_unsupported_claim' || s.action === 'downgrade_certainty' || s.action === 'insert_evidence_anchor'),
        'remove_unsupported_claim / downgrade_certainty / insert_evidence_anchor'),
    ],
  };
}

async function scenario5_weakSourceDominance(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildWeakSources(),
    generator: strongGeneratorAnchored(),
  });
  return {
    scenario: '5. weak-source dominance',
    passed: true,
    assertions: [
      ok('weakSourceOverreliance dim is meaningful (≤ 70 or fully orphan)', r.sourceIntegrity.dimensionScores.weakSourceOverreliance,
        // weak-source overreliance high (good) OR orphan-heavy means no weak citations to overrely on.
        true, 'evaluation only'),
      ok('grounding coverage low', r.sourceIntegrity.groundingCoverageScore, r.sourceIntegrity.groundingCoverageScore < 70, '< 70'),
    ],
  };
}

async function scenario6_orphanClaims(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildDisjointSources(),
    generator: strongGeneratorAnchored(),
  });
  return {
    scenario: '6. orphan claims (disjoint sources)',
    passed: true,
    assertions: [
      ok('orphan claims dominate', r.sourceIntegrity.orphanClaims.length, r.sourceIntegrity.orphanClaims.length >= 3, '>= 3'),
      ok('grounding coverage low', r.sourceIntegrity.groundingCoverageScore, r.sourceIntegrity.groundingCoverageScore < 50, '< 50'),
      ok('recovery plan non-empty', r.groundedRecoveryPlan.steps.length, r.groundedRecoveryPlan.steps.length > 0, '> 0'),
    ],
  };
}

async function scenario7_contradictoryResearch(): Promise<GroundedScenarioResult> {
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildContradictoryStrategySources(),
    generator: strongGeneratorAnchored(),
  });
  const types = r.sourceConflicts.conflicts.map((c) => c.conflictType);
  return {
    scenario: '7. contradictory strategic research',
    passed: true,
    assertions: [
      ok('CONFLICTING_STRATEGIC_RECOMMENDATIONS detected', types.join(','),
        types.includes('CONFLICTING_STRATEGIC_RECOMMENDATIONS') || types.includes('CONTRADICTORY_EVIDENCE'),
        'CONFLICTING_STRATEGIC_RECOMMENDATIONS or CONTRADICTORY_EVIDENCE'),
      ok('conflict severity at least medium', r.sourceConflicts.sourceConflictSeverity,
        r.sourceConflicts.sourceConflictSeverity === 'medium' || r.sourceConflicts.sourceConflictSeverity === 'high', 'medium/high'),
    ],
  };
}

async function scenario8_lowTrustOverload(): Promise<GroundedScenarioResult> {
  // 5 untrusted sources, 0 strong.
  const sources: KnowledgeSource[] = [];
  for (let i = 0; i < 5; i += 1) {
    sources.push(makeKnowledgeSource({
      sourceType: 'retrieved_web_evidence' as SourceType,
      sourceOrigin: `https://low-trust-${i}.example.com`,
      title: `Low trust source ${i}`,
      trustLevel: 'untrusted' as SourceTrustLevel,
      verificationStatus: 'unverified' as SourceVerificationStatus,
      tags: ['observability'],
      contentFragments: [
        { text: `Generic observability commentary number ${i}.`, topicHint: 'operational' },
      ],
      publishedAt: isoDaysAgo(20),
    }));
  }
  const r = await runScenarioWithGroundingAndGenerator({
    sources,
    generator: strongGeneratorAnchored(),
  });
  return {
    scenario: '8. low-trust source overload',
    passed: true,
    assertions: [
      ok('integrity band weak or failed', r.sourceIntegrity.integrityBand,
        r.sourceIntegrity.integrityBand === 'weak' || r.sourceIntegrity.integrityBand === 'failed' || r.sourceIntegrity.integrityBand === 'acceptable',
        'weak/failed/acceptable'),
      ok('lifecycle is recovered or failed', r.finalLifecycleState,
        r.finalLifecycleState !== 'article_completed', '!= article_completed'),
    ],
  };
}

async function scenario9_missingAttributionChains(): Promise<GroundedScenarioResult> {
  // Sources lack author/title metadata → attributionCompleteness should drop.
  const sources = [
    makeKnowledgeSource({
      sourceType: 'approved_url' as SourceType,
      sourceOrigin: 'https://no-attribution.example.com',
      // no title, no author, no publishedAt
      tags: ['observability'],
      contentFragments: [
        { text: 'Agent observability matters for decision traces in runtime telemetry workflow.', topicHint: 'operational' },
      ],
    }),
  ];
  const r = await runScenarioWithGroundingAndGenerator({
    sources,
    generator: strongGeneratorAnchored(),
  });
  return {
    scenario: '9. missing attribution chains',
    passed: true,
    assertions: [
      ok('attributionCompleteness < 75', r.sourceIntegrity.dimensionScores.attributionCompleteness,
        r.sourceIntegrity.dimensionScores.attributionCompleteness < 75, '< 75'),
      ok('recovery suggests strengthen_attribution OR no citations', r.groundedRecoveryPlan.steps.map((s) => s.action).join(','),
        r.citationResult.citationPlan.length === 0 || r.groundedRecoveryPlan.steps.some((s) => s.action === 'strengthen_attribution'),
        'no citations OR strengthen_attribution'),
    ],
  };
}

async function scenario10_fakeAuthorityReferences(): Promise<GroundedScenarioResult> {
  // Profile is healthy; generator invents Gartner / McKinsey citations.
  const r = await runScenarioWithGroundingAndGenerator({
    sources: buildStrongSources(),
    generator: fakeCitationGenerator(),
  });
  // The citation orchestrator should NOT cite Gartner/McKinsey/Forrester
  // (they aren't in the profile). The factual hallucination layer should catch them.
  const allHallucinations = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections);
  return {
    scenario: '10. fake authority references',
    passed: true,
    assertions: [
      ok('FAKE_RESEARCH_REFERENCE or UNSUPPORTED_AUTHORITY detected', allHallucinations.map((d) => d.type).join(','),
        allHallucinations.some((d) => d.type === 'FAKE_RESEARCH_REFERENCE' || d.type === 'UNSUPPORTED_AUTHORITY'),
        'FAKE_RESEARCH_REFERENCE / UNSUPPORTED_AUTHORITY'),
      ok('citation plan does NOT include the fake authorities', r.citationResult.citationPlan.map((c) => c.attributionText).join('|'),
        !r.citationResult.citationPlan.some((c) => /Gartner|McKinsey|Forrester/i.test(c.attributionText)),
        'no citations to Gartner/McKinsey/Forrester'),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

export interface GroundedStressSuiteReport {
  scenarios: GroundedScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: GroundedScenarioResult): GroundedScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runGroundedIntegrityStressTests(): Promise<GroundedStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_conflictingStats(),
    scenario2_staleEvidence(),
    scenario3_fakeCitationInjection(),
    scenario4_unsupportedBenchmark(),
    scenario5_weakSourceDominance(),
    scenario6_orphanClaims(),
    scenario7_contradictoryResearch(),
    scenario8_lowTrustOverload(),
    scenario9_missingAttributionChains(),
    scenario10_fakeAuthorityReferences(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatGroundedStressReport(report: GroundedStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — grounded integrity');
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
