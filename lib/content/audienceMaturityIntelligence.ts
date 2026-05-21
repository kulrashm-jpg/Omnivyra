import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { EditorialAuthorityIntelligence } from './editorialAuthorityIntelligence';
import type { EditorialDepthIntelligence, EditorialMaturityStage } from './editorialDepthIntelligence';
import type { GenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export type AudienceSophisticationLevel =
  | 'foundational'
  | 'working'
  | 'practitioner'
  | 'executive-practitioner';

export interface SectionAudienceMaturityPrimitive {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  audienceSophisticationLevel: AudienceSophisticationLevel;
  operationalFamiliarityTargets: readonly string[];
  decisionMakerExpectations: readonly string[];
  knowledgeAssumptionBoundaries: readonly string[];
  terminologyComplexityTargets: readonly string[];
  strategicDepthTargets: readonly string[];
  implementationDetailExpectations: readonly string[];
  proofSophisticationTargets: readonly string[];
  objectionComplexityTargets: readonly string[];
  stakeholderAwarenessTargets: readonly string[];
  changeResistanceSignals: readonly string[];
  executiveVsOperatorBalance: readonly string[];
}

export interface AudienceMaturityIntelligence {
  version: 'audience-maturity-intelligence-v1';
  topic: string;
  contentType: string;
  audienceSophisticationLevel: AudienceSophisticationLevel;
  globalMaturityExpectations: readonly string[];
  sections: readonly SectionAudienceMaturityPrimitive[];
}

interface StageSophisticationBehavior {
  familiarity: readonly string[];
  decisionMakers: readonly string[];
  knowledgeBoundaries: readonly string[];
  terminology: readonly string[];
  strategicDepth: readonly string[];
  implementationDetail: readonly string[];
  proofSophistication: readonly string[];
  objections: readonly string[];
  stakeholders: readonly string[];
  resistance: readonly string[];
  balance: readonly string[];
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

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function compact(values: readonly string[], limit = 4): string[] {
  const seen = new Set<string>();
  return values
    .map(clean)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function sophisticationFromMaturity(maturityStage: EditorialMaturityStage): AudienceSophisticationLevel {
  const levels: Record<EditorialMaturityStage, AudienceSophisticationLevel> = {
    foundational: 'foundational',
    emerging: 'working',
    operational: 'practitioner',
    advanced: 'executive-practitioner',
  };
  return levels[maturityStage];
}

function stageSophisticationBehavior(stage: NarrativeProgressionStage): StageSophisticationBehavior {
  const behavior: Record<NarrativeProgressionStage, StageSophisticationBehavior> = {
    diagnose: {
      familiarity: ['assume the reader recognizes the surface problem but needs sharper operating diagnosis'],
      decisionMakers: ['calibrate to leaders and operators who need to know what is actually broken'],
      knowledgeBoundaries: ['do not over-explain the category; explain the hidden operating cause'],
      terminology: ['use precise operating language before specialized jargon'],
      strategicDepth: ['move from symptom awareness to system-level diagnosis'],
      implementationDetail: ['name where the problem appears in decisions, handoffs, or review loops'],
      proofSophistication: ['use realistic workflow pressure rather than abstract claims'],
      objections: ['address the objection that the problem is merely execution effort or content volume'],
      stakeholders: ['recognize operator pressure and leadership accountability together'],
      resistance: ['expect resistance from teams attached to familiar problem labels'],
      balance: ['operator-heavy diagnosis with executive-level stakes'],
    },
    reframe: {
      familiarity: ['assume the reader knows the common framing and needs a stronger interpretive lens'],
      decisionMakers: ['calibrate to decision makers choosing which belief will govern execution'],
      knowledgeBoundaries: ['avoid basic definitions unless they clarify the old assumption'],
      terminology: ['introduce company-native terms through contrast, not glossary-style explanation'],
      strategicDepth: ['show how the new frame changes priorities, tradeoffs, or investment logic'],
      implementationDetail: ['connect the reframe to a changed decision or sequencing behavior'],
      proofSophistication: ['make the strategic implication testable through contrast'],
      objections: ['address skepticism that the reframe is just positioning language'],
      stakeholders: ['show how leadership framing affects operator execution'],
      resistance: ['expect resistance from legacy assumptions and category habits'],
      balance: ['executive-heavy interpretation with operator consequences'],
    },
    expand: {
      familiarity: ['assume the reader can follow mechanism-level reasoning'],
      decisionMakers: ['calibrate to readers comparing causes, mechanisms, and implications'],
      knowledgeBoundaries: ['skip beginner overview and clarify only concepts that affect judgment'],
      terminology: ['use technical or strategic terms when they improve precision'],
      strategicDepth: ['add causal logic, distinction, and second-order consequence'],
      implementationDetail: ['connect mechanism to judgment, review, or planning behavior'],
      proofSophistication: ['prefer bounded examples and causal logic over broad claims'],
      objections: ['address the objection that the mechanism is too abstract to affect execution'],
      stakeholders: ['recognize analyst, operator, and manager interpretation needs'],
      resistance: ['expect resistance when complexity challenges simple benefit narratives'],
      balance: ['balanced strategic mechanism and operator interpretation'],
    },
    operationalize: {
      familiarity: ['assume the reader needs practitioner-level specificity, not motivation'],
      decisionMakers: ['calibrate to operators, managers, and owners of workflow change'],
      knowledgeBoundaries: ['do not explain why implementation matters; explain what implementation changes'],
      terminology: ['use workflow terms such as owner, threshold, handoff, review, exception, and constraint'],
      strategicDepth: ['show tradeoffs between governance, speed, judgment, and standardization'],
      implementationDetail: ['name actors, sequencing, checks, failure modes, and decision rights'],
      proofSophistication: ['make proof visible through implementation behavior'],
      objections: ['address adoption friction, ownership ambiguity, and workflow cost'],
      stakeholders: ['include operator, manager, reviewer, and executive sponsor implications'],
      resistance: ['expect resistance from process drag, unclear ownership, and incentive mismatch'],
      balance: ['operator-heavy detail with executive decision relevance'],
    },
    validate: {
      familiarity: ['assume the reader expects evidence boundaries and credible proof behavior'],
      decisionMakers: ['calibrate to executives and practitioners deciding whether to trust the recommendation'],
      knowledgeBoundaries: ['do not re-teach the argument; clarify what can and cannot be proven'],
      terminology: ['use evidence terms precisely: signal, inference, scenario, constraint, baseline, outcome'],
      strategicDepth: ['show what proof changes about confidence, timing, or investment'],
      implementationDetail: ['explain how proof would be captured, checked, or interpreted'],
      proofSophistication: ['distinguish sourced facts, observed patterns, examples, and company POV'],
      objections: ['address unsupported claims, weak examples, and missing measurement boundaries'],
      stakeholders: ['include executive confidence and operator evidence collection needs'],
      resistance: ['expect resistance from teams asked to trust claims without proof'],
      balance: ['executive confidence with operator evidence mechanics'],
    },
    resolve: {
      familiarity: ['assume the reader has followed the argument and needs disciplined synthesis'],
      decisionMakers: ['calibrate to the final decision principle the reader should carry forward'],
      knowledgeBoundaries: ['do not introduce new definitions, frameworks, or unexplained claims'],
      terminology: ['use concise operating language rather than recap-heavy phrasing'],
      strategicDepth: ['convert the argument into a durable operating implication'],
      implementationDetail: ['connect the implication to the next credible behavior without over-prescribing'],
      proofSophistication: ['reuse established proof rather than adding new authority signals'],
      objections: ['address the risk that synthesis becomes generic recap'],
      stakeholders: ['show what executives and operators should each understand by the end'],
      resistance: ['expect resistance to carrying the implication into actual operating choices'],
      balance: ['executive-level synthesis grounded in operator reality'],
    },
  };
  return behavior[stage];
}

function levelExpectations(level: AudienceSophisticationLevel): string[] {
  const expectations: Record<AudienceSophisticationLevel, string[]> = {
    foundational: [
      'make core operating concepts explicit',
      'avoid assuming category fluency or advanced proof literacy',
    ],
    working: [
      'assume basic category awareness but clarify operational consequences',
      'avoid both beginner filler and unsupported executive abstraction',
    ],
    practitioner: [
      'assume workflow familiarity and require implementation nuance',
      'use practitioner-grade tradeoffs, constraints, and proof boundaries',
    ],
    'executive-practitioner': [
      'assume category fluency and strategic accountability',
      'combine executive decision impact with operator-level realism',
    ],
  };
  return expectations[level];
}

function doctrineCalibration(doctrine: OmnivyraDoctrineGenerationContext): string[] {
  return compact([
    doctrine.strategicBeliefs[0] ? `Calibrate sophistication around doctrine belief: ${doctrine.strategicBeliefs[0]}` : '',
    doctrine.approvedPovArchetypes[0] ? `Prefer ${doctrine.approvedPovArchetypes[0].label} over generic audience education.` : '',
    doctrine.forbiddenGenericFraming[0] ? `Avoid maturity collapse into framing like: ${doctrine.forbiddenGenericFraming[0]}` : '',
  ], 3);
}

function executiveOperatorBalance(
  level: AudienceSophisticationLevel,
  stage: NarrativeProgressionStage,
  behavior: StageSophisticationBehavior,
): string[] {
  const base = level === 'executive-practitioner'
    ? 'lead with strategic consequence, then prove operational feasibility'
    : level === 'practitioner'
      ? 'lead with operational reality, then connect to strategic consequence'
      : 'make the operating concept clear before adding decision-level abstraction';
  return compact([
    base,
    ...behavior.balance,
    stage === 'validate' ? 'raise executive confidence without hiding evidence limits' : '',
  ], 3);
}

export function buildAudienceMaturityIntelligence(input: {
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
  editorialDepth: EditorialDepthIntelligence;
  editorialAuthority: EditorialAuthorityIntelligence;
}): AudienceMaturityIntelligence {
  const { doctrine, assimilation, narrativePlanning, generationGuidance, editorialDepth, editorialAuthority } = input;
  const audienceSophisticationLevel = sophisticationFromMaturity(editorialAuthority.maturityStage);
  const globalLevelExpectations = levelExpectations(audienceSophisticationLevel);
  const globalDoctrineCalibration = doctrineCalibration(doctrine);
  const sections = narrativePlanning.sections.map((section): SectionAudienceMaturityPrimitive => {
    const behavior = stageSophisticationBehavior(section.progressionStage);
    const guidance = generationGuidance.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const depthSection = editorialDepth.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const authoritySection = editorialAuthority.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      audienceSophisticationLevel,
      operationalFamiliarityTargets: compact([
        ...behavior.familiarity,
        `${assimilation.buyerTension.audience} should be treated as familiar with ${assimilation.marketPositioning.category} pressures.`,
        ...(depthSection?.workflowRealismTargets || []),
      ], 5),
      decisionMakerExpectations: compact([
        ...behavior.decisionMakers,
        `Decision context: ${assimilation.buyerTension.statement}`,
        ...(authoritySection?.trustBuildingSignals || []),
      ], 4),
      knowledgeAssumptionBoundaries: compact([
        ...behavior.knowledgeBoundaries,
        ...globalLevelExpectations,
        guidance?.argumentBoundary || '',
      ], 5),
      terminologyComplexityTargets: compact([
        ...behavior.terminology,
        `Use company-native language around ${assimilation.differentiatorLogic.primary}.`,
        ...globalDoctrineCalibration,
      ], 5),
      strategicDepthTargets: compact([
        ...behavior.strategicDepth,
        ...(depthSection?.strategicTensionSignals || []),
        guidance?.insightDepthExpectation || '',
      ], 5),
      implementationDetailExpectations: compact([
        ...behavior.implementationDetail,
        ...(depthSection?.operationalNuanceTargets || []),
        ...(depthSection?.workflowRealismTargets || []),
      ], 5),
      proofSophisticationTargets: compact([
        ...behavior.proofSophistication,
        ...(authoritySection?.evidenceDepthExpectations || []),
        ...(authoritySection?.claimQualificationTargets || []),
      ], 5),
      objectionComplexityTargets: compact([
        ...behavior.objections,
        ...(authoritySection?.authorityRiskSignals || []),
      ], 4),
      stakeholderAwarenessTargets: compact([
        ...behavior.stakeholders,
        ...(depthSection?.stakeholderComplexitySignals || []),
      ], 5),
      changeResistanceSignals: compact([
        ...behavior.resistance,
        ...(depthSection?.implementationFrictionSignals || []),
        ...(authoritySection?.operationalCredibilitySignals || []),
      ], 5),
      executiveVsOperatorBalance: executiveOperatorBalance(
        audienceSophisticationLevel,
        section.progressionStage,
        behavior,
      ),
    };
  });

  return deepFreeze({
    version: 'audience-maturity-intelligence-v1',
    topic: narrativePlanning.topic,
    contentType: narrativePlanning.contentType,
    audienceSophisticationLevel,
    globalMaturityExpectations: [
      ...globalLevelExpectations,
      ...globalDoctrineCalibration,
      `Primary audience calibration: ${assimilation.buyerTension.audience}.`,
    ],
    sections,
  });
}

export function serializeAudienceMaturityIntelligence(maturity: AudienceMaturityIntelligence): string {
  const sectionLines = maturity.sections.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `level=${section.audienceSophisticationLevel}`,
    `familiarity=${section.operationalFamiliarityTargets.slice(0, 2).join(' | ')}`,
    `knowledge=${section.knowledgeAssumptionBoundaries.slice(0, 2).join(' | ')}`,
    `decision=${section.decisionMakerExpectations.slice(0, 2).join(' | ')}`,
    `balance=${section.executiveVsOperatorBalance.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## AUDIENCE MATURITY INTELLIGENCE',
    `Version: ${maturity.version}`,
    `Topic: ${maturity.topic}`,
    `Content type: ${maturity.contentType}`,
    `Audience sophistication level: ${maturity.audienceSophisticationLevel}`,
    `Global maturity expectations: ${maturity.globalMaturityExpectations.join('; ')}`,
    'Section maturity primitives:',
    ...sectionLines,
  ].join('\n');
}
