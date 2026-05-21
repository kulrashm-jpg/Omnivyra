import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export type NarrativeProgressionStage =
  | 'diagnose'
  | 'reframe'
  | 'expand'
  | 'operationalize'
  | 'validate'
  | 'resolve';

export type NarrativeRole =
  | 'problem_diagnosis'
  | 'belief_reframe'
  | 'concept_expansion'
  | 'operating_translation'
  | 'proof_validation'
  | 'strategic_resolution';

export interface NarrativePlanningSection {
  sectionIndex: number;
  sectionPurpose: string;
  narrativeRole: NarrativeRole;
  editorialIntent: string;
  progressionStage: NarrativeProgressionStage;
  insightExpectation: string;
  proofExpectation: string;
  transitionObjective: string;
  redundancyBoundary: string;
  readerStateShift: {
    from: string;
    to: string;
  };
  argumentMovement: string;
  sectionDepthExpectation: string;
}

export interface NarrativePlanningInput {
  topic: string;
  contentType?: string;
  searchIntent?: string | null;
  keywords?: readonly string[];
  seoContext?: string | null;
  doctrine?: OmnivyraDoctrineGenerationContext;
  assimilation?: AssimilatedEditorialPrimitives;
  sectionCount?: number;
}

export interface NarrativePlanningOutput {
  version: 'narrative-planning-v1';
  topic: string;
  contentType: string;
  sectionCount: number;
  progressionStages: readonly NarrativeProgressionStage[];
  sections: readonly NarrativePlanningSection[];
  antiRepetitionRules: readonly string[];
}

const STAGE_SEQUENCE: readonly NarrativeProgressionStage[] = [
  'diagnose',
  'reframe',
  'expand',
  'operationalize',
  'validate',
  'resolve',
];

const ROLE_BY_STAGE: Record<NarrativeProgressionStage, NarrativeRole> = {
  diagnose: 'problem_diagnosis',
  reframe: 'belief_reframe',
  expand: 'concept_expansion',
  operationalize: 'operating_translation',
  validate: 'proof_validation',
  resolve: 'strategic_resolution',
};

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

function clean(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function clampSectionCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(3, Math.min(6, Math.round(numeric)));
}

function selectStages(sectionCount: number): NarrativeProgressionStage[] {
  if (sectionCount <= 3) return ['diagnose', 'reframe', 'operationalize'];
  if (sectionCount === 4) return ['diagnose', 'reframe', 'operationalize', 'resolve'];
  if (sectionCount === 5) return ['diagnose', 'reframe', 'expand', 'operationalize', 'resolve'];
  return [...STAGE_SEQUENCE];
}

function stageReaderShift(stage: NarrativeProgressionStage, topic: string): NarrativePlanningSection['readerStateShift'] {
  const shifts: Record<NarrativeProgressionStage, NarrativePlanningSection['readerStateShift']> = {
    diagnose: {
      from: `recognizing ${topic} as a topic`,
      to: `understanding the operating tension behind ${topic}`,
    },
    reframe: {
      from: 'accepting the default category explanation',
      to: 'seeing the more useful company-conditioned lens',
    },
    expand: {
      from: 'knowing the main claim',
      to: 'understanding the mechanisms and implications behind it',
    },
    operationalize: {
      from: 'agreeing with the idea',
      to: 'knowing how it changes decisions, workflow, and execution',
    },
    validate: {
      from: 'believing the recommendation may be useful',
      to: 'seeing what proof, constraints, or examples make it credible',
    },
    resolve: {
      from: 'holding individual takeaways',
      to: 'leaving with a clear strategic operating implication',
    },
  };
  return shifts[stage];
}

function stageIntent(stage: NarrativeProgressionStage, topic: string, assimilation?: AssimilatedEditorialPrimitives): string {
  const pain = assimilation?.operatingPain.primary || `the core operating problem behind ${topic}`;
  const differentiator = assimilation?.differentiatorLogic.primary || 'a more governed operating approach';
  const authority = assimilation?.authorityClaim.claim || 'the authority basis behind the recommendation';
  const intents: Record<NarrativeProgressionStage, string> = {
    diagnose: `Expose why ${pain} makes ${topic} strategically consequential.`,
    reframe: `Replace the default framing with ${differentiator}.`,
    expand: `Develop the mechanism, distinctions, and implications behind the reframe.`,
    operationalize: 'Translate the argument into decisions, workflow changes, checks, and tradeoffs.',
    validate: `Support the argument with ${authority}, examples, constraints, or proof expectations.`,
    resolve: 'Synthesize the narrative into a durable strategic implication without repeating prior sections.',
  };
  return intents[stage];
}

function insightExpectation(stage: NarrativeProgressionStage, doctrine?: OmnivyraDoctrineGenerationContext): string {
  const belief = doctrine?.strategicBeliefs?.[0] || 'generic output is usually caused by weak upstream thinking';
  const expectations: Record<NarrativeProgressionStage, string> = {
    diagnose: 'Identify the hidden operating cause, not just the visible symptom.',
    reframe: `Use a company POV to challenge the default assumption: ${belief}.`,
    expand: 'Add a mechanism, distinction, or consequence that was not already covered.',
    operationalize: 'Make the insight actionable through a decision or workflow change.',
    validate: 'Clarify what would make the claim believable, limited, or testable.',
    resolve: 'Convert the argument into a memorable operating principle.',
  };
  return expectations[stage];
}

function proofExpectation(stage: NarrativeProgressionStage, assimilation?: AssimilatedEditorialPrimitives): string {
  const proof = assimilation?.proofExpectations?.[0] || 'Use a concrete scenario when verified data is unavailable.';
  const expectations: Record<NarrativeProgressionStage, string> = {
    diagnose: 'Show the pain through a credible workflow pressure or decision failure.',
    reframe: 'Use contrast against the default assumption rather than another definition.',
    expand: 'Use mechanisms, distinctions, or examples instead of restating benefits.',
    operationalize: 'Name actors, constraints, decisions, checks, or failure modes.',
    validate: proof,
    resolve: 'Do not introduce new unsupported claims; synthesize the proof already established.',
  };
  return expectations[stage];
}

function depthExpectation(stage: NarrativeProgressionStage): string {
  const expectations: Record<NarrativeProgressionStage, string> = {
    diagnose: 'Depth comes from specificity of the problem, stakes, and operating context.',
    reframe: 'Depth comes from contrast, strategic belief, and changed interpretation.',
    expand: 'Depth comes from mechanism, distinctions, and second-order consequences.',
    operationalize: 'Depth comes from implementation nuance, tradeoffs, and sequencing.',
    validate: 'Depth comes from proof mechanics, examples, caveats, and constraints.',
    resolve: 'Depth comes from synthesis, not recap.',
  };
  return expectations[stage];
}

export function buildNarrativePlanningPrimitives(input: NarrativePlanningInput): NarrativePlanningOutput {
  const topic = clean(input.topic, 'the topic');
  const contentType = clean(input.contentType, 'blog');
  const sectionCount = clampSectionCount(input.sectionCount);
  const stages = selectStages(sectionCount);
  const companyAngles = input.assimilation?.approvedPovAngles || [];

  const sections = stages.map((stage, index): NarrativePlanningSection => {
    const nextStage = stages[index + 1];
    const role = ROLE_BY_STAGE[stage];
    const angle = companyAngles[index % Math.max(1, companyAngles.length)];
    return {
      sectionIndex: index,
      sectionPurpose: stageIntent(stage, topic, input.assimilation),
      narrativeRole: role,
      editorialIntent: angle
        ? `${angle.angle}. ${angle.rationale}`
        : stageIntent(stage, topic, input.assimilation),
      progressionStage: stage,
      insightExpectation: insightExpectation(stage, input.doctrine),
      proofExpectation: proofExpectation(stage, input.assimilation),
      transitionObjective: nextStage
        ? `Move the reader from ${stage} into ${nextStage} without restating this section's core claim.`
        : 'Close the argument without opening a new loop.',
      redundancyBoundary:
        `Do not reuse the ${role} job, the same direct-answer pattern, or the same framework explanation in any other section.`,
      readerStateShift: stageReaderShift(stage, topic),
      argumentMovement:
        index === 0
          ? `Start with the operating tension behind ${topic}.`
          : `Build on the prior stage by adding ${stage} responsibility, not another overview.`,
      sectionDepthExpectation: depthExpectation(stage),
    };
  });

  return deepFreeze({
    version: 'narrative-planning-v1',
    topic,
    contentType,
    sectionCount: sections.length,
    progressionStages: stages,
    sections,
    antiRepetitionRules: [
      'Each section owns one narrative role and must not perform another section role as its primary job.',
      'Direct-answer blocks may appear only when they advance the assigned narrative stage.',
      'Do not repeat the same framework explanation across diagnose, reframe, and operationalize stages.',
      'Adjacent sections must shift reader state rather than restating the same benefit.',
      'Examples, proof, and implications must not be recycled across sections with different wording.',
    ],
  });
}

