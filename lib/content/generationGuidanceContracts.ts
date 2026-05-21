import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export interface SectionGenerationGuidanceContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  sectionGenerationIntent: string;
  allowedNarrativeMoves: readonly string[];
  forbiddenNarrativeMoves: readonly string[];
  readerAwarenessTarget: string;
  insightDepthExpectation: string;
  proofBehavior: string;
  transitionBehavior: string;
  toneExpectation: string;
  repetitionAvoidanceTargets: readonly string[];
  argumentBoundary: string;
  sectionDifferentiationRule: string;
}

export interface GenerationGuidanceContract {
  version: 'generation-guidance-contract-v1';
  topic: string;
  contentType: string;
  sections: readonly SectionGenerationGuidanceContract[];
  globalForbiddenNarrativeMoves: readonly string[];
  globalRepetitionAvoidanceTargets: readonly string[];
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

function stageAllowedMoves(stage: NarrativeProgressionStage): string[] {
  const moves: Record<NarrativeProgressionStage, string[]> = {
    diagnose: ['name the operating tension', 'show the hidden cause', 'connect stakes to the reader situation'],
    reframe: ['challenge the default assumption', 'introduce the company-conditioned lens', 'contrast old interpretation with better logic'],
    expand: ['explain the mechanism', 'separate concepts that are often blurred', 'show second-order implications'],
    operationalize: ['translate the idea into decisions', 'name workflow changes', 'surface tradeoffs and sequencing'],
    validate: ['connect claims to proof expectations', 'show credible scenarios or constraints', 'qualify unsupported claims'],
    resolve: ['synthesize the argument', 'state the operating implication', 'close without introducing a new framework'],
  };
  return moves[stage];
}

function stageForbiddenMoves(stage: NarrativeProgressionStage): string[] {
  const moves: Record<NarrativeProgressionStage, string[]> = {
    diagnose: ['open with generic market scenery', 'solve the problem before diagnosing it', 'use SEO definition filler as the main move'],
    reframe: ['repeat the diagnosis', 'introduce a second unrelated framework', 'stay neutral when a POV is required'],
    expand: ['restate the thesis without adding mechanism', 'turn the section into another benefits list', 'duplicate the reframe section'],
    operationalize: ['offer vague advice without workflow behavior', 'repeat direct-answer formatting as a crutch', 'avoid tradeoffs'],
    validate: ['invent studies or metrics', 'claim proof without constraints', 'repeat examples from operational sections'],
    resolve: ['summarize mechanically', 'add new unsupported claims', 'end with a generic CTA'],
  };
  return moves[stage];
}

function toneForStage(stage: NarrativeProgressionStage, doctrine: OmnivyraDoctrineGenerationContext): string {
  const posture = doctrine.strategicBeliefs[1] || 'make the operating belief visible';
  const tones: Record<NarrativeProgressionStage, string> = {
    diagnose: `direct and diagnostic; ${posture}`,
    reframe: 'opinionated, contrastive, and evidence-aware',
    expand: 'analytical, precise, and mechanism-led',
    operationalize: 'practitioner-aware and workflow-specific',
    validate: 'careful, proof-aware, and constraint-conscious',
    resolve: 'decisive, synthetic, and non-promotional',
  };
  return tones[stage];
}

function buildRepetitionTargets(section: NarrativePlanningSection, plan: NarrativePlanningOutput): string[] {
  const adjacent = plan.sections
    .filter((candidate) => Math.abs(candidate.sectionIndex - section.sectionIndex) === 1)
    .map((candidate) => `${candidate.progressionStage}:${candidate.narrativeRole}`);
  return [
    section.redundancyBoundary,
    `Do not repeat role ${section.narrativeRole} as a primary move.`,
    `Do not mimic adjacent section roles: ${adjacent.join(', ') || 'none'}.`,
    'Do not reuse the same direct-answer shape unless it advances this section stage.',
  ];
}

export function buildGenerationGuidanceContract(input: {
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
}): GenerationGuidanceContract {
  const { doctrine, assimilation, narrativePlanning } = input;
  const companyPovAngles = assimilation.approvedPovAngles;
  const sections = narrativePlanning.sections.map((section): SectionGenerationGuidanceContract => {
    const povAngle = companyPovAngles[section.sectionIndex % Math.max(1, companyPovAngles.length)];
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      sectionGenerationIntent: section.sectionPurpose,
      allowedNarrativeMoves: stageAllowedMoves(section.progressionStage),
      forbiddenNarrativeMoves: [
        ...stageForbiddenMoves(section.progressionStage),
        ...doctrine.forbiddenGenericFraming.slice(0, 3).map((phrase) => `avoid phrase/framing: ${phrase}`),
      ],
      readerAwarenessTarget: `${section.readerStateShift.from} -> ${section.readerStateShift.to}`,
      insightDepthExpectation: section.insightExpectation,
      proofBehavior: `${section.proofExpectation} Strategic proof anchor: ${assimilation.proofExpectations[0] || 'qualify unsupported claims'}.`,
      transitionBehavior: section.transitionObjective,
      toneExpectation: toneForStage(section.progressionStage, doctrine),
      repetitionAvoidanceTargets: buildRepetitionTargets(section, narrativePlanning),
      argumentBoundary: `Stay inside ${section.progressionStage}/${section.narrativeRole}; do not perform the next section's job.`,
      sectionDifferentiationRule: povAngle
        ? `Differentiate this section through ${povAngle.angle}; rationale: ${povAngle.rationale}`
        : 'Differentiate this section through its assigned narrative role and reader-state shift.',
    };
  });

  return deepFreeze({
    version: 'generation-guidance-contract-v1',
    topic: narrativePlanning.topic,
    contentType: narrativePlanning.contentType,
    sections,
    globalForbiddenNarrativeMoves: [
      ...doctrine.forbiddenGenericFraming.slice(0, 8).map((phrase) => `generic framing: ${phrase}`),
      'collapsing multiple narrative stages into one generic overview',
      'repeating the same framework explanation across sections',
      'using neutral SEO prose when the section requires company POV',
    ],
    globalRepetitionAvoidanceTargets: narrativePlanning.antiRepetitionRules,
  });
}

export function serializeGenerationGuidanceContract(contract: GenerationGuidanceContract): string {
  const sectionLines = contract.sections.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `intent=${section.sectionGenerationIntent}`,
    `reader=${section.readerAwarenessTarget}`,
    `allowed=${section.allowedNarrativeMoves.join(', ')}`,
    `forbidden=${section.forbiddenNarrativeMoves.slice(0, 4).join(', ')}`,
    `avoid=${section.repetitionAvoidanceTargets.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## GENERATOR GUIDANCE CONTRACT',
    `Version: ${contract.version}`,
    `Topic: ${contract.topic}`,
    `Content type: ${contract.contentType}`,
    `Global forbidden moves: ${contract.globalForbiddenNarrativeMoves.slice(0, 6).join('; ')}`,
    `Global repetition targets: ${contract.globalRepetitionAvoidanceTargets.join('; ')}`,
    'Section contracts:',
    ...sectionLines,
  ].join('\n');
}

