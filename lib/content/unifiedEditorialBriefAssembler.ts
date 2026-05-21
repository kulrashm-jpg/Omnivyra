import type { AssimilatedEditorialPrimitives } from './companyAssimilationMiddleware';
import type { AudienceMaturityIntelligence } from './audienceMaturityIntelligence';
import type { EditorialAuthorityIntelligence } from './editorialAuthorityIntelligence';
import type { EditorialDepthIntelligence } from './editorialDepthIntelligence';
import type { GenerationGuidanceContract } from './generationGuidanceContracts';
import type { NarrativePlanningOutput, NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';
import type { OmnivyraDoctrineGenerationContext } from './omnivyraEditorialDoctrine';

export interface SectionUnifiedEditorialBrief {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  sectionEditorialObjective: string;
  sectionNarrativeExpectation: readonly string[];
  sectionDepthExpectation: readonly string[];
  sectionAuthorityExpectation: readonly string[];
  sectionAudienceExpectation: readonly string[];
  sectionOperationalExpectation: readonly string[];
  sectionProofExpectation: readonly string[];
  sectionTransitionExpectation: string;
  sectionDifferentiationExpectation: string;
  sectionRiskFlags: readonly string[];
  sectionReaderStateTarget: string;
  sectionStrategicTension: readonly string[];
  sectionTerminologyGuidance: readonly string[];
  sectionClaimQualificationGuidance: readonly string[];
}

export interface UnifiedEditorialBrief {
  version: 'unified-editorial-brief-v1';
  topic: string;
  contentType: string;
  sectionCount: number;
  progressionStages: readonly NarrativeProgressionStage[];
  globalBriefPriorities: readonly string[];
  antiRepetitionRules: readonly string[];
  sections: readonly SectionUnifiedEditorialBrief[];
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

function compact(values: readonly string[], limit = 4): string[] {
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

function firstClean(values: readonly string[], fallback: string): string {
  return compact(values, 1)[0] || fallback;
}

function priorityList(values: readonly string[], limit = 4): string[] {
  return compact(values, limit);
}

export function assembleUnifiedEditorialBrief(input: {
  doctrine: OmnivyraDoctrineGenerationContext;
  assimilation: AssimilatedEditorialPrimitives;
  narrativePlanning: NarrativePlanningOutput;
  generationGuidance: GenerationGuidanceContract;
  editorialDepth: EditorialDepthIntelligence;
  editorialAuthority: EditorialAuthorityIntelligence;
  audienceMaturity: AudienceMaturityIntelligence;
}): UnifiedEditorialBrief {
  const {
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  } = input;

  const sections = narrativePlanning.sections.map((section): SectionUnifiedEditorialBrief => {
    const guidance = generationGuidance.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const depth = editorialDepth.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const authority = editorialAuthority.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);
    const maturity = audienceMaturity.sections.find((candidate) => candidate.sectionIndex === section.sectionIndex);

    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      sectionEditorialObjective: firstClean([
        guidance?.sectionGenerationIntent || '',
        section.sectionPurpose,
        section.editorialIntent,
      ], section.sectionPurpose),
      sectionNarrativeExpectation: priorityList([
        section.argumentMovement,
        section.insightExpectation,
        ...(guidance?.allowedNarrativeMoves || []),
      ], 4),
      sectionDepthExpectation: priorityList([
        section.sectionDepthExpectation,
        ...(depth?.operationalNuanceTargets || []),
        ...(depth?.strategicTensionSignals || []),
      ], 4),
      sectionAuthorityExpectation: priorityList([
        ...(authority?.authoritySignalTargets || []),
        ...(authority?.trustBuildingSignals || []),
      ], 4),
      sectionAudienceExpectation: priorityList([
        ...(maturity?.executiveVsOperatorBalance || []),
        ...(maturity?.knowledgeAssumptionBoundaries || []),
      ], 4),
      sectionOperationalExpectation: priorityList([
        ...(depth?.workflowRealismTargets || []),
        ...(depth?.implementationFrictionSignals || []),
        ...(maturity?.implementationDetailExpectations || []),
      ], 5),
      sectionProofExpectation: priorityList([
        section.proofExpectation,
        guidance?.proofBehavior || '',
        ...(authority?.evidenceExpectations || []),
        ...(authority?.proofTypePreferences || []),
      ], 5),
      sectionTransitionExpectation: firstClean([
        guidance?.transitionBehavior || '',
        section.transitionObjective,
      ], section.transitionObjective),
      sectionDifferentiationExpectation: firstClean([
        guidance?.sectionDifferentiationRule || '',
        assimilation.differentiatorLogic.logic,
      ], assimilation.differentiatorLogic.logic),
      sectionRiskFlags: priorityList([
        section.redundancyBoundary,
        ...(guidance?.forbiddenNarrativeMoves || []),
        ...(guidance?.repetitionAvoidanceTargets || []),
        ...(authority?.authorityRiskSignals || []),
        ...(maturity?.objectionComplexityTargets || []),
      ], 6),
      sectionReaderStateTarget: `${section.readerStateShift.from} -> ${section.readerStateShift.to}`,
      sectionStrategicTension: priorityList([
        ...(depth?.strategicTensionSignals || []),
        doctrine.strategicBeliefs[section.sectionIndex % Math.max(1, doctrine.strategicBeliefs.length)] || '',
      ], 4),
      sectionTerminologyGuidance: priorityList([
        ...(maturity?.terminologyComplexityTargets || []),
        `Prefer terminology around ${assimilation.differentiatorLogic.primary}.`,
      ], 4),
      sectionClaimQualificationGuidance: priorityList([
        ...(authority?.claimQualificationTargets || []),
        ...(authority?.citationBehaviorTargets || []),
      ], 5),
    };
  });

  return deepFreeze({
    version: 'unified-editorial-brief-v1',
    topic: narrativePlanning.topic,
    contentType: narrativePlanning.contentType,
    sectionCount: sections.length,
    progressionStages: narrativePlanning.progressionStages,
    globalBriefPriorities: [
      'Follow section-level objectives before expanding supporting context.',
      'Preserve narrative progression and reader-state movement across sections.',
      'Use depth, authority, and maturity signals as calibration, not extra prose.',
      `Anchor differentiation in ${assimilation.differentiatorLogic.primary}.`,
    ],
    antiRepetitionRules: narrativePlanning.antiRepetitionRules,
    sections,
  });
}

export function serializeUnifiedEditorialBrief(brief: UnifiedEditorialBrief): string {
  const sectionLines = brief.sections.map((section) => [
    `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}`,
    `objective=${section.sectionEditorialObjective}`,
    `reader=${section.sectionReaderStateTarget}`,
    `depth=${section.sectionDepthExpectation.slice(0, 2).join(' | ')}`,
    `authority=${section.sectionAuthorityExpectation.slice(0, 2).join(' | ')}`,
    `audience=${section.sectionAudienceExpectation.slice(0, 2).join(' | ')}`,
    `risk=${section.sectionRiskFlags.slice(0, 2).join(' | ')}`,
  ].join(' :: '));

  return [
    '## UNIFIED EDITORIAL BRIEF',
    `Version: ${brief.version}`,
    `Topic: ${brief.topic}`,
    `Content type: ${brief.contentType}`,
    `Progression stages: ${brief.progressionStages.join(' -> ')}`,
    `Global priorities: ${brief.globalBriefPriorities.join('; ')}`,
    `Anti-repetition rules: ${brief.antiRepetitionRules.join('; ')}`,
    'Section briefs:',
    ...sectionLines,
  ].join('\n');
}
