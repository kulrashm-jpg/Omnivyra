import type { EditorialRuntimeContext } from './editorialRuntimeContextPrioritizer';
import type { GeneratorRuntimeAlignment, SectionRuntimeObjective } from './generatorRuntimeAlignment';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { UnifiedEditorialBrief } from './unifiedEditorialBriefAssembler';

export interface SectionBehavioralPriority {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  primaryBehavior: string;
  behavioralPriorities: readonly string[];
  narrativeBehaviorSignals: readonly string[];
  authorityBehaviorSignals: readonly string[];
  depthBehaviorSignals: readonly string[];
  audienceBehaviorSignals: readonly string[];
  transitionBehaviorSignals: readonly string[];
  antiRepetitionBehaviorSignals: readonly string[];
  claimQualificationBehaviorSignals: readonly string[];
  operationalRealismBehaviorSignals: readonly string[];
  strategicTensionBehaviorSignals: readonly string[];
  readerStateBehaviorSignals: readonly string[];
}

export interface GeneratorBehavioralSteering {
  version: 'generator-behavioral-steering-v1';
  topic: string;
  contentType: string;
  sectionBehavioralPriorities: readonly SectionBehavioralPriority[];
  narrativeBehaviorSignals: readonly string[];
  authorityBehaviorSignals: readonly string[];
  depthBehaviorSignals: readonly string[];
  audienceBehaviorSignals: readonly string[];
  transitionBehaviorSignals: readonly string[];
  antiRepetitionBehaviorSignals: readonly string[];
  claimQualificationBehaviorSignals: readonly string[];
  operationalRealismBehaviorSignals: readonly string[];
  strategicTensionBehaviorSignals: readonly string[];
  readerStateBehaviorSignals: readonly string[];
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

function stageBehavior(stage: NarrativeProgressionStage): string {
  const behavior: Record<NarrativeProgressionStage, string> = {
    diagnose: 'diagnose the operating tension before offering solutions',
    reframe: 'replace the default assumption with a sharper company-conditioned interpretation',
    expand: 'develop mechanism, distinctions, and implications without repeating the reframe',
    operationalize: 'translate the argument into decisions, workflow, checks, tradeoffs, and constraints',
    validate: 'qualify claims through proof boundaries, scenarios, constraints, and evidence behavior',
    resolve: 'synthesize the operating implication without adding new claims',
  };
  return behavior[stage];
}

function sectionBehavioralPriorities(
  section: SectionRuntimeObjective,
  briefSection: UnifiedEditorialBrief['sections'][number] | undefined,
): string[] {
  return compact([
    stageBehavior(section.progressionStage),
    `complete objective: ${section.runtimeObjective}`,
    `move reader state: ${section.readerStateTarget}`,
    `differentiate through: ${section.differentiationTarget}`,
    briefSection?.sectionAudienceExpectation[0] || '',
  ], 5);
}

export function buildGeneratorBehavioralSteering(input: {
  generatorRuntimeAlignment: GeneratorRuntimeAlignment;
  editorialRuntimeContext: EditorialRuntimeContext;
  unifiedEditorialBrief: UnifiedEditorialBrief;
}): GeneratorBehavioralSteering {
  const { generatorRuntimeAlignment, editorialRuntimeContext, unifiedEditorialBrief } = input;
  const sectionBehavioralPrioritiesOutput = generatorRuntimeAlignment.sectionRuntimeObjectives.map((section): SectionBehavioralPriority => {
    const briefSection = unifiedEditorialBrief.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      primaryBehavior: stageBehavior(section.progressionStage),
      behavioralPriorities: sectionBehavioralPriorities(section, briefSection),
      narrativeBehaviorSignals: compact([
        stageBehavior(section.progressionStage),
        section.runtimeObjective,
        ...(briefSection?.sectionNarrativeExpectation || []),
      ], 5),
      authorityBehaviorSignals: compact([
        ...section.authorityTarget,
        ...(briefSection?.sectionAuthorityExpectation || []),
      ], 5),
      depthBehaviorSignals: compact([
        ...section.depthTarget,
        ...(briefSection?.sectionDepthExpectation || []),
      ], 5),
      audienceBehaviorSignals: compact([
        ...(briefSection?.sectionAudienceExpectation || []),
        ...(briefSection?.sectionTerminologyGuidance || []),
      ], 5),
      transitionBehaviorSignals: compact([
        section.transitionTarget,
        briefSection?.sectionTransitionExpectation || '',
      ], 3),
      antiRepetitionBehaviorSignals: compact(section.antiRepetitionSignals, 5),
      claimQualificationBehaviorSignals: compact([
        ...section.claimQualificationTarget,
        ...(briefSection?.sectionClaimQualificationGuidance || []),
      ], 5),
      operationalRealismBehaviorSignals: compact([
        ...(briefSection?.sectionOperationalExpectation || []),
        ...section.depthTarget,
      ], 5),
      strategicTensionBehaviorSignals: compact(briefSection?.sectionStrategicTension || [], 5),
      readerStateBehaviorSignals: compact([
        section.readerStateTarget,
        `do not leave the section before this shift is visible: ${section.readerStateTarget}`,
      ], 2),
    };
  });

  return deepFreeze({
    version: 'generator-behavioral-steering-v1',
    topic: generatorRuntimeAlignment.topic,
    contentType: generatorRuntimeAlignment.contentType,
    sectionBehavioralPriorities: sectionBehavioralPrioritiesOutput,
    narrativeBehaviorSignals: compact([
      ...generatorRuntimeAlignment.runtimeNarrativeSequence,
      ...sectionBehavioralPrioritiesOutput.map((section) => section.primaryBehavior),
    ], 12),
    authorityBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.authorityBehaviorSignals), 12),
    depthBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.depthBehaviorSignals), 12),
    audienceBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.audienceBehaviorSignals), 12),
    transitionBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.transitionBehaviorSignals), 12),
    antiRepetitionBehaviorSignals: compact([
      ...generatorRuntimeAlignment.runtimeAntiRepetitionSignals,
      ...sectionBehavioralPrioritiesOutput.flatMap((section) => section.antiRepetitionBehaviorSignals),
    ], 12),
    claimQualificationBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.claimQualificationBehaviorSignals), 12),
    operationalRealismBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.operationalRealismBehaviorSignals), 12),
    strategicTensionBehaviorSignals: compact(sectionBehavioralPrioritiesOutput.flatMap((section) => section.strategicTensionBehaviorSignals), 12),
    readerStateBehaviorSignals: compact([
      ...generatorRuntimeAlignment.runtimeReaderStateTargets,
      ...editorialRuntimeContext.primaryEditorialSignals.filter((signal) => signal.startsWith('Reader-state targets:')),
    ], 12),
  });
}

export function serializeGeneratorBehavioralSteering(steering: GeneratorBehavioralSteering): string {
  const sectionLines = steering.sectionBehavioralPriorities.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `primary=${section.primaryBehavior}`,
    `priorities=${section.behavioralPriorities.slice(0, 3).join(' | ')}`,
    `authority=${section.authorityBehaviorSignals.slice(0, 2).join(' | ')}`,
    `realism=${section.operationalRealismBehaviorSignals.slice(0, 2).join(' | ')}`,
    `avoid=${section.antiRepetitionBehaviorSignals.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## GENERATOR BEHAVIORAL STEERING',
    `Version: ${steering.version}`,
    `Topic: ${steering.topic}`,
    `Content type: ${steering.contentType}`,
    `Narrative behavior signals: ${steering.narrativeBehaviorSignals.slice(0, 8).join('; ')}`,
    `Authority behavior signals: ${steering.authorityBehaviorSignals.slice(0, 6).join('; ')}`,
    `Depth behavior signals: ${steering.depthBehaviorSignals.slice(0, 6).join('; ')}`,
    `Anti-repetition behavior signals: ${steering.antiRepetitionBehaviorSignals.slice(0, 8).join('; ')}`,
    `Reader-state behavior signals: ${steering.readerStateBehaviorSignals.slice(0, 6).join('; ')}`,
    'Section behavioral priorities:',
    ...sectionLines,
  ].join('\n');
}
