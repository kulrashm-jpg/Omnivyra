/**
 * Phase 1 — Section generation contract builder.
 *
 * Each section-level generation call gets a focused contract derived from the
 * upstream GenerationOrchestrationContract + ContentPlan. The contract makes
 * the section generator's job mechanical: every field it should honor is
 * already attached, with thresholds for downstream validation.
 *
 * IDs:
 *   sectionContractId         — unique per attempt (regeneration gets a new id)
 *   sectionLineageId          — stable per (generationLineage, sectionIndex)
 *   parentGenerationLineageId — points back to GenerationOrchestrationContract.generationLineageId
 */

import type { ContentPlan, ContentPlanSection } from '../../../lib/content/longFormPlanningEngine';
import type {
  EvidenceRequirements,
  GenerationOrchestrationContract,
  GroundedGenerationConstraints,
  LongFormRecommendation,
  SectionGenerationContract,
} from './longFormRecommendationTypes';
import type { EditorialContextBlock, PlanningInputPartial } from './longFormPlanningAdapter';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const DEFAULT_THRESHOLDS = {
  sectionContinuityFloor: 60,
  strategicIntegrityFloor: 55,
  operationalIntegrityFloor: 55,
  genericityCeiling: 35,
} as const;

const DEFAULT_EVIDENCE_REQUIREMENTS: EvidenceRequirements = {
  allowedEvidenceTypes: ['realistic_example', 'named_workflow', 'attributed_quote', 'verifiable_metric'],
  forbiddenClaimPatterns: [
    'fabricated statistics ("X% of teams" without attribution)',
    'invented customer names with savings figures',
    'unverifiable benchmark comparisons',
    'fake research firm citations',
    'unsupported industry-consensus appeals',
  ],
  speculativeLanguagePolicy: 'balanced',
  claimSensitivityProfile: 'standard',
};

const DEFAULT_GROUNDED_CONSTRAINTS: GroundedGenerationConstraints = {
  allowedSourceIds: [],
  mandatoryEvidenceAnchors: [],
  citationRequirements: 'preferred',
  sourceTrustThresholds: {
    minimumTrustScoreForCitation: 55,
    minimumTrustScoreForFactualClaim: 45,
  },
  unsupportedClaimEscalationPolicy: 'soften',
};

export interface BuildSectionContractInput {
  generationContract: GenerationOrchestrationContract;
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  contentPlan: ContentPlan;
  sectionIndex: number;
  /** Summaries of sections already generated, for cross-section coherence checks. */
  priorSectionSummaries: Array<{ title: string; summary: string }>;
  /** Optional override of continuity thresholds. */
  continuityThresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
  /** Optional override of the editorial context (defaults to planningInput.editorialContext). */
  editorialContext?: EditorialContextBlock;
  /** Optional attempt counter (1 for first attempt, ≥2 for regenerations). */
  attemptNumber?: number;
  /** Optional override of evidence requirements (defaults to balanced/standard). */
  evidenceRequirements?: Partial<EvidenceRequirements>;
  /** Optional override of grounded generation constraints (defaults to preferred/soften). */
  groundedConstraints?: Partial<GroundedGenerationConstraints>;
  /**
   * Phase 3.2 — Canonical CompanyIdentity (from `extractCompanyIdentity`).
   * When provided, the section generator prepends the identity lock and
   * anti-generic rules to its system prompt.
   */
  companyIdentity?: unknown | null;
  /**
   * Phase 3.5 — Per-section strategic assignment bundle from Phase 2.7.
   * When provided, the assignment is rendered into the section prompt
   * and post-validated by `validateStrategicAssignmentConsumption`.
   */
  strategicAssignment?: SectionGenerationContract['strategicAssignment'] | null;
}

export function buildSectionGenerationContract(input: BuildSectionContractInput): SectionGenerationContract {
  const section: ContentPlanSection | undefined = input.contentPlan.sections[input.sectionIndex];
  if (!section) {
    throw new Error(`buildSectionGenerationContract: section index ${input.sectionIndex} out of range (plan has ${input.contentPlan.sections.length}).`);
  }

  const ctx = input.editorialContext ?? input.planningInput.editorialContext;
  const lineageBasis = `${input.generationContract.generationLineageId}|${input.sectionIndex}|${section.section_title}`;
  const attemptSuffix = input.attemptNumber && input.attemptNumber > 1 ? `_a${input.attemptNumber}` : '';

  return {
    sectionContractId: `sco_${Date.now().toString(36)}_${stableHash(lineageBasis).slice(0, 8)}${attemptSuffix}`,
    sectionLineageId: `sln_${stableHash(lineageBasis)}`,
    parentGenerationLineageId: input.generationContract.generationLineageId,
    generationContractId: input.generationContract.generationContractId,
    recommendationId: input.recommendation.recommendationId,

    sectionIndex: input.sectionIndex,
    sectionTitle: section.section_title,
    sectionGoal: section.section_goal,
    uniqueAngle: section.unique_angle,
    keyPoints: Array.from(section.key_points ?? []),
    contentType: String(section.content_type ?? 'explanation'),
    depthRequirement: section.depth_requirement,
    wordTarget: section.word_target ?? 350,
    requiresDirectAnswer: Boolean(section.requires_direct_answer),
    requiresOpinionatedInsight: Boolean(section.requires_opinionated_insight),
    frameworkRole: (section.framework_role ?? 'none') as SectionGenerationContract['frameworkRole'],
    targetEntities: Array.from(section.target_entities ?? []),
    frameworkName: input.contentPlan.framework?.name ?? '',
    frameworkComponents: Array.from(input.contentPlan.framework?.components ?? []),

    contentAlignmentMode: input.generationContract.contentAlignmentMode,
    targetBuyerStage: input.generationContract.targetBuyerStage,
    narrativeArchetype: input.generationContract.narrativeArchetype,
    strategicNarrative: input.recommendation.strategicNarrative,
    editorialAngle: input.recommendation.editorialAngle,
    icpFraming: {
      market: ctx?.icpContext?.market ?? null,
      icps: Array.from(ctx?.icpContext?.icps ?? []),
      painPoints: Array.from(ctx?.icpContext?.painPoints ?? []),
      icpProblemMapping: input.recommendation.whyThisFitsCompany.icpProblemMapping,
    },
    capabilityEmphasis: {
      primaryCapability: input.recommendation.whyThisFitsCompany.capabilityConnection,
      workflowCategory: ctx?.capabilityEmphasis?.workflowCategory ?? null,
    },
    terminologyEmphasis: {
      domainVocabulary: Array.from(input.generationContract.terminologyEmphasis.domainVocabulary),
      strategicTerminology: Array.from(input.generationContract.terminologyEmphasis.strategicTerminology),
    },
    avoidPatterns: Array.from(input.generationContract.avoidPatterns),
    hardRules: Array.from(input.generationContract.hardRules),

    priorSectionSummaries: input.priorSectionSummaries.slice(-5),

    continuityThresholds: {
      ...DEFAULT_THRESHOLDS,
      ...(input.continuityThresholds ?? {}),
    },
    evidenceRequirements: {
      ...DEFAULT_EVIDENCE_REQUIREMENTS,
      ...(input.evidenceRequirements ?? {}),
    },
    groundedConstraints: {
      ...DEFAULT_GROUNDED_CONSTRAINTS,
      ...(input.groundedConstraints ?? {}),
      sourceTrustThresholds: {
        ...DEFAULT_GROUNDED_CONSTRAINTS.sourceTrustThresholds,
        ...(input.groundedConstraints?.sourceTrustThresholds ?? {}),
      },
    },
    // Phase 3.2 — Identity pass-through (null when caller omitted).
    companyIdentity: input.companyIdentity ?? null,
    // Phase 3.5 — Per-section assignment pass-through.
    strategicAssignment: input.strategicAssignment ?? null,
  };
}

export {
  DEFAULT_THRESHOLDS as DEFAULT_SECTION_CONTINUITY_THRESHOLDS,
  DEFAULT_EVIDENCE_REQUIREMENTS,
  DEFAULT_GROUNDED_CONSTRAINTS,
};
