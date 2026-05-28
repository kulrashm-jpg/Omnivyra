/**
 * Phase 5 — Generation continuity validation.
 *
 * Before the long-form planner / generator runs, validate that the planning
 * input still carries the recommendation's strategic intent. This catches
 * cases where:
 *   • The user edited the topic but stripped the editorial angle.
 *   • A downstream caller forgot to attach editorialContext.
 *   • The mode was changed in flight.
 *   • Operational proof / avoidPatterns were dropped.
 *
 * Three strictness modes:
 *   • warn       — return validation result; caller decides.
 *   • strict     — recommend 'reject' on any break.
 *   • regenerate — recommend 'regenerate' (force planner to rebuild input).
 */

import type {
  ContinuityBreakReason,
  ContinuityValidatorStrictness,
  GenerationContinuityValidation,
  LongFormRecommendation,
} from './longFormRecommendationTypes';
import type {
  EditorialContextBlock,
  PlanningInputPartial,
} from './longFormPlanningAdapter';
import { detectNarrativeArchetype } from './recommendationFamilyClustering';

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsKeyTokens(haystack: string, needle: string, minOverlap = 0.4): boolean {
  if (!needle.trim()) return true;
  const hayTokens = new Set(normalizeForCompare(haystack).split(' ').filter((t) => t.length > 3));
  const needleTokens = normalizeForCompare(needle).split(' ').filter((t) => t.length > 3);
  if (needleTokens.length === 0) return true;
  const hits = needleTokens.filter((t) => hayTokens.has(t)).length;
  return hits / needleTokens.length >= minOverlap;
}

/**
 * Validate continuity between a source recommendation and the planning input
 * that should descend from it. Pass `editorialContext` if you stored it on
 * the planning input as a separate field; otherwise the validator falls back
 * to inferring continuity from `intent`, `seoContext`, and `topic`.
 */
export function validateGenerationContinuity(input: {
  recommendation: LongFormRecommendation;
  planningInput: PlanningInputPartial;
  editorialContext?: EditorialContextBlock;
  strictness?: ContinuityValidatorStrictness;
}): GenerationContinuityValidation {
  const { recommendation, planningInput, editorialContext } = input;
  const strictness = input.strictness ?? 'warn';
  const ctx = editorialContext ?? planningInput.editorialContext;

  const breaks: Array<{ reason: ContinuityBreakReason; detail: string }> = [];

  // 1. Editorial angle preservation.
  const angleSurface = [planningInput.intent, ctx?.editorialAngle ?? '', planningInput.seoContext].join(' ');
  if (!containsKeyTokens(angleSurface, recommendation.editorialAngle, 0.35)) {
    breaks.push({
      reason: 'EDITORIAL_ANGLE_DRIFT',
      detail: 'Planning input does not preserve enough tokens from the recommendation editorialAngle.',
    });
  }

  // 2. Strategic narrative preservation.
  if (recommendation.strategicNarrative.trim().length >= 40) {
    const narrSurface = [ctx?.strategicNarrative ?? '', planningInput.seoContext, planningInput.intent].join(' ');
    if (!containsKeyTokens(narrSurface, recommendation.strategicNarrative, 0.25)) {
      breaks.push({
        reason: 'STRATEGIC_NARRATIVE_DROPPED',
        detail: 'strategicNarrative tokens missing from planning input.',
      });
    }
  }

  // 3. ICP mapping preservation.
  const icp = recommendation.whyThisFitsCompany.icpProblemMapping;
  if (icp.trim().length >= 20) {
    const icpSurface = [
      ctx?.whyThisFitsCompany?.icpProblemMapping ?? '',
      planningInput.seoContext,
      planningInput.topic,
    ].join(' ');
    if (!containsKeyTokens(icpSurface, icp, 0.30)) {
      breaks.push({
        reason: 'ICP_MAPPING_LOST',
        detail: 'ICP problem mapping no longer surfaced in topic/seoContext/editorialContext.',
      });
    }
  }

  // 4. Capability emphasis preservation.
  const capability = recommendation.whyThisFitsCompany.capabilityConnection;
  if (capability.trim().length >= 15) {
    const capSurface = [
      ctx?.whyThisFitsCompany?.capabilityConnection ?? '',
      planningInput.topic,
      planningInput.intent,
    ].join(' ');
    if (!containsKeyTokens(capSurface, capability, 0.30)) {
      breaks.push({
        reason: 'CAPABILITY_EMPHASIS_LOST',
        detail: 'Capability connection tokens absent from planning input.',
      });
    }
  }

  // 5. Mode preservation.
  if (ctx && ctx.alignmentMode && ctx.alignmentMode !== recommendation.contentAlignmentMode) {
    breaks.push({
      reason: 'MODE_MISMATCH',
      detail: `Recommendation mode=${recommendation.contentAlignmentMode}; planning input mode=${ctx.alignmentMode}.`,
    });
  }

  // 6. Narrative family preservation. Re-detect archetype from the planning
  // input's intent/topic — if it has drifted, flag it.
  if (recommendation.narrativeArchetype && recommendation.narrativeArchetype !== 'uncategorized') {
    const probeRecommendation = {
      recommendationTitle: planningInput.topic,
      editorialAngle: planningInput.intent,
      strategicNarrative: ctx?.strategicNarrative ?? '',
      recommendedContentDirection: ctx?.recommendedContentDirection ?? { primaryAngle: '', operationalProof: [], avoidPatterns: [] },
    };
    const newArchetype = detectNarrativeArchetype(probeRecommendation);
    if (newArchetype !== 'uncategorized' && newArchetype !== recommendation.narrativeArchetype) {
      breaks.push({
        reason: 'NARRATIVE_FAMILY_CHANGED',
        detail: `Archetype changed from ${recommendation.narrativeArchetype} → ${newArchetype}.`,
      });
    }
  }

  // 7. Operational proof preservation.
  if (recommendation.recommendedContentDirection.operationalProof.length > 0) {
    const proofPreserved = ctx?.recommendedContentDirection?.operationalProof?.length ?? 0;
    if (proofPreserved === 0) {
      breaks.push({
        reason: 'OPERATIONAL_PROOF_STRIPPED',
        detail: 'editorialContext.recommendedContentDirection.operationalProof is empty though recommendation had proof items.',
      });
    }
  }

  // 8. Avoid patterns preservation.
  if (recommendation.recommendedContentDirection.avoidPatterns.length > 0) {
    const avoidPreserved = ctx?.recommendedContentDirection?.avoidPatterns?.length ?? 0;
    if (avoidPreserved === 0) {
      breaks.push({
        reason: 'AVOID_PATTERNS_DROPPED',
        detail: 'editorialContext.recommendedContentDirection.avoidPatterns is empty.',
      });
    }
  }

  // Continuity score: start at 100, subtract 15 per major break, floor at 0.
  const continuityScore = Math.max(0, 100 - breaks.length * 15);
  const passed = breaks.length === 0;
  const recommendedAction: GenerationContinuityValidation['recommendedAction'] =
    passed ? 'accept'
    : strictness === 'strict' ? 'reject'
    : strictness === 'regenerate' ? 'regenerate'
    : 'accept';

  return {
    continuityScore,
    passed,
    continuityBreakReasons: breaks,
    recommendedAction,
  };
}
