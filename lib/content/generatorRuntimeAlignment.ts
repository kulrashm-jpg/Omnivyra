import type { EditorialRuntimeContext } from './editorialRuntimeContextPrioritizer';
import type { GenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { UnifiedEditorialBrief } from './unifiedEditorialBriefAssembler';

export interface SectionRuntimeObjective {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeObjective: string;
  readerStateTarget: string;
  differentiationTarget: string;
  authorityTarget: readonly string[];
  depthTarget: readonly string[];
  transitionTarget: string;
  claimQualificationTarget: readonly string[];
  riskAwarenessSignals: readonly string[];
  antiRepetitionSignals: readonly string[];
}

export interface GeneratorRuntimeAlignment {
  version: 'generator-runtime-alignment-v1';
  topic: string;
  contentType: string;
  runtimeGenerationDirectives: readonly string[];
  sectionRuntimeObjectives: readonly SectionRuntimeObjective[];
  runtimeNarrativeSequence: readonly string[];
  runtimeReaderStateTargets: readonly string[];
  runtimeDifferentiationTargets: readonly string[];
  runtimeAuthorityTargets: readonly string[];
  runtimeDepthTargets: readonly string[];
  runtimeTransitionTargets: readonly string[];
  runtimeClaimQualificationTargets: readonly string[];
  runtimeRiskAwarenessSignals: readonly string[];
  runtimeAntiRepetitionSignals: readonly string[];
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

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(values: readonly string[], limit = 8): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    const key = normalizeKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

export function buildGeneratorRuntimeAlignment(input: {
  editorialRuntimeContext: EditorialRuntimeContext;
  unifiedEditorialBrief: UnifiedEditorialBrief;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
}): GeneratorRuntimeAlignment {
  const {
    editorialRuntimeContext,
    unifiedEditorialBrief,
    narrativePlanning,
    generationGuidance,
  } = input;

  const sectionRuntimeObjectives = unifiedEditorialBrief.sections.map((section): SectionRuntimeObjective => {
    const guidance = generationGuidance.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const antiRepetitionSignals = compact([
      ...section.sectionRiskFlags,
      ...(guidance?.repetitionAvoidanceTargets || []),
      section.sectionTransitionExpectation,
    ], 6);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      runtimeObjective: section.sectionEditorialObjective,
      readerStateTarget: section.sectionReaderStateTarget,
      differentiationTarget: section.sectionDifferentiationExpectation,
      authorityTarget: compact(section.sectionAuthorityExpectation, 4),
      depthTarget: compact([
        ...section.sectionDepthExpectation,
        ...section.sectionOperationalExpectation,
      ], 5),
      transitionTarget: section.sectionTransitionExpectation,
      claimQualificationTarget: compact(section.sectionClaimQualificationGuidance, 4),
      riskAwarenessSignals: compact(section.sectionRiskFlags, 5),
      antiRepetitionSignals,
    };
  });

  return deepFreeze({
    version: 'generator-runtime-alignment-v1',
    topic: unifiedEditorialBrief.topic,
    contentType: unifiedEditorialBrief.contentType,
    runtimeGenerationDirectives: compact([
      'Treat the unified editorial brief as the operational generation plan for section behavior.',
      'Follow each section runtime objective before expanding supporting context.',
      'Preserve narrative order, reader-state movement, and section differentiation.',
      'Use authority, depth, maturity, and claim-qualification targets as generation constraints.',
      ...editorialRuntimeContext.primaryEditorialSignals,
    ], 8),
    sectionRuntimeObjectives,
    runtimeNarrativeSequence: unifiedEditorialBrief.sections.map((section) => `${section.progressionStage}/${section.narrativeRole}`),
    runtimeReaderStateTargets: sectionRuntimeObjectives.map((section) => section.readerStateTarget),
    runtimeDifferentiationTargets: compact(sectionRuntimeObjectives.map((section) => section.differentiationTarget), 10),
    runtimeAuthorityTargets: compact(sectionRuntimeObjectives.flatMap((section) => section.authorityTarget), 10),
    runtimeDepthTargets: compact(sectionRuntimeObjectives.flatMap((section) => section.depthTarget), 10),
    runtimeTransitionTargets: compact(sectionRuntimeObjectives.map((section) => section.transitionTarget), 10),
    runtimeClaimQualificationTargets: compact(sectionRuntimeObjectives.flatMap((section) => section.claimQualificationTarget), 10),
    runtimeRiskAwarenessSignals: compact(sectionRuntimeObjectives.flatMap((section) => section.riskAwarenessSignals), 12),
    runtimeAntiRepetitionSignals: compact([
      ...narrativePlanning.antiRepetitionRules,
      ...sectionRuntimeObjectives.flatMap((section) => section.antiRepetitionSignals),
    ], 12),
  });
}

export function serializeGeneratorRuntimeAlignment(alignment: GeneratorRuntimeAlignment): string {
  const sectionLines = alignment.sectionRuntimeObjectives.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `objective=${section.runtimeObjective}`,
    `reader=${section.readerStateTarget}`,
    `differentiate=${section.differentiationTarget}`,
    `authority=${section.authorityTarget.slice(0, 2).join(' | ')}`,
    `depth=${section.depthTarget.slice(0, 2).join(' | ')}`,
    `avoid=${section.antiRepetitionSignals.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## GENERATOR RUNTIME DIRECTIVES',
    `Version: ${alignment.version}`,
    `Topic: ${alignment.topic}`,
    `Content type: ${alignment.contentType}`,
    `Runtime generation directives: ${alignment.runtimeGenerationDirectives.join('; ')}`,
    `Runtime narrative sequence: ${alignment.runtimeNarrativeSequence.join(' -> ')}`,
    `Runtime anti-repetition signals: ${alignment.runtimeAntiRepetitionSignals.slice(0, 8).join('; ')}`,
    `Runtime claim qualification targets: ${alignment.runtimeClaimQualificationTargets.slice(0, 6).join('; ')}`,
    'Section runtime objectives:',
    ...sectionLines,
  ].join('\n');
}
