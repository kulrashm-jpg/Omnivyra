/**
 * Phase 12 — Factual integrity stress tests.
 *
 * Ten adversarial generators + 1 strong baseline. Verify hallucination
 * detection, evidence classification, recovery routing, trust calibration,
 * and false-positive suppression.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormFactualIntegrityStress.ts
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';
import type {
  GenerationOrchestrationContract,
  LongFormRecommendation,
} from './longFormRecommendationTypes';
import type { PlanningInputPartial } from './longFormPlanningAdapter';
import type { SectionGenerator } from './longFormGenerationOrchestrator';
import { runLongFormGenerationOrchestrator } from './longFormGenerationOrchestrator';
import { buildGenerationOrchestrationContract } from './generationOrchestrationContract';

// ────────────────────────────────────────────────────────────────────────────
// Shared fixtures (mirror the execution-phase suite)
// ────────────────────────────────────────────────────────────────────────────

function makeRecommendation(): LongFormRecommendation {
  return {
    recommendationId: 'rec_factual_stress',
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
    strategicNarrative: 'Observability over agent decisions only works when sequenced before generic eval-suite advice.',
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
      hardRules: ['Anchor every claim to the runtime telemetry workflow.'],
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
    faq: [{ question: 'What is decision-trace observability?', answer: 'A runtime-layer pattern capturing every agent decision boundary.' }],
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
// Strong baseline (must NOT trip factual governance)
// ────────────────────────────────────────────────────────────────────────────

function strongFactualGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      const cap = contract.capabilityEmphasis.primaryCapability;
      const fw = contract.frameworkName || 'Decision-Trace Observability Framework';
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>In our experience, engineering leaders at growth-stage SaaS typically see silent agent failures surface only after users report incidents. Agent observability — when sequenced before generic eval-suite advice — often catches drift earlier in the runtime telemetry workflow.</p>
<p>${cap} works as a sequencing mechanism in our deployments. The ${fw} has four components: decision boundaries, checkpoint policies, escalation surfaces, and audit trail. Each may be instrumented independently, depending on the team's existing tooling.</p>
<p>In many cases the audit trail captures decision-trace anomalies before the eval suite catches the drift. This is the through-line we walk through in this guide: decision traces, sequenced before evals, with named checkpoints in the runtime telemetry workflow.</p>
<p>Step 1: instrument decision boundaries. Step 2: define checkpoint policies for agent observability. Step 3: route escalations via the audit trail. The order tends to matter — teams that skip step 1 typically experience the silent-failure pattern.</p>
<p>For example, a payment-routing agent's runtime telemetry workflow may surface a 3% drift event the same hour it occurs. The audit trail shows which checkpoint policy fired and why. Decision traces are the unit of audit in this approach.</p>
<p>Engineering leaders often find that decision-trace observability requires manual review at the checkpoint-policy stage initially — depending on the rollout cadence. Over time, automation can take over once the audit trail is stable. This is one approach; your mileage may vary depending on your runtime telemetry workflow maturity.</p>`,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Adversarial generators — each targets specific detections
// ────────────────────────────────────────────────────────────────────────────

function fakeStatisticsGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>75% of engineering teams save 40% on incident response by adopting agent observability. Companies save 60% on operational overhead when they deploy decision traces.</p>
<p>In a typical runtime telemetry workflow, 92% of silent agent failures are caught before users report them. $2.5M saved per team per year on average.</p>
<p>Decision traces deliver 10x faster incident detection. The audit trail reduces MTTR by 80% in our deployments.</p>`,
      };
    },
  };
}

function fabricatedBenchmarkGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Our decision-trace observability platform is 40% faster than competitors. It beats the nearest alternative on every benchmark.</p>
<p>Compared to logging-based monitoring, decision traces are 5x more accurate and 75% cheaper to operate. The runtime telemetry workflow outperforms eval-first tooling on all key metrics.</p>
<p>Industry-wide best practice is to deploy decision-trace observability ahead of evals.</p>`,
      };
    },
  };
}

function fakeCustomerExamplesGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>ACME Corp saved 50% on incident response by adopting agent observability. Stripe Inc reduced silent failures by 80% with decision traces.</p>
<p>A Fortune 500 customer achieved 90% MTTR reduction in 30 days. Globex Group cut their audit trail review time by 65%.</p>
<p>Initech Capital delivered $5M in savings by deploying our runtime telemetry workflow.</p>`,
      };
    },
  };
}

function unsupportedRoiGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Agent observability delivers 100x ROI and infinite scale. Teams unleash exponential productivity gains overnight.</p>
<p>Guaranteed ROI for every team that adopts decision-trace observability. Transform your business in days with the runtime telemetry workflow.</p>
<p>Unlock unprecedented operational efficiency. Say goodbye to silent agent failures.</p>`,
      };
    },
  };
}

function exaggeratedOperationalCertaintyGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>This always works. Decision-trace observability is guaranteed to eliminate all silent agent failures. Never fails.</p>
<p>Our runtime telemetry workflow is 100% reliable. It works every time, in every team, regardless of context.</p>
<p>Completely solves the audit trail problem. Removes every escalation manually required today.</p>`,
      };
    },
  };
}

function fakeResearchReferencesGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Gartner reports that 75% of engineering teams are adopting decision-trace observability. Forrester research shows it reduces MTTR by 60%.</p>
<p>McKinsey analyst surveys find that the runtime telemetry workflow is the future of agent operations. A recent Harvard Business Review study concludes that decision traces beat eval-first approaches.</p>
<p>IDC reports indicate that industry-wide best practice is to sequence observability ahead of evals.</p>`,
      };
    },
  };
}

function hallucinatedWorkflowGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Our proprietary OmnivyraNexus Engine instantly deploys decision-trace observability with zero setup. Every team can be live in minutes with no configuration required.</p>
<p>The SignaTrace Platform fully automates the runtime telemetry workflow but also requires manual review for every checkpoint. The HyperFlow System replaces all tools your team currently uses.</p>
<p>Our platform reaches enterprise maturity in a single click. The training program takes two weeks.</p>`,
      };
    },
  };
}

function pseudoExpertAuthorityGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>As leading experts in agent observability, we wrote the book on decision traces. Trust us on this: the industry has spoken.</p>
<p>We own this space. Everyone agrees that decision-trace observability is the future. There is no doubt that the runtime telemetry workflow is the right approach.</p>
<p>It is universally accepted that audit trails are mandatory. Absolutely, definitively, without question — this is the way.</p>`,
      };
    },
  };
}

function unsupportedTransformationGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Transform your engineering organization overnight with decision-trace observability. Revolutionize how teams operate in days.</p>
<p>Reinvent the way your team builds with the runtime telemetry workflow. Unleash unprecedented productivity gains.</p>
<p>Say goodbye to silent agent failures forever. You'll never worry about audit trails again.</p>`,
      };
    },
  };
}

function speculativeAsFactsGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Decision-trace observability definitely works for every team. It is absolutely the only viable approach to agent monitoring. Every engineering leader will adopt it within the next year.</p>
<p>Without question, the runtime telemetry workflow is the most reliable system available. There is no doubt that decision traces are the only path forward.</p>
<p>Studies show that decision-trace observability is undeniably superior. Research proves it is the undisputed industry standard.</p>`,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────

async function runScenarioWithGenerator(generator: SectionGenerator) {
  const { contract, recommendation, planningInput, contentPlan } = makeContract();
  return runLongFormGenerationOrchestrator({
    generationContract: contract,
    recommendation,
    planningInput,
    contentPlan,
    sectionGenerator: generator,
    maxRecoveryAttemptsPerSection: 1, // factual stress: don't double-spend regen attempts in tests
  });
}

export interface FactualAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface FactualScenarioResult {
  scenario: string;
  assertions: FactualAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): FactualAssertion {
  return { name, observed, passed, expected };
}

async function scenario_baseline(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(strongFactualGenerator());
  const allHall = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections);
  return {
    scenario: 'baseline. strong factual generator — must pass factual governance',
    passed: true,
    assertions: [
      ok('zero critical hallucinations', allHall.filter((d) => d.severity === 'critical').length, allHall.filter((d) => d.severity === 'critical').length === 0, '0'),
      ok('factual integrity band is moderate or better', r.factualIntegrity.hallucinationRiskBand, ['minimal','low','moderate'].includes(r.factualIntegrity.hallucinationRiskBand), 'minimal/low/moderate'),
      ok('finalLifecycleState completed or recovered', r.finalLifecycleState, r.finalLifecycleState === 'article_completed' || r.finalLifecycleState === 'article_recovered', "completed/recovered"),
    ],
  };
}

async function scenario1_fakeStats(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(fakeStatisticsGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '1. fake statistics',
    passed: true,
    assertions: [
      ok('INVENTED_STATISTIC detected', types.join(','), types.includes('INVENTED_STATISTIC'), 'INVENTED_STATISTIC present'),
      ok('factual hard-blocked or band high+', r.sectionOutcomes.some((s) => s.finalFactual.hallucination.hardBlocked) ? 'hard-blocked' : r.factualIntegrity.hallucinationRiskBand,
        r.sectionOutcomes.some((s) => s.finalFactual.hallucination.hardBlocked) || r.factualIntegrity.hallucinationRiskBand === 'high' || r.factualIntegrity.hallucinationRiskBand === 'critical',
        'hardBlocked OR risk high/critical'),
      ok('recovery suggests remove_fabricated_statistic', r.factualRecoveryActionsApplied.map((s) => s.action).join(','),
        r.factualRecoveryActionsApplied.some((s) => s.action === 'remove_fabricated_statistic'),
        'remove_fabricated_statistic present'),
    ],
  };
}

async function scenario2_fakeBenchmarks(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(fabricatedBenchmarkGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '2. fabricated benchmark claims',
    passed: true,
    assertions: [
      ok('FAKE_BENCHMARK or FAKE_INDUSTRY_STANDARD detected', types.join(','),
        types.includes('FAKE_BENCHMARK') || types.includes('FAKE_INDUSTRY_STANDARD'),
        'FAKE_BENCHMARK/FAKE_INDUSTRY_STANDARD'),
      ok('recovery suggests remove_fake_benchmark', r.factualRecoveryActionsApplied.map((s) => s.action).join(','),
        r.factualRecoveryActionsApplied.some((s) => s.action === 'remove_fake_benchmark'),
        'remove_fake_benchmark present'),
    ],
  };
}

async function scenario3_fakeCustomers(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(fakeCustomerExamplesGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '3. fake customer examples',
    passed: true,
    assertions: [
      ok('FAKE_CUSTOMER_EXAMPLE detected', types.join(','), types.includes('FAKE_CUSTOMER_EXAMPLE'), 'FAKE_CUSTOMER_EXAMPLE present'),
      ok('finalLifecycleState NOT article_completed (must be recovered/failed)', r.finalLifecycleState, r.finalLifecycleState !== 'article_completed', '!= article_completed'),
    ],
  };
}

async function scenario4_unsupportedRoi(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(unsupportedRoiGenerator());
  const authorityTypes = r.sectionOutcomes.flatMap((s) => s.finalFactual.authority.detections.map((d) => d.type));
  return {
    scenario: '4. unsupported ROI claims',
    passed: true,
    assertions: [
      ok('UNREALISTIC_ROI detected', authorityTypes.join(','), authorityTypes.includes('UNREALISTIC_ROI'), 'UNREALISTIC_ROI present'),
      ok('authority calibration weakens', r.factualIntegrity.dimensionScores.authorityCalibration, r.factualIntegrity.dimensionScores.authorityCalibration < 80, '< 80'),
    ],
  };
}

async function scenario5_operationalCertainty(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(exaggeratedOperationalCertaintyGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '5. exaggerated operational certainty',
    passed: true,
    assertions: [
      ok('FABRICATED_OPERATIONAL_CERTAINTY detected', types.join(','), types.includes('FABRICATED_OPERATIONAL_CERTAINTY'), 'FABRICATED_OPERATIONAL_CERTAINTY present'),
      ok('recovery suggests soften_certainty', r.factualRecoveryActionsApplied.map((s) => s.action).join(','),
        r.factualRecoveryActionsApplied.some((s) => s.action === 'soften_certainty' || s.action === 'restore_operational_realism'),
        'soften_certainty / restore_operational_realism'),
    ],
  };
}

async function scenario6_fakeResearch(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(fakeResearchReferencesGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '6. fake research references',
    passed: true,
    assertions: [
      ok('FAKE_RESEARCH_REFERENCE detected', types.join(','), types.includes('FAKE_RESEARCH_REFERENCE'), 'FAKE_RESEARCH_REFERENCE present'),
      ok('factual hard-blocked on some section', r.sectionOutcomes.map((s) => s.finalFactual.hallucination.hardBlocked).join(','),
        r.sectionOutcomes.some((s) => s.finalFactual.hallucination.hardBlocked),
        'at least one section hard-blocked'),
    ],
  };
}

async function scenario7_hallucinatedWorkflow(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(hallucinatedWorkflowGenerator());
  const opIssues = r.sectionOutcomes.flatMap((s) => s.finalFactual.operational.issues.map((i) => i.type));
  return {
    scenario: '7. hallucinated workflows',
    passed: true,
    assertions: [
      ok('IMPOSSIBLE_WORKFLOW or FAKE_SYSTEM_OR_PROCESS detected', opIssues.join(','),
        opIssues.includes('IMPOSSIBLE_WORKFLOW') || opIssues.includes('FAKE_SYSTEM_OR_PROCESS') || opIssues.includes('CONTRADICTORY_EXECUTION'),
        'IMPOSSIBLE_WORKFLOW / FAKE_SYSTEM_OR_PROCESS / CONTRADICTORY_EXECUTION'),
      ok('operational realism weakens', r.factualIntegrity.dimensionScores.operationalRealism, r.factualIntegrity.dimensionScores.operationalRealism < 70, '< 70'),
    ],
  };
}

async function scenario8_pseudoExpert(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(pseudoExpertAuthorityGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.authority.detections.map((d) => d.type));
  return {
    scenario: '8. pseudo-expert authority inflation',
    passed: true,
    assertions: [
      ok('PSEUDO_EXPERT_LANGUAGE or FAKE_STRATEGIC_AUTHORITY detected', types.join(','),
        types.includes('PSEUDO_EXPERT_LANGUAGE') || types.includes('FAKE_STRATEGIC_AUTHORITY'),
        'PSEUDO_EXPERT_LANGUAGE / FAKE_STRATEGIC_AUTHORITY'),
      ok('authority calibration drops below floor', r.factualIntegrity.dimensionScores.authorityCalibration, r.factualIntegrity.dimensionScores.authorityCalibration < 60, '< 60'),
    ],
  };
}

async function scenario9_unsupportedTransformation(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(unsupportedTransformationGenerator());
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.authority.detections.map((d) => d.type));
  return {
    scenario: '9. unsupported transformation promises',
    passed: true,
    assertions: [
      ok('INFLATED_TRANSFORMATION_PROMISE or MANIPULATIVE_CERTAINTY detected', types.join(','),
        types.includes('INFLATED_TRANSFORMATION_PROMISE') || types.includes('MANIPULATIVE_CERTAINTY_FRAMING'),
        'INFLATED_TRANSFORMATION_PROMISE / MANIPULATIVE_CERTAINTY_FRAMING'),
    ],
  };
}

async function scenario10_speculativeAsFacts(): Promise<FactualScenarioResult> {
  const r = await runScenarioWithGenerator(speculativeAsFactsGenerator());
  const overconfident = r.sectionOutcomes.flatMap((s) => s.finalFactual.speculative.overconfidentClaims);
  const types = r.sectionOutcomes.flatMap((s) => s.finalFactual.hallucination.hallucinationDetections.map((d) => d.type));
  return {
    scenario: '10. speculative statements phrased as facts',
    passed: true,
    assertions: [
      ok('UNVERIFIABLE_FACT_AS_TRUTH or UNSUPPORTED_AUTHORITY detected', types.join(','),
        types.includes('UNVERIFIABLE_FACT_AS_TRUTH') || types.includes('UNSUPPORTED_AUTHORITY'),
        'UNVERIFIABLE_FACT_AS_TRUTH / UNSUPPORTED_AUTHORITY'),
      ok('overconfident claims surfaced', overconfident.length, overconfident.length > 0, '> 0'),
      ok('trust calibration warnings present', r.factualIntegrity.trustCalibrationWarnings.length, r.factualIntegrity.trustCalibrationWarnings.length > 0, '> 0'),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

export interface FactualStressSuiteReport {
  scenarios: FactualScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: FactualScenarioResult): FactualScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runFactualIntegrityStressTests(): Promise<FactualStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_fakeStats(),
    scenario2_fakeBenchmarks(),
    scenario3_fakeCustomers(),
    scenario4_unsupportedRoi(),
    scenario5_operationalCertainty(),
    scenario6_fakeResearch(),
    scenario7_hallucinatedWorkflow(),
    scenario8_pseudoExpert(),
    scenario9_unsupportedTransformation(),
    scenario10_speculativeAsFacts(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatFactualStressReport(report: FactualStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — factual integrity');
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
