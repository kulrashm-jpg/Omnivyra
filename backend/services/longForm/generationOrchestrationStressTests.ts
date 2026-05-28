/**
 * Phase 8 — Generation-orchestration stress tests.
 *
 * Ten scenarios that exercise the FULL orchestration pipeline (contract →
 * planner continuity → readiness → gate → recovery → explanation) with
 * synthetic ContentPlans designed to surface specific failure modes.
 *
 * NO LLM calls. Reproducible.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormGenerationOrchestrationStress.ts
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';
import type {
  ExecutionGateThreshold,
  LongFormRecommendation,
} from './longFormRecommendationTypes';
import { buildGenerationOrchestrationContract } from './generationOrchestrationContract';
import { analyzePlannerGenerationContinuity } from './plannerGenerationContinuityAnalyzer';
import { assessGenerationReadiness } from './generationReadinessValidator';
import { evaluateGenerationExecutionGate } from './generationExecutionGate';
import { buildRecoveryPlan } from './generationRecoveryCoordinator';
import { composeGenerationPreparationExplanation } from './generationPreparationExplanationComposer';
import { createGenerationPreparationDiagnosticsRegistry } from './generationPreparationDiagnostics';
import type { PlanningInputPartial } from './longFormPlanningAdapter';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeRecommendation(overrides: Partial<LongFormRecommendation> = {}): LongFormRecommendation {
  return {
    recommendationId: overrides.recommendationId ?? 'rec_stress',
    recommendationTitle: 'How agent observability sequences decision traces for engineering leaders',
    editorialAngle: 'Treat agent observability as the decision-checkpoint mechanism that catches drift before it costs revenue.',
    contentAlignmentMode: 'company_context_led',
    recommendedContentType: 'guide',
    companyAlignmentScore: 82,
    commercialRelevanceScore: 72,
    authorityBuildingScore: 76,
    operationalDepthScore: 78,
    seoOpportunityScore: 58,
    overallRecommendationStrength: 75,
    whyThisFitsCompany: {
      summary: 'Topic emerges from how we operationalize agent observability against silent agent failures.',
      icpProblemMapping: 'Engineering leaders at growth-stage SaaS: silent agent failures, no decision audit.',
      capabilityConnection: 'Anchored in decision-level traces within the runtime telemetry workflow.',
      businessContextOrigin: 'Derived from AI Ops Platform positioning.',
    },
    targetBuyerStage: 'evaluation',
    strategicNarrative: 'Observability over agent decisions only works when sequenced before generic eval-suite best-practice advice.',
    recommendedContentDirection: {
      primaryAngle: 'Operational walk-through of decision-trace sequencing applied to silent agent failures.',
      operationalProof: [
        'Concrete decision sequence inside the runtime telemetry workflow with named checkpoints.',
        'Failure mode when teams skip sequencing — visible as silent agent failures escalating to user-reported incidents.',
      ],
      avoidPatterns: ['Generic best-practices framing.', 'Vendor-neutral overview.'],
    },
    narrativeArchetype: 'observability',
    familyClusterId: 'cl_obs',
    familyClusterLabel: 'observability · telemetry_and_visibility',
    confidence: {
      recommendationConfidenceScore: 78,
      confidenceBand: 'high',
      contributorBreakdown: {
        companyContextRichness: 90, recommendationUniqueness: 80, validationStability: 90,
        retryVolatility: 95, clusterStability: 100, archetypeConfidence: 90,
        noveltyConfidence: 80, operationalSpecificity: 78, strategicConsistency: 76,
        continuityStability: 70,
      },
      reasoning: [],
    },
    suitability: {
      recommendedPrimaryUse: 'operational_deep_dive',
      recommendedSecondaryUses: ['authority_building'],
      unsuitableFor: [],
      useFitScores: {
        long_form_educational: 70, authority_building: 68, seo_led_discoverability: 62,
        strategic_positioning: 66, conversion_assist: 60, thought_leadership: 64,
        operational_deep_dive: 82,
      },
      primaryUseRationale: 'Operational depth and content type guide fit an operational deep dive.',
    },
    ...overrides,
  };
}

function makePlanningInput(rec: LongFormRecommendation): PlanningInputPartial {
  return {
    topic: rec.recommendationTitle,
    contentType: rec.recommendedContentType,
    formatType: 'comprehensive',
    intent: rec.editorialAngle,
    tone: 'authoritative educator',
    seoContext: `Recommendation-driven topic. Buyer stage: ${rec.targetBuyerStage}.`,
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
      icpContext: { market: 'Engineering leaders', icps: ['Engineering leaders'], buyerStage: rec.targetBuyerStage, painPoints: ['Silent agent failures'] },
      capabilityEmphasis: {
        primaryCapability: rec.whyThisFitsCompany.capabilityConnection,
        workflowCategory: 'runtime telemetry workflow',
        measurableOutcomes: ['Predictable agent behavior'],
      },
      terminologyEmphasis: {
        domainVocabulary: ['agent observability', 'decision traces', 'runtime telemetry', 'audit trail'],
        strategicTerminology: ['observability + governance', 'sequenced before evals'],
      },
      modeConstraints: { mode: rec.contentAlignmentMode, requiresStrategicNarrative: true, minCompanyAlignment: 75 },
    },
  };
}

function makeSection(overrides: Partial<ContentPlanSection> & { title: string; goal: string }): ContentPlanSection {
  return {
    section_title: overrides.title,
    section_goal: overrides.goal,
    unique_angle: overrides.unique_angle ?? 'Add new information not covered elsewhere.',
    key_points: overrides.key_points ?? ['Develop a distinct reader takeaway.'],
    content_type: overrides.content_type ?? 'explanation',
    depth_requirement: overrides.depth_requirement ?? 'Provide specific, useful detail with concrete examples.',
    word_target: overrides.word_target ?? 350,
    requires_direct_answer: overrides.requires_direct_answer ?? false,
    requires_opinionated_insight: overrides.requires_opinionated_insight ?? false,
    framework_role: overrides.framework_role ?? 'none',
    target_entities: overrides.target_entities ?? [],
  };
}

function makeStrongPlan(): ContentPlan {
  return {
    title: 'Agent observability: decision traces as the sequencing mechanism before evals',
    excerpt: 'A guide for engineering leaders on using decision-trace observability to catch silent agent failures before they reach users — sequenced ahead of generic eval suites.',
    key_insights: [
      'Most teams sequence observability AFTER evals. The result is silent agent failures discovered by users.',
      'Decision-trace observability is the checkpoint mechanism that catches drift at the runtime layer.',
      'Sequencing observability before evals changes the audit trail and the incident profile.',
    ],
    sections: [
      makeSection({ title: 'What silent agent failures actually look like in production', goal: 'Define the silent-failure pattern and connect it to the audit gap.', content_type: 'explanation', unique_angle: 'Why "the agent worked in eval but failed in prod" is a sequencing problem, not a model problem.', key_points: ['Define silent agent failures.', 'Show the audit gap.', 'Connect to user-reported incidents.'], depth_requirement: 'Define the silent-failure pattern with named checkpoints from the runtime telemetry workflow.', requires_direct_answer: true }),
      makeSection({ title: 'The decision-trace observability framework', goal: 'Introduce the named decision-trace observability framework with its 4 components.', content_type: 'framework', unique_angle: 'Decision-trace observability sequenced before evals.', key_points: ['Name the framework.', 'Define each component.', 'Explain why order matters.'], depth_requirement: 'Define decision-trace observability and explain why sequencing matters before eval suites.', framework_role: 'introduce', word_target: 480 }),
      makeSection({ title: 'Applying decision-trace observability to silent agent failures', goal: 'Apply the framework to the silent-failure pattern with concrete steps inside the runtime telemetry workflow.', content_type: 'application', unique_angle: 'Concrete decision sequence inside the runtime telemetry workflow with named checkpoints.', key_points: ['Step 1: instrument decision boundaries.', 'Step 2: define checkpoint policies.', 'Step 3: surface escalations.'], depth_requirement: 'Walk through the operational sequence with named checkpoints and explicit decision points.', requires_direct_answer: true }),
      makeSection({ title: 'Examples: catching drift before users do', goal: 'Show realistic examples of decision-trace observability catching drift.', content_type: 'example', unique_angle: 'Real workflow scenarios where sequencing observability before evals changed the outcome.', key_points: ['Scenario 1: payment-routing agent.', 'Scenario 2: support-triage agent.'], depth_requirement: 'Two realistic scenarios with measurable outcomes.' }),
      makeSection({ title: 'What most teams miss about agent observability', goal: 'Challenge the common assumption that evals are sufficient.', content_type: 'insight', unique_angle: 'Most teams treat observability as logging. Decision-trace observability is the checkpoint mechanism.', key_points: ['Common assumption.', 'Non-obvious counterpoint.', 'Practical implication.'], depth_requirement: 'Challenge the eval-first assumption with operational evidence.', requires_opinionated_insight: true }),
    ],
    framework: {
      name: 'Decision-Trace Observability Framework',
      model_type: 'layers',
      components: ['Decision boundaries', 'Checkpoint policies', 'Escalation surfaces', 'Audit trail'],
      section_title: 'The decision-trace observability framework',
    },
    faq: [
      { question: 'What is decision-trace observability?', answer: 'A runtime-layer observability pattern that captures every agent decision boundary, not just its output.' },
      { question: 'Why sequence observability before evals?', answer: 'Because evals confirm correctness in test conditions, while observability confirms it in production.' },
      { question: 'How does this change incident response?', answer: 'Teams detect drift via decision-trace anomalies before users report failures.' },
      { question: 'What does the audit trail look like?', answer: 'A chronological sequence of decision boundaries with checkpoint outcomes.' },
    ],
    evidence_plan: [
      'Use a realistic payment-routing agent scenario with named decision boundaries.',
      'Reference an industry benchmark for incident detection time.',
    ],
  };
}

// Plan mutators that simulate planner pathologies.
function flattenedPlan(): ContentPlan {
  const plan = makeStrongPlan();
  // Wipe progression — all sections become generic explanations.
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title,
    goal: 'Generally discuss this area at a high level.',
    content_type: 'explanation',
    depth_requirement: 'Provide a broad overview that might consider general best practices.',
    requires_direct_answer: false,
    requires_opinionated_insight: false,
    framework_role: 'none',
  }));
  plan.framework = { name: '', model_type: 'layers', components: [], section_title: '' };
  return plan;
}

function genericRewritePlan(): ContentPlan {
  return {
    title: 'A general overview of AI in modern teams',
    excerpt: 'High-level discussion of AI considerations for teams.',
    key_insights: ['AI is changing how teams work.', 'Teams should consider AI.'],
    sections: [
      makeSection({ title: 'Why AI matters', goal: 'Discuss why AI matters.', depth_requirement: 'High-level overview.' }),
      makeSection({ title: 'Common considerations', goal: 'Discuss common considerations.', depth_requirement: 'General discussion.' }),
      makeSection({ title: 'What to think about', goal: 'Discuss what to think about.', depth_requirement: 'Broad framing.' }),
      makeSection({ title: 'Next steps', goal: 'Discuss next steps.', depth_requirement: 'General suggestions.' }),
    ],
    framework: { name: 'Generic AI Framework', model_type: 'layers', components: ['Awareness', 'Adoption'], section_title: 'Common considerations' },
    faq: [{ question: 'Why now?', answer: 'AI is everywhere.' }],
    evidence_plan: ['Reference general industry trends.'],
  };
}

function icpDilutedPlan(): ContentPlan {
  const plan = makeStrongPlan();
  plan.title = 'Observability for production systems: a primer';
  plan.excerpt = 'A primer on observability for production systems.';
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title.replace(/agent/gi, 'system').replace(/engineering leaders/gi, 'teams'),
    goal: s.section_goal.replace(/agent/gi, 'system').replace(/silent agent failures/gi, 'production issues'),
    content_type: s.content_type,
    depth_requirement: (s.depth_requirement ?? '').replace(/agent/gi, 'system'),
    framework_role: s.framework_role,
    requires_direct_answer: s.requires_direct_answer,
    requires_opinionated_insight: s.requires_opinionated_insight,
  }));
  return plan;
}

function terminologyAbstractedPlan(): ContentPlan {
  const plan = makeStrongPlan();
  // Strip vocabulary by paraphrasing into generics.
  plan.title = 'Watching how software makes choices in production';
  plan.excerpt = 'Looking at how software makes choices in real environments.';
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title.replace(/decision[- ]trace/gi, 'watching').replace(/observability/gi, 'watching').replace(/checkpoint/gi, 'point'),
    goal: s.section_goal.replace(/decision[- ]trace/gi, 'watching').replace(/observability/gi, 'watching').replace(/runtime telemetry workflow/gi, 'system'),
    content_type: s.content_type,
    depth_requirement: 'High-level treatment.',
  }));
  plan.framework = { name: 'Watching Framework', model_type: 'layers', components: ['Look', 'Note', 'Respond'], section_title: 'A simple model' };
  return plan;
}

function seoReshapedPlan(): ContentPlan {
  const plan = makeStrongPlan();
  plan.title = 'How to monitor AI agents: the ultimate guide';
  plan.excerpt = 'Best practices for monitoring AI agents.';
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title.replace(/decision[- ]trace observability/gi, 'AI monitoring'),
    goal: 'High-level coverage of monitoring best practices.',
    content_type: 'explanation',
    depth_requirement: 'Broad coverage suitable for search intent.',
  }));
  return plan;
}

function capabilitySuppressedPlan(): ContentPlan {
  const plan = makeStrongPlan();
  // Strip all references to "decision traces" / "runtime telemetry" / capability strings.
  plan.title = 'Observability for production agents: a framework';
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title.replace(/decision[- ]trace observability/gi, 'observability').replace(/decision traces/gi, 'monitoring'),
    goal: s.section_goal.replace(/decision[- ]trace observability/gi, 'observability').replace(/runtime telemetry workflow/gi, 'monitoring pipeline'),
    content_type: s.content_type,
    depth_requirement: (s.depth_requirement ?? '').replace(/decision[- ]trace/gi, '').replace(/runtime telemetry/gi, 'monitoring'),
  }));
  return plan;
}

function weakNarrativePlan(): ContentPlan {
  const plan = makeStrongPlan();
  plan.key_insights = ['Observability matters.', 'Teams should observe.'];
  plan.sections = plan.sections.map((s) => makeSection({
    title: s.section_title,
    goal: 'Generally discuss this area.',
    content_type: 'explanation',
    depth_requirement: 'High-level discussion.',
    requires_opinionated_insight: false,
  }));
  return plan;
}

function contradictoryPlan(): ContentPlan {
  const plan = makeStrongPlan();
  plan.title = 'Why decision-trace observability is unnecessary for most teams';
  plan.excerpt = 'Many teams over-invest in observability when simpler tools suffice.';
  plan.key_insights = [
    'Most teams do not need decision-trace observability.',
    'Simpler tools are usually enough.',
  ];
  return plan;
}

function highCoherenceLowIntegrityPlan(): ContentPlan {
  // Very coherent structure but every section is a near-duplicate.
  return {
    title: 'Observability primer',
    excerpt: 'Primer on observability.',
    key_insights: ['Observability matters.', 'Observability is important.', 'Observability helps.'],
    sections: [
      makeSection({ title: 'Observability part 1', goal: 'Discuss observability.', content_type: 'explanation' }),
      makeSection({ title: 'Observability part 2', goal: 'Discuss observability.', content_type: 'explanation' }),
      makeSection({ title: 'Observability part 3', goal: 'Discuss observability.', content_type: 'explanation' }),
      makeSection({ title: 'Observability part 4', goal: 'Discuss observability.', content_type: 'explanation' }),
    ],
    framework: { name: 'Observability Layers', model_type: 'layers', components: ['Layer 1', 'Layer 2', 'Layer 3'], section_title: 'Observability part 2' },
    faq: [{ question: 'Why observability?', answer: 'Because observability matters.' }],
    evidence_plan: ['Industry trends.'],
  };
}

function highNoveltyLowContinuityPlan(): ContentPlan {
  // Wildly novel direction; ignores the recommendation entirely.
  return {
    title: 'The future of synthetic data for AI agents',
    excerpt: 'A look at how synthetic data is reshaping the AI agent landscape.',
    key_insights: ['Synthetic data is the future.', 'It changes how agents learn.', 'It rewires the data flywheel.'],
    sections: [
      makeSection({ title: 'What synthetic data unlocks', goal: 'Explain synthetic data potential.', content_type: 'explanation' }),
      makeSection({ title: 'The synthetic-data flywheel', goal: 'Introduce a flywheel model.', content_type: 'framework', framework_role: 'introduce' }),
      makeSection({ title: 'Applying synthetic data', goal: 'Walk through application.', content_type: 'application' }),
      makeSection({ title: 'Examples in the wild', goal: 'Show synthetic-data examples.', content_type: 'example' }),
      makeSection({ title: 'What most teams miss', goal: 'Challenge synthetic-data assumptions.', content_type: 'insight', requires_opinionated_insight: true }),
    ],
    framework: { name: 'Synthetic Data Flywheel', model_type: 'system', components: ['Generate', 'Validate', 'Deploy', 'Measure'], section_title: 'The synthetic-data flywheel' },
    faq: [
      { question: 'What is synthetic data?', answer: 'Data generated by models for model training.' },
      { question: 'Why now?', answer: 'Real data is scarce.' },
      { question: 'What are the risks?', answer: 'Mode collapse.' },
      { question: 'How to start?', answer: 'Start small.' },
    ],
    evidence_plan: ['Industry benchmark.', 'Case study.'],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface ScenarioOutcome {
  contract: ReturnType<typeof buildGenerationOrchestrationContract>;
  continuity: ReturnType<typeof analyzePlannerGenerationContinuity>;
  readiness: ReturnType<typeof assessGenerationReadiness>;
  gate: ReturnType<typeof evaluateGenerationExecutionGate>;
  recovery: ReturnType<typeof buildRecoveryPlan>;
  explanation: ReturnType<typeof composeGenerationPreparationExplanation>;
}

function runScenario(plan: ContentPlan, mode: ExecutionGateThreshold = 'balanced', upstreamOverride: Partial<{ continuityScore: number; semanticContinuityScore: number; icpEntityPreservation: number; inheritanceCompletenessScore: number; }> = {}): ScenarioOutcome {
  const rec = makeRecommendation();
  const planningInput = makePlanningInput(rec);
  const upstream = {
    continuityScore: 80, semanticContinuityScore: 75, icpEntityPreservation: 70, inheritanceCompletenessScore: 80,
    ...upstreamOverride,
  };
  const contract = buildGenerationOrchestrationContract({
    recommendation: rec, planningInput, contentPlan: plan,
    upstream: {
      continuityScore: upstream.continuityScore,
      semanticContinuityScore: upstream.semanticContinuityScore,
      inheritanceCompletenessScore: upstream.inheritanceCompletenessScore,
    },
  });
  const continuity = analyzePlannerGenerationContinuity({
    recommendation: rec, contentPlan: plan,
    domainVocabulary: planningInput.editorialContext.terminologyEmphasis.domainVocabulary,
    strategicTerminology: planningInput.editorialContext.terminologyEmphasis.strategicTerminology,
  });
  const readiness = assessGenerationReadiness({
    recommendation: rec, contentPlan: plan, upstream, plannerContinuity: continuity,
  });
  const gate = evaluateGenerationExecutionGate({ readiness, plannerContinuity: continuity, thresholdMode: mode });
  const recovery = buildRecoveryPlan({ readiness, plannerContinuity: continuity, gateDecision: gate });
  const explanation = composeGenerationPreparationExplanation({
    contract, readiness, gate, plannerContinuity: continuity,
    recoveryRecommendations: recovery.recoveryRecommendations,
    recoveryAttemptPlan: recovery.recoveryAttemptPlan,
  });
  return { contract, continuity, readiness, gate, recovery, explanation };
}

export interface OrchestrationAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface OrchestrationScenarioResult {
  scenario: string;
  assertions: OrchestrationAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): OrchestrationAssertion {
  return { name, observed, passed, expected };
}

// ────────────────────────────────────────────────────────────────────────────
// 10 scenarios
// ────────────────────────────────────────────────────────────────────────────

function scenario1(): OrchestrationScenarioResult {
  // Operational flattening — plan loses depth across sections.
  const out = runScenario(flattenedPlan());
  return {
    scenario: '1. planner operational flattening',
    passed: true,
    assertions: [
      ok('continuity detects flattening', out.continuity.detections.map((d) => d.type).join(','),
        out.continuity.detections.some((d) => d.type === 'NARRATIVE_FLATTENING' || d.type === 'PLANNER_SIMPLIFICATION'),
        'NARRATIVE_FLATTENING or PLANNER_SIMPLIFICATION'),
      ok('gate blocks', out.gate.decision, out.gate.decision === 'block', "'block'"),
      ok('recovery includes operational restoration', out.recovery.recoveryRecommendations.map((r) => r.strategy).join(','),
        out.recovery.recoveryRecommendations.some((r) => r.strategy === 'operational_proof_restoration' || r.strategy === 'strategic_narrative_restoration'),
        'operational_proof_restoration or strategic_narrative_restoration'),
    ],
  };
}

function scenario2(): OrchestrationScenarioResult {
  const out = runScenario(genericRewritePlan());
  return {
    scenario: '2. planner generic rewrite',
    passed: true,
    assertions: [
      ok('readiness blocked or weak', out.readiness.readinessBand, out.readiness.readinessBand === 'blocked' || out.readiness.readinessBand === 'weak', 'blocked or weak'),
      ok('gate blocks under balanced', out.gate.decision, out.gate.decision === 'block', "'block'"),
      ok('explanation whyBlocked present', out.explanation.whyBlocked ? 'present' : 'absent', out.explanation.whyBlocked !== null, 'present'),
    ],
  };
}

function scenario3(): OrchestrationScenarioResult {
  const out = runScenario(icpDilutedPlan(), 'balanced', { icpEntityPreservation: 25 });
  return {
    scenario: '3. ICP dilution during planning',
    passed: true,
    assertions: [
      ok('icpPreservation flagged as failing', out.readiness.failingDimensions.map((d) => d.dimension).join(','),
        out.readiness.failingDimensions.some((d) => d.dimension === 'icpPreservation'),
        'icpPreservation in failingDimensions'),
      ok('recovery suggests icp_re_anchoring', out.recovery.recoveryRecommendations.map((r) => r.strategy).join(','),
        out.recovery.recoveryRecommendations.some((r) => r.strategy === 'icp_re_anchoring'),
        'icp_re_anchoring present'),
    ],
  };
}

function scenario4(): OrchestrationScenarioResult {
  const out = runScenario(terminologyAbstractedPlan());
  return {
    scenario: '4. terminology abstraction',
    passed: true,
    assertions: [
      ok('terminologyPreservation flagged as failing', out.readiness.failingDimensions.map((d) => d.dimension).join(','),
        out.readiness.failingDimensions.some((d) => d.dimension === 'terminologyPreservation'),
        'terminologyPreservation in failingDimensions'),
      ok('continuity flags STRATEGIC_DILUTION', out.continuity.detections.map((d) => d.type).join(','),
        out.continuity.detections.some((d) => d.type === 'STRATEGIC_DILUTION'),
        'STRATEGIC_DILUTION present'),
      ok('recovery suggests terminology_reinforcement', out.recovery.recoveryRecommendations.map((r) => r.strategy).join(','),
        out.recovery.recoveryRecommendations.some((r) => r.strategy === 'terminology_reinforcement'),
        'terminology_reinforcement present'),
    ],
  };
}

function scenario5(): OrchestrationScenarioResult {
  const out = runScenario(seoReshapedPlan());
  return {
    scenario: '5. excessive SEO reshaping',
    passed: true,
    assertions: [
      ok('strategicIntegrity or operationalSpecificity weakens', out.readiness.failingDimensions.map((d) => d.dimension).join(','),
        out.readiness.failingDimensions.some((d) => d.dimension === 'strategicIntegrity' || d.dimension === 'operationalSpecificity' || d.dimension === 'capabilityPreservation'),
        'strategicIntegrity/operationalSpecificity/capabilityPreservation'),
      ok('gate produces a non-execute decision', out.gate.decision, out.gate.decision !== 'execute', "'warn' or 'block'"),
    ],
  };
}

function scenario6(): OrchestrationScenarioResult {
  const out = runScenario(capabilitySuppressedPlan());
  return {
    scenario: '6. capability suppression',
    passed: true,
    assertions: [
      ok('continuity flags CAPABILITY_SUPPRESSION', out.continuity.detections.map((d) => d.type).join(','),
        out.continuity.detections.some((d) => d.type === 'CAPABILITY_SUPPRESSION'),
        'CAPABILITY_SUPPRESSION present'),
      ok('recovery suggests capability_emphasis_restoration', out.recovery.recoveryRecommendations.map((r) => r.strategy).join(','),
        out.recovery.recoveryRecommendations.some((r) => r.strategy === 'capability_emphasis_restoration'),
        'capability_emphasis_restoration present'),
    ],
  };
}

function scenario7(): OrchestrationScenarioResult {
  const out = runScenario(weakNarrativePlan());
  return {
    scenario: '7. strategic narrative weakening',
    passed: true,
    assertions: [
      ok('strategicIntegrity flagged as failing', out.readiness.failingDimensions.map((d) => d.dimension).join(','),
        out.readiness.failingDimensions.some((d) => d.dimension === 'strategicIntegrity'),
        'strategicIntegrity in failingDimensions'),
      ok('explanation surfaces degradation', out.explanation.whatDegraded.length, out.explanation.whatDegraded.length > 20, '> 20 chars'),
    ],
  };
}

function scenario8(): OrchestrationScenarioResult {
  // Contradictory plan + strict mode → must block.
  const out = runScenario(contradictoryPlan(), 'strict');
  return {
    scenario: '8. contradictory planner intent (strict mode)',
    passed: true,
    assertions: [
      ok('gate blocks under strict', out.gate.decision, out.gate.decision === 'block', "'block'"),
      ok('explanation whyBlocked present', out.explanation.whyBlocked ? 'present' : 'absent', out.explanation.whyBlocked !== null, 'present'),
    ],
  };
}

function scenario9(): OrchestrationScenarioResult {
  const out = runScenario(highCoherenceLowIntegrityPlan());
  return {
    scenario: '9. high coherence / low integrity',
    passed: true,
    assertions: [
      ok('plannerCoherence below floor', out.readiness.dimensionScores.plannerCoherence, out.readiness.dimensionScores.plannerCoherence < 80, '< 80 (duplicate goals penalize)'),
      ok('readiness band is at most acceptable', out.readiness.readinessBand,
        ['blocked', 'weak', 'acceptable'].includes(out.readiness.readinessBand), 'blocked/weak/acceptable'),
    ],
  };
}

function scenario10(): OrchestrationScenarioResult {
  const out = runScenario(highNoveltyLowContinuityPlan(), 'balanced', { continuityScore: 35, semanticContinuityScore: 30, icpEntityPreservation: 20, inheritanceCompletenessScore: 35 });
  return {
    scenario: '10. high novelty / low continuity',
    passed: true,
    assertions: [
      ok('continuityIntegrity below floor', out.readiness.dimensionScores.continuityIntegrity, out.readiness.dimensionScores.continuityIntegrity < 50, '< 50'),
      ok('gate blocks', out.gate.decision, out.gate.decision === 'block', "'block'"),
      ok('recovery suggests recommendation_rehydration', out.recovery.recoveryRecommendations.map((r) => r.strategy).join(','),
        out.recovery.recoveryRecommendations.some((r) => r.strategy === 'recommendation_rehydration'),
        'recommendation_rehydration present'),
    ],
  };
}

// Sanity scenario — strong plan must NOT block, must produce diagnostics sample.
function scenarioStrongBaseline(): OrchestrationScenarioResult {
  const out = runScenario(makeStrongPlan());
  const reg = createGenerationPreparationDiagnosticsRegistry();
  reg.record({
    timestamp: new Date().toISOString(),
    companyId: 'stress',
    readiness: out.readiness,
    gate: out.gate,
    plannerContinuity: out.continuity,
    recoveryRecommendations: out.recovery.recoveryRecommendations,
    recoveryAttemptPlan: out.recovery.recoveryAttemptPlan,
  });
  const diag = reg.build('stress');
  return {
    scenario: 'baseline. strong plan — must NOT block, diagnostics emit',
    passed: true,
    assertions: [
      ok('gate executes or warns', out.gate.decision, out.gate.decision === 'execute' || out.gate.decision === 'warn', "'execute' or 'warn'"),
      ok('readiness band acceptable+', out.readiness.readinessBand, ['acceptable','strong','exceptional'].includes(out.readiness.readinessBand), 'acceptable/strong/exceptional'),
      ok('diagnostics sample size = 1', diag.sampleSize, diag.sampleSize === 1, '1'),
    ],
  };
}

function finalize(r: OrchestrationScenarioResult): OrchestrationScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export interface OrchestrationStressSuiteReport {
  scenarios: OrchestrationScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

export function runGenerationOrchestrationStressTests(): OrchestrationStressSuiteReport {
  const scenarios = [
    scenarioStrongBaseline(),
    scenario1(), scenario2(), scenario3(), scenario4(), scenario5(),
    scenario6(), scenario7(), scenario8(), scenario9(), scenario10(),
  ].map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatOrchestrationStressReport(report: OrchestrationStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — orchestration stress');
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
