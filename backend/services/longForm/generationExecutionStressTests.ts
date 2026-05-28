/**
 * Phase 10 — Generation execution stress tests.
 *
 * 12 scenarios that exercise the full orchestrator end-to-end with
 * synthetic SectionGenerator implementations. NO LLM calls. Deterministic.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormGenerationExecutionStress.ts
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';
import type {
  GenerationOrchestrationContract,
  LongFormRecommendation,
} from './longFormRecommendationTypes';
import type { PlanningInputPartial } from './longFormPlanningAdapter';
import type {
  SectionGenerator,
  SectionGenerationHint,
} from './longFormGenerationOrchestrator';
import { runLongFormGenerationOrchestrator } from './longFormGenerationOrchestrator';
import { buildGenerationOrchestrationContract } from './generationOrchestrationContract';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeRecommendation(): LongFormRecommendation {
  return {
    recommendationId: 'rec_exec_stress',
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
    strategicNarrative: 'Observability over agent decisions only works when sequenced before generic eval-suite best-practice advice. This piece walks through that sequence for engineering leaders, ending in reliable production agent behavior.',
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
    excerpt: 'A guide for engineering leaders on decision-trace observability for catching silent agent failures.',
    key_insights: [
      'Most teams sequence observability AFTER evals — silent failures reach users.',
      'Decision-trace observability is the runtime checkpoint mechanism.',
      'Sequencing before evals changes the audit profile.',
    ],
    sections: [
      baseSection({ title: 'What silent agent failures actually look like in production', goal: 'Define the silent-failure pattern and the audit gap.', requires_direct_answer: true, content_type: 'explanation' }),
      baseSection({ title: 'The decision-trace observability framework', goal: 'Introduce decision-trace observability with its 4 components.', content_type: 'framework', framework_role: 'introduce', word_target: 480 }),
      baseSection({ title: 'Applying decision-trace observability to silent failures', goal: 'Apply the framework with concrete steps inside the runtime telemetry workflow.', content_type: 'application', requires_direct_answer: true }),
      baseSection({ title: 'Examples: catching drift before users do', goal: 'Show realistic examples of decision-trace observability catching drift.', content_type: 'example' }),
      baseSection({ title: 'What most teams miss about agent observability', goal: 'Challenge the eval-first assumption.', content_type: 'insight', requires_opinionated_insight: true }),
    ],
    framework: {
      name: 'Decision-Trace Observability Framework',
      model_type: 'layers',
      components: ['Decision boundaries', 'Checkpoint policies', 'Escalation surfaces', 'Audit trail'],
      section_title: 'The decision-trace observability framework',
    },
    faq: [
      { question: 'What is decision-trace observability?', answer: 'A runtime-layer observability pattern capturing every agent decision boundary.' },
      { question: 'Why sequence observability before evals?', answer: 'Evals confirm correctness in test conditions; observability confirms it in production.' },
      { question: 'How does this change incident response?', answer: 'Teams detect drift via decision-trace anomalies before users report failures.' },
      { question: 'What does the audit trail look like?', answer: 'A chronological sequence of decision boundaries with checkpoint outcomes.' },
    ],
    evidence_plan: ['Use a payment-routing agent scenario with named decision boundaries.', 'Reference an industry benchmark.'],
  };
}

function makeContract(): {
  contract: GenerationOrchestrationContract;
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  contentPlan: ContentPlan;
} {
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
// Synthetic generators
// ────────────────────────────────────────────────────────────────────────────

function strongGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      const cap = contract.capabilityEmphasis.primaryCapability;
      const market = contract.icpFraming.market ?? 'engineering teams';
      const fw = contract.frameworkName || 'Decision-Trace Observability Framework';
      const components = contract.frameworkComponents.join(', ') || 'Decision boundaries, Checkpoint policies, Escalation surfaces, Audit trail';
      const directAnswer = contract.requiresDirectAnswer
        ? `<blockquote><strong>Direct answer:</strong> ${cap} only works when sequenced before generic eval-suite advice — the audit trail must capture decision boundaries inside the runtime telemetry workflow.</blockquote>`
        : '';
      const opinion = contract.requiresOpinionatedInsight
        ? `<p>Most teams treat agent observability as logging — that's the common assumption this section pushes back on. The counterintuitive insight: dashboards measure outputs; only decision-level traces capture the agent's reasoning. The runtime telemetry workflow must record every decision boundary, not just the result. This is the mistake most engineering leaders only see after the first production incident.</p>`
        : '';
      const frameworkText = contract.frameworkRole === 'introduce'
        ? `<p>The ${fw} has four components: ${components}. Each is sequenced before the next so the runtime telemetry workflow remains coherent: decision boundaries are instrumented first, checkpoint policies fire second, escalation surfaces respond third, and the audit trail closes the loop. Skip any one and the next collapses — that is the sequencing the strategic narrative requires.</p>`
        : '';
      const applyText = contract.frameworkRole === 'apply'
        ? `<ol><li>Step 1: instrument decision boundaries inside the runtime telemetry workflow with named checkpoints that fire on every agent decision.</li><li>Step 2: define checkpoint policies for agent observability — what counts as a drift event, what counts as a soft anomaly.</li><li>Step 3: route escalations via the audit trail so the team sees decision-trace anomalies before users report failures.</li><li>Step 4: feed the audit trail back into the eval suite so production decisions inform the next regression test.</li></ol>`
        : '';
      const exampleText = contract.contentType === 'example'
        ? `<p>Consider a payment-routing agent: without decision traces in the runtime telemetry workflow, a silent failure shows up as a 3% lift in chargebacks two weeks later. With named checkpoints in place, the same drift fires an escalation the same hour. Or a support-triage agent: the audit trail tells you which classification boundary failed, not just that the customer was misrouted.</p>`
        : '';
      return {
        html: `<h2>${contract.sectionTitle}</h2>
${directAnswer}
<p>For ${market} dealing with silent agent failures, decision traces inside the ${cap} surface the audit trail before users report incidents. The runtime telemetry workflow is the single mechanism that catches drift at the decision boundary instead of the output layer — and that is the sequencing the strategic narrative depends on.</p>
${frameworkText}
${applyText}
${exampleText}
<p>The named checkpoints in the runtime telemetry workflow act as the sequencing mechanism — the same one referenced in the strategic narrative: observability sequenced before evals. The audit trail is the only place teams catch decision-boundary drift before it propagates into a user-reported failure mode. Decision traces, when captured at every checkpoint, give the team the visibility eval suites alone cannot.</p>
<p>For an evaluation-stage buyer, this is the decision point: continue with eval-first tooling that confirms correctness in test conditions, or instrument the runtime telemetry workflow first so the audit trail is the source of truth in production. Most teams at this stage have already been burned by an eval-passes-prod-fails incident, which is why decision-trace observability — sequenced before evals — matters now.</p>
${opinion}
<p>The ICP problem mapping (engineering leaders at growth-stage SaaS facing silent agent failures and no decision audit) maps directly to the components above — agent observability instrumented at decision boundaries, decision traces as the unit of audit, runtime telemetry as the workflow that records them, and the audit trail as the surface every escalation flows through.</p>`,
      };
    },
  };
}

function genericGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>In today's fast-paced business landscape, leveraging AI is more important than ever for businesses today.</p>
<p>The ultimate guide to scaling your operations is to follow industry best practices and harness the power of automation.</p>
<p>Moreover, additionally, furthermore, organizations of all sizes must consider these critical factors. In addition, at the end of the day, it plays a pivotal role.</p>
<p>It's not just observability, it's a game-changer. Get started today, sign up now, contact us today to learn more about leveraging AI.</p>`,
      };
    },
  };
}

function degradingGenerator(): SectionGenerator {
  const baseStrong = strongGenerator();
  const baseGeneric = genericGenerator();
  let index = 0;
  return {
    async generate(input) {
      const useGeneric = index >= 2;
      index += 1;
      return useGeneric ? baseGeneric.generate(input) : baseStrong.generate(input);
    },
  };
}

function terminologyStrippingGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      // Returns reasonably substantive prose but strips ALL domain vocabulary.
      const market = contract.icpFraming.market ?? 'engineering teams';
      const directAnswer = contract.requiresDirectAnswer
        ? `<blockquote><strong>Direct answer:</strong> Watch how software makes choices in production.</blockquote>`
        : '';
      return {
        html: `<h2>${contract.sectionTitle}</h2>
${directAnswer}
<p>For ${market}, watching how software makes choices is essential. The system needs proper instrumentation so teams can investigate failures.</p>
<p>A good monitoring setup gives you visibility into what happens at run-time. Teams should put points in their pipeline where the software's choices can be inspected.</p>
<p>When the system makes a choice, that choice should be visible. The pipeline carries the data. The points note where things happen.</p>
<p>Step 1: put points in your pipeline. Step 2: inspect choices when they happen. Step 3: respond to anomalies through clear escalation channels.</p>`,
      };
    },
  };
}

function operationalFlatteningGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Agent observability is important. Decision traces help with audit trail concerns. Engineering teams should think about these things in general.</p>
<p>The runtime telemetry workflow is part of the agent observability picture. It might consider various aspects of monitoring.</p>
<p>In general, teams benefit from thinking about agent observability and decision traces at a high level. The audit trail can also play a role.</p>`,
      };
    },
  };
}

function icpFlatteningGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>Modern systems benefit from decision-trace observability and the runtime telemetry workflow. The audit trail is a common need.</p>
<p>Any team working with agents will encounter decision boundaries. Checkpoint policies and escalation surfaces matter across the board.</p>
<p>This is true for organizations of every shape — the agent observability layer applies universally regardless of role or stage.</p>`,
      };
    },
  };
}

function capabilityDisappearanceGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      const market = contract.icpFraming.market ?? 'engineering teams';
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>${market} face silent failures in production. The observability gap is real.</p>
<p>Teams need ways to monitor agent behavior. There are several monitoring approaches available — each with its own trade-offs.</p>
<p>An audit-style approach can help, especially when teams need to investigate after the fact. Other approaches include dashboard-based and log-based monitoring.</p>`,
      };
    },
  };
}

function seoOverOptimizationGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>How to monitor AI agents is a top concern. This complete guide covers the best practices for monitoring agents at scale.</p>
<p>Top 5 ways to optimize agent monitoring: use logs, use dashboards, use alerts, use audit, use evals. How to leverage these tools is the question.</p>
<p>The ultimate guide to scaling agent monitoring follows industry best practices. Get started today by signing up now.</p>`,
      };
    },
  };
}

function repetitiveStructureGenerator(): SectionGenerator {
  let i = 0;
  return {
    async generate({ contract }) {
      i += 1;
      // Every section has identical structure and near-identical wording.
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>This section discusses agent observability. Agent observability matters. Agent observability is part of decision traces. Decision traces are part of agent observability. The runtime telemetry workflow is the runtime telemetry workflow.</p>
<p>This is the ${i}-th section about agent observability and decision traces in the runtime telemetry workflow.</p>`,
      };
    },
  };
}

function weakEditorialSequencingGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      // Section produced regardless of role (introduce/apply/none).
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>This is a generic section about agent observability and decision traces. It mentions the runtime telemetry workflow and the audit trail.</p>
<p>The section does not introduce frameworks, does not apply them, does not provide direct answers, and does not surface opinionated insight even when the contract requires it.</p>`,
      };
    },
  };
}

function inconsistentToneGenerator(): SectionGenerator {
  let i = 0;
  const tones = ['Formal academic', 'Casual conversational', 'Salesy promotional', 'Defensive cautious', 'Confident assertive'];
  return {
    async generate({ contract }) {
      const tone = tones[i % tones.length];
      i += 1;
      const cap = contract.capabilityEmphasis.primaryCapability;
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p><em>${tone} tone:</em> ${i % 2 === 0
  ? `It is hereby established that ${cap} constitutes a critical operational consideration of substantial significance.`
  : `Hey team! Let's chat about ${cap} — it's pretty cool how this stuff works in agent observability and the runtime telemetry workflow!`}</p>`,
      };
    },
  };
}

function strategicNarrativeDriftGenerator(): SectionGenerator {
  return {
    async generate({ contract }) {
      const cap = contract.capabilityEmphasis.primaryCapability;
      return {
        html: `<h2>${contract.sectionTitle}</h2>
<p>${cap} and runtime telemetry workflows are useful add-ons. Most teams can probably get by without them; they're nice-to-haves rather than must-haves.</p>
<p>Teams might consider observability after they have evals working. The audit trail is a secondary concern that can be added later.</p>`,
      };
    },
  };
}

function partialRecoveryGenerator(): SectionGenerator {
  let attempt = 0;
  const generic = genericGenerator();
  const strong = strongGenerator();
  return {
    async generate(input) {
      attempt += 1;
      // First attempt = generic, second attempt (after recovery hint) = strong.
      return attempt === 1 ? generic.generate(input) : strong.generate(input);
    },
  };
}

function cascadingDegradationGenerator(): SectionGenerator {
  const strong = strongGenerator();
  const generic = genericGenerator();
  let i = 0;
  return {
    async generate(input) {
      i += 1;
      // Sections 1, 2 strong; 3, 4, 5 generic — multi-section cascade.
      return i <= 2 ? strong.generate(input) : generic.generate(input);
    },
  };
}

// Used to test the orchestrator handles hints (recovery) gracefully.
function hintAwareGenerator(): SectionGenerator {
  return {
    async generate({ contract, hint }) {
      const cap = contract.capabilityEmphasis.primaryCapability;
      const market = contract.icpFraming.market ?? 'engineering teams';
      if (!hint) {
        // First attempt is generic.
        return genericGenerator().generate({ contract });
      }
      // Second attempt honors the recovery hint and produces a strong section.
      return strongGenerator().generate({ contract, hint });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Assertion runner
// ────────────────────────────────────────────────────────────────────────────

export interface ExecutionAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface ExecutionScenarioResult {
  scenario: string;
  assertions: ExecutionAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): ExecutionAssertion {
  return { name, observed, passed, expected };
}

async function runScenarioWithGenerator(generator: SectionGenerator, opts?: { maxRecoveryAttemptsPerSection?: number }): Promise<Awaited<ReturnType<typeof runLongFormGenerationOrchestrator>>> {
  const { contract, recommendation, planningInput, contentPlan } = makeContract();
  return runLongFormGenerationOrchestrator({
    generationContract: contract,
    recommendation,
    planningInput,
    contentPlan,
    sectionGenerator: generator,
    maxRecoveryAttemptsPerSection: opts?.maxRecoveryAttemptsPerSection ?? 2,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 12 scenarios + 1 baseline
// ────────────────────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(strongGenerator());
  return {
    scenario: 'baseline. strong generator — must pass without recovery',
    passed: true,
    assertions: [
      ok('finalLifecycleState article_completed', r.finalLifecycleState, r.finalLifecycleState === 'article_completed', "'article_completed'"),
      ok('integrityBand acceptable+', r.integrity.integrityBand, ['acceptable','strong','exceptional'].includes(r.integrity.integrityBand), 'acceptable/strong/exceptional'),
      ok('zero recovery attempts', r.recoveryHistory.length, r.recoveryHistory.length === 0, '0'),
      ok('zero sections failed', r.sectionOutcomes.filter((s) => !s.passed).length, r.sectionOutcomes.every((s) => s.passed), 'all passed'),
    ],
  };
}

async function scenario1_genericCollapse(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(genericGenerator());
  return {
    scenario: '1. generic section collapse',
    passed: true,
    assertions: [
      ok('every section blocked by suppression', String(r.sectionOutcomes.every((s) => s.finalGenericity.hardBlocked || !s.passed)), r.sectionOutcomes.every((s) => s.finalGenericity.hardBlocked || !s.passed), 'all blocked'),
      ok('finalLifecycleState article_failed or article_recovered', r.finalLifecycleState, r.finalLifecycleState === 'article_failed' || r.finalLifecycleState === 'article_recovered', 'article_failed/article_recovered'),
    ],
  };
}

async function scenario2_operationalErosion(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(operationalFlatteningGenerator());
  return {
    scenario: '2. operational detail erosion',
    passed: true,
    assertions: [
      ok('integrity below strong', r.integrity.integrityBand, r.integrity.integrityBand === 'failed' || r.integrity.integrityBand === 'weak' || r.integrity.integrityBand === 'acceptable', '!= strong/exceptional'),
      ok('operationalContinuity dimension below floor or borderline', r.integrity.dimensionScores.operationalContinuity, r.integrity.dimensionScores.operationalContinuity < 70, '< 70'),
    ],
  };
}

async function scenario3_terminologySimplification(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(terminologyStrippingGenerator());
  return {
    scenario: '3. terminology simplification',
    passed: true,
    assertions: [
      ok('terminologyPreservation below floor', r.integrity.dimensionScores.terminologyPreservation, r.integrity.dimensionScores.terminologyPreservation < 50, '< 50'),
      ok('some recovery action attempted', r.recoveryHistory.length, r.recoveryHistory.length > 0, '> 0'),
    ],
  };
}

async function scenario4_capabilityDisappearance(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(capabilityDisappearanceGenerator());
  return {
    scenario: '4. capability disappearance',
    passed: true,
    assertions: [
      ok('capabilityPreservation dimension weakens', r.integrity.dimensionScores.capabilityPreservation, r.integrity.dimensionScores.capabilityPreservation < 70, '< 70'),
    ],
  };
}

async function scenario5_icpFlattening(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(icpFlatteningGenerator());
  return {
    scenario: '5. ICP flattening',
    passed: true,
    assertions: [
      ok('icpPreservation dimension weakens', r.integrity.dimensionScores.icpPreservation, r.integrity.dimensionScores.icpPreservation < 70, '< 70'),
    ],
  };
}

async function scenario6_seoOverOptimization(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(seoOverOptimizationGenerator());
  return {
    scenario: '6. SEO over-optimization',
    passed: true,
    assertions: [
      ok('genericityPressure dimension weakens', r.integrity.dimensionScores.genericityPressure, r.integrity.dimensionScores.genericityPressure < 80, '< 80'),
      ok('section-level SEO_OVERFITTING or ULTIMATE_GUIDE detected', r.sectionOutcomes.flatMap((s) => [
        ...s.finalContinuity.detections.map((d) => d.type),
        ...s.finalGenericity.detections.map((d) => d.type),
      ]).join(','), r.sectionOutcomes.some((s) =>
        s.finalContinuity.detections.some((d) => d.type === 'SEO_OVERFITTING')
        || s.finalGenericity.detections.some((d) => d.type === 'ULTIMATE_GUIDE')
        || s.finalGenericity.detections.some((d) => d.type === 'SEO_FLUFF'),
      ), 'SEO_OVERFITTING / ULTIMATE_GUIDE / SEO_FLUFF present'),
    ],
  };
}

async function scenario7_repetitiveStructures(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(repetitiveStructureGenerator());
  return {
    scenario: '7. repetitive section structures',
    passed: true,
    assertions: [
      ok('sectionCoherence dimension penalizes duplication', r.integrity.dimensionScores.sectionCoherence, r.integrity.dimensionScores.sectionCoherence < 75, '< 75'),
    ],
  };
}

async function scenario8_weakSequencing(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(weakEditorialSequencingGenerator());
  return {
    scenario: '8. weak editorial sequencing',
    passed: true,
    assertions: [
      ok('editorialSequencing dimension weakens', r.integrity.dimensionScores.editorialSequencing, r.integrity.dimensionScores.editorialSequencing < 75, '< 75'),
    ],
  };
}

async function scenario9_inconsistentTone(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(inconsistentToneGenerator());
  return {
    scenario: '9. inconsistent section tone',
    passed: true,
    assertions: [
      ok('narrativeContinuity dimension weakens', r.integrity.dimensionScores.narrativeContinuity, r.integrity.dimensionScores.narrativeContinuity < 75, '< 75'),
    ],
  };
}

async function scenario10_strategicNarrativeDrift(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(strategicNarrativeDriftGenerator());
  return {
    scenario: '10. strategic narrative drift',
    passed: true,
    assertions: [
      ok('strategicContinuity dimension weakens', r.integrity.dimensionScores.strategicContinuity, r.integrity.dimensionScores.strategicContinuity < 80, '< 80'),
      ok('some NARRATIVE_SIMPLIFICATION detection fired', r.sectionOutcomes.flatMap((s) => s.finalContinuity.detections.map((d) => d.type)).join(','),
        r.sectionOutcomes.some((s) => s.finalContinuity.detections.some((d) => d.type === 'NARRATIVE_SIMPLIFICATION' || d.type === 'SECTION_GENERIC_COLLAPSE')),
        'NARRATIVE_SIMPLIFICATION or SECTION_GENERIC_COLLAPSE present'),
    ],
  };
}

async function scenario11_partialRecovery(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(hintAwareGenerator(), { maxRecoveryAttemptsPerSection: 2 });
  return {
    scenario: '11. partial section recovery (hint-aware generator)',
    passed: true,
    assertions: [
      ok('recovery history has improvement entries', r.recoveryHistory.length, r.recoveryHistory.length > 0, '> 0'),
      ok('at least one recovered section improved', r.recoveryHistory.filter((h) => h.improved).length, r.recoveryHistory.some((h) => h.improved), 'improved=true on at least one entry'),
      ok('finalLifecycleState article_recovered or article_completed', r.finalLifecycleState, r.finalLifecycleState === 'article_recovered' || r.finalLifecycleState === 'article_completed', 'recovered/completed'),
    ],
  };
}

async function scenario12_cascadeDegradation(): Promise<ExecutionScenarioResult> {
  const r = await runScenarioWithGenerator(cascadingDegradationGenerator());
  return {
    scenario: '12. multi-section degradation cascade',
    passed: true,
    assertions: [
      ok('at least 2 sections failed governance', r.sectionOutcomes.filter((s) => !s.passed).length, r.sectionOutcomes.filter((s) => !s.passed).length >= 2, '>= 2'),
      ok('diagnostics continuityDegradationTrend = degrading', r.diagnostics.continuityDegradationTrend, r.diagnostics.continuityDegradationTrend === 'degrading', "'degrading'"),
      ok('integrity not exceptional', r.integrity.integrityBand, r.integrity.integrityBand !== 'exceptional', '!= exceptional'),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite runner
// ────────────────────────────────────────────────────────────────────────────

export interface ExecutionStressSuiteReport {
  scenarios: ExecutionScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: ExecutionScenarioResult): ExecutionScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runGenerationExecutionStressTests(): Promise<ExecutionStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_genericCollapse(),
    scenario2_operationalErosion(),
    scenario3_terminologySimplification(),
    scenario4_capabilityDisappearance(),
    scenario5_icpFlattening(),
    scenario6_seoOverOptimization(),
    scenario7_repetitiveStructures(),
    scenario8_weakSequencing(),
    scenario9_inconsistentTone(),
    scenario10_strategicNarrativeDrift(),
    scenario11_partialRecovery(),
    scenario12_cascadeDegradation(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatExecutionStressReport(report: ExecutionStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — execution stress');
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
