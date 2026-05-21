import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { GenerationGuidanceContract, SectionGenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export type EditorialMaturityStage =
  | 'foundational'
  | 'emerging'
  | 'operational'
  | 'advanced';

export interface SectionEditorialDepthPrimitive {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  operationalNuanceTargets: readonly string[];
  tradeoffExpectations: readonly string[];
  implementationFrictionSignals: readonly string[];
  stakeholderComplexitySignals: readonly string[];
  maturityStageSignals: readonly string[];
  proofDepthExpectations: readonly string[];
  workflowRealismTargets: readonly string[];
  decisionImpactSignals: readonly string[];
  misconceptionTargets: readonly string[];
  strategicTensionSignals: readonly string[];
  beforeAfterStateTargets: readonly string[];
  failurePatternTargets: readonly string[];
}

export interface EditorialDepthIntelligence {
  version: 'editorial-depth-intelligence-v1';
  topic: string;
  contentType: string;
  maturityStage: EditorialMaturityStage;
  globalDepthExpectations: readonly string[];
  sections: readonly SectionEditorialDepthPrimitive[];
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function clean(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function compact(values: readonly string[], limit = 4): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value, ''))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function inferMaturityStage(assimilation: AssimilatedEditorialPrimitives): EditorialMaturityStage {
  if (assimilation.completeness.level === 'sparse') return 'foundational';
  if (assimilation.completeness.level === 'partial') return 'emerging';
  const signalCount = [
    assimilation.differentiatorLogic.primary,
    assimilation.authorityClaim.claim,
    assimilation.transformationMechanism.mechanism,
    ...assimilation.proofExpectations,
    ...assimilation.implementationPhilosophy,
  ].filter((signal) => clean(signal, '')).length;
  return signalCount >= 7 ? 'advanced' : 'operational';
}

function stageDepthBehavior(stage: NarrativeProgressionStage): {
  nuance: readonly string[];
  tradeoffs: readonly string[];
  friction: readonly string[];
  stakeholders: readonly string[];
  proof: readonly string[];
  workflow: readonly string[];
  decisionImpact: readonly string[];
  misconceptions: readonly string[];
  failurePatterns: readonly string[];
} {
  const behavior: Record<NarrativeProgressionStage, ReturnType<typeof stageDepthBehavior>> = {
    diagnose: {
      nuance: ['separate visible symptom from operating cause', 'name where the problem shows up in daily decisions'],
      tradeoffs: ['speed of action versus accuracy of diagnosis', 'content volume versus operating clarity'],
      friction: ['unclear ownership', 'fragmented context', 'decision latency caused by weak upstream signals'],
      stakeholders: ['operator under pressure', 'leader accountable for direction', 'execution team handling downstream work'],
      proof: ['use workflow pressure or decision failure as evidence'],
      workflow: ['show the moment where the current process breaks'],
      decisionImpact: ['clarify what decision becomes harder when the diagnosis is weak'],
      misconceptions: ['treating the surface topic as the root problem'],
      failurePatterns: ['solving symptoms before naming the operating constraint'],
    },
    reframe: {
      nuance: ['contrast the default category logic with the company-conditioned logic', 'make the changed interpretation explicit'],
      tradeoffs: ['familiar category language versus more accurate operating language', 'neutral explanation versus strategic POV'],
      friction: ['internal resistance to changing the mental model', 'legacy assumptions carried into new workflows'],
      stakeholders: ['decision maker choosing the frame', 'team inheriting the frame through execution'],
      proof: ['prove the reframe through contrast, not another definition'],
      workflow: ['show how the new frame changes prioritization or sequencing'],
      decisionImpact: ['identify which decisions improve when the reframe is accepted'],
      misconceptions: ['assuming the common category explanation is sufficient'],
      failurePatterns: ['adding a new framework without replacing the old assumption'],
    },
    expand: {
      nuance: ['explain the mechanism behind the claim', 'separate adjacent concepts that are often blurred'],
      tradeoffs: ['simple explanation versus accurate mechanism', 'broad benefit list versus specific implication'],
      friction: ['conceptual ambiguity', 'unclear causal chain', 'overextended claims'],
      stakeholders: ['analyst explaining the mechanism', 'operator translating the mechanism into judgment'],
      proof: ['use mechanisms, distinctions, or bounded examples'],
      workflow: ['connect mechanism to how work is interpreted or reviewed'],
      decisionImpact: ['show which interpretation or prioritization changes because of the mechanism'],
      misconceptions: ['confusing mechanism with outcome'],
      failurePatterns: ['repeating the thesis without adding causal depth'],
    },
    operationalize: {
      nuance: ['name actors, triggers, handoffs, checks, and constraints', 'show sequencing rather than advice alone'],
      tradeoffs: ['governance versus speed', 'automation versus human judgment', 'standardization versus situational flexibility'],
      friction: ['handoff ambiguity', 'tooling constraints', 'approval bottlenecks', 'incentive misalignment'],
      stakeholders: ['operator executing the workflow', 'manager setting thresholds', 'reviewer validating output quality'],
      proof: ['use implementation behavior, constraints, and failure modes as proof'],
      workflow: ['specify decision points, review loops, ownership, and exception handling'],
      decisionImpact: ['make clear what the reader should decide, change, defer, or stop doing'],
      misconceptions: ['believing agreement with the idea equals implementation readiness'],
      failurePatterns: ['offering vague steps without workflow behavior or tradeoffs'],
    },
    validate: {
      nuance: ['define what evidence would be credible', 'qualify claims with constraints and scenario fit'],
      tradeoffs: ['confidence versus overclaiming', 'example specificity versus generalizability'],
      friction: ['missing baseline', 'unverified attribution', 'thin examples', 'unclear measurement boundary'],
      stakeholders: ['executive requiring confidence', 'operator collecting evidence', 'customer or reader testing credibility'],
      proof: ['connect claims to evidence type, scenario, constraint, or measurable behavior'],
      workflow: ['show how proof would be captured, checked, or interpreted'],
      decisionImpact: ['state what proof changes about commitment, investment, or sequencing'],
      misconceptions: ['treating assertions as proof'],
      failurePatterns: ['claiming authority without evidence boundaries'],
    },
    resolve: {
      nuance: ['synthesize the operating implication without opening new claims', 'make the before-after state memorable'],
      tradeoffs: ['concise synthesis versus mechanical recap', 'strategic closure versus promotional CTA'],
      friction: ['reader leaving with scattered takeaways', 'conclusion introducing unsupported ideas'],
      stakeholders: ['reader deciding what to carry forward', 'team aligning around the operating implication'],
      proof: ['reuse established proof rather than adding new evidence'],
      workflow: ['connect final implication to next operating behavior'],
      decisionImpact: ['state the durable decision principle created by the piece'],
      misconceptions: ['assuming summary is the same as resolution'],
      failurePatterns: ['ending with generic recap or new unsupported claims'],
    },
  };
  return behavior[stage];
}

function roleNuance(section: NarrativePlanningSection, guidance?: SectionGenerationGuidanceContract): string[] {
  return compact([
    section.sectionDepthExpectation,
    section.insightExpectation,
    guidance?.insightDepthExpectation || '',
    guidance?.argumentBoundary || '',
  ], 4);
}

function maturitySignals(maturityStage: EditorialMaturityStage): string[] {
  const signals: Record<EditorialMaturityStage, string[]> = {
    foundational: [
      'define operating concepts without assuming shared vocabulary',
      'avoid advanced claims unless the company context supports them',
    ],
    emerging: [
      'connect strategic claims to practical implications',
      'make assumptions explicit before prescribing workflow changes',
    ],
    operational: [
      'show workflow behavior, tradeoffs, decision rights, and quality checks',
      'use practitioner-level distinctions rather than beginner explanations',
    ],
    advanced: [
      'surface second-order consequences, governance tension, and proof boundaries',
      'write for operators who already know the category basics',
    ],
  };
  return signals[maturityStage];
}

function strategicTensions(
  doctrine: OmnivyraDoctrineGenerationContext,
  assimilation: AssimilatedEditorialPrimitives,
  section: NarrativePlanningSection,
): string[] {
  return compact([
    doctrine.strategicBeliefs[section.sectionIndex % Math.max(1, doctrine.strategicBeliefs.length)] || '',
    `Resolve tension between ${assimilation.buyerTension.statement} and ${assimilation.transformationMechanism.to}.`,
    `Pressure-test ${assimilation.differentiatorLogic.primary} against the section's ${section.progressionStage} responsibility.`,
  ], 4);
}

function beforeAfterTargets(assimilation: AssimilatedEditorialPrimitives, stage: NarrativeProgressionStage): string[] {
  return compact([
    `Before: ${assimilation.transformationMechanism.from}.`,
    `After: ${assimilation.transformationMechanism.to}.`,
    stage === 'resolve'
      ? `Use the final before-after state to clarify the operating implication: ${assimilation.transformationMechanism.mechanism}.`
      : `Connect the section to the transformation mechanism: ${assimilation.transformationMechanism.mechanism}.`,
  ], 3);
}

export function buildEditorialDepthIntelligence(input: {
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
}): EditorialDepthIntelligence {
  const { doctrine, assimilation, narrativePlanning, generationGuidance } = input;
  const maturityStage = inferMaturityStage(assimilation);
  const sections = narrativePlanning.sections.map((section): SectionEditorialDepthPrimitive => {
    const behavior = stageDepthBehavior(section.progressionStage);
    const guidance = generationGuidance.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      operationalNuanceTargets: compact([
        ...behavior.nuance,
        ...roleNuance(section, guidance),
      ], 5),
      tradeoffExpectations: compact([
        ...behavior.tradeoffs,
        assimilation.implementationPhilosophy[section.sectionIndex % Math.max(1, assimilation.implementationPhilosophy.length)] || '',
      ], 4),
      implementationFrictionSignals: compact([
        ...behavior.friction,
        assimilation.operatingPain.primary,
        ...assimilation.operatingPain.supporting,
      ], 5),
      stakeholderComplexitySignals: compact([
        ...behavior.stakeholders,
        assimilation.buyerTension.audience,
      ], 4),
      maturityStageSignals: maturitySignals(maturityStage),
      proofDepthExpectations: compact([
        ...behavior.proof,
        section.proofExpectation,
        guidance?.proofBehavior || '',
        ...assimilation.proofExpectations,
      ], 5),
      workflowRealismTargets: compact([
        ...behavior.workflow,
        `Treat ${assimilation.operatingPain.primary} as the operating constraint every recommendation must respect.`,
        ...assimilation.implementationPhilosophy,
        guidance?.allowedNarrativeMoves.join(', ') || '',
      ], 5),
      decisionImpactSignals: compact([
        ...behavior.decisionImpact,
        `Tie decisions back to ${assimilation.authorityClaim.claim}.`,
        section.readerStateShift.to,
      ], 4),
      misconceptionTargets: compact([
        ...behavior.misconceptions,
        ...doctrine.forbiddenGenericFraming.slice(0, 2).map((framing) => `Mistaking "${framing}" for editorial depth.`),
      ], 4),
      strategicTensionSignals: strategicTensions(doctrine, assimilation, section),
      beforeAfterStateTargets: beforeAfterTargets(assimilation, section.progressionStage),
      failurePatternTargets: compact([
        ...behavior.failurePatterns,
        guidance?.forbiddenNarrativeMoves[0] || '',
        guidance?.repetitionAvoidanceTargets[0] || '',
      ], 5),
    };
  });

  return deepFreeze({
    version: 'editorial-depth-intelligence-v1',
    topic: narrativePlanning.topic,
    contentType: narrativePlanning.contentType,
    maturityStage,
    globalDepthExpectations: [
      'Depth must come from operating nuance, tradeoffs, proof boundaries, and workflow realism.',
      'Every section should add a different kind of strategic or implementation depth.',
      'Avoid replacing maturity with longer prose, repeated frameworks, or generic best practices.',
      `Use ${assimilation.authorityClaim.claim} as the authority ceiling unless verified evidence supports more.`,
    ],
    sections,
  });
}

export function serializeEditorialDepthIntelligence(depth: EditorialDepthIntelligence): string {
  const sectionLines = depth.sections.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `nuance=${section.operationalNuanceTargets.slice(0, 2).join(' | ')}`,
    `tradeoffs=${section.tradeoffExpectations.slice(0, 2).join(' | ')}`,
    `friction=${section.implementationFrictionSignals.slice(0, 2).join(' | ')}`,
    `workflow=${section.workflowRealismTargets.slice(0, 2).join(' | ')}`,
    `tension=${section.strategicTensionSignals.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## EDITORIAL DEPTH INTELLIGENCE',
    `Version: ${depth.version}`,
    `Topic: ${depth.topic}`,
    `Content type: ${depth.contentType}`,
    `Maturity stage: ${depth.maturityStage}`,
    `Global depth expectations: ${depth.globalDepthExpectations.join('; ')}`,
    'Section depth primitives:',
    ...sectionLines,
  ].join('\n');
}
