/**
 * Phase 1 — Generation orchestration contract.
 *
 * Single canonical handoff package between the planner output and the
 * generation engine. Carries everything downstream needs to:
 *   • honor recommendation lineage,
 *   • preserve strategic narrative + operational framing,
 *   • respect mode constraints + avoid patterns,
 *   • surface upstream confidence + suitability,
 *   • reference the truncated planner-output digest.
 *
 * Two IDs:
 *   generationContractId — unique per orchestration call.
 *   generationLineageId  — stable per (recommendation, contentPlan) pair so
 *                          repeated orchestration attempts can be correlated.
 *
 * Deterministic; no LLM.
 */

import type {
  GenerationOrchestrationContract,
  LongFormPrimaryUse,
  LongFormRecommendation,
} from './longFormRecommendationTypes';
import type { ContentPlan } from '../../../lib/content/longFormPlanningEngine';
import type { EditorialContextBlock, PlanningInputPartial } from './longFormPlanningAdapter';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface BuildOrchestrationContractInput {
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  contentPlan: ContentPlan;
  /** Scores carried over from the handoff layer (or null when unknown). */
  upstream: {
    continuityScore: number;
    semanticContinuityScore: number;
    inheritanceCompletenessScore: number;
  };
  /** Override for `editorialContext` — defaults to `planningInput.editorialContext`. */
  editorialContext?: EditorialContextBlock;
}

export function buildGenerationOrchestrationContract(
  input: BuildOrchestrationContractInput,
): GenerationOrchestrationContract {
  const ctx = input.editorialContext ?? input.planningInput.editorialContext;
  const r = input.recommendation;

  const lineageBasis = `${r.recommendationId}|${input.contentPlan.title}|${input.contentPlan.sections.length}`;
  const generationLineageId = `gln_${stableHash(lineageBasis)}`;
  const generationContractId = `gco_${Date.now().toString(36)}_${stableHash(lineageBasis).slice(0, 8)}`;

  const primaryUse: LongFormPrimaryUse | null = r.suitability?.recommendedPrimaryUse ?? null;

  return {
    generationContractId,
    generationLineageId,
    recommendationId: r.recommendationId,
    companyId: r.lineageMetadata?.companyId ?? 'unknown',
    contentAlignmentMode: r.contentAlignmentMode,
    recommendedContentType: r.recommendedContentType,
    targetBuyerStage: r.targetBuyerStage,
    narrativeArchetype: r.narrativeArchetype ?? null,
    familyClusterId: r.familyClusterId ?? null,
    familyClusterLabel: r.familyClusterLabel ?? null,

    upstreamScoreSnapshot: {
      overallRecommendationStrength: r.overallRecommendationStrength,
      inheritanceCompletenessScore: input.upstream.inheritanceCompletenessScore,
      continuityScore: input.upstream.continuityScore,
      semanticContinuityScore: input.upstream.semanticContinuityScore,
      recommendationConfidenceScore: r.confidence?.recommendationConfidenceScore ?? 0,
      operationalDepthScore: r.operationalDepthScore,
      companyAlignmentScore: r.companyAlignmentScore,
      authorityBuildingScore: r.authorityBuildingScore,
    },
    recommendedPrimaryUse: primaryUse,
    hardRules: ctx?.hardRules ?? [],
    avoidPatterns: ctx?.recommendedContentDirection?.avoidPatterns
      ?? r.recommendedContentDirection.avoidPatterns,
    terminologyEmphasis: {
      domainVocabulary: ctx?.terminologyEmphasis?.domainVocabulary ?? [],
      strategicTerminology: ctx?.terminologyEmphasis?.strategicTerminology ?? [],
    },
    plannerDigest: {
      title: input.contentPlan.title,
      excerpt: input.contentPlan.excerpt,
      sectionCount: input.contentPlan.sections.length,
      sectionTitles: input.contentPlan.sections.map((s) => s.section_title).slice(0, 12),
      frameworkName: input.contentPlan.framework?.name ?? '',
      frameworkComponents: input.contentPlan.framework?.components ?? [],
      keyInsightCount: input.contentPlan.key_insights.length,
      faqCount: input.contentPlan.faq?.length ?? 0,
      evidencePlanCount: input.contentPlan.evidence_plan?.length ?? 0,
    },
    createdAt: new Date().toISOString(),
  };
}
