import { generateCampaignPlanAI } from '../aiPlanningService';
import { parseAndValidateCampaignPlan } from '../campaignPlanCore';
import { validatePlanAgainstSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';
import {
  ALIGNMENT_ACCEPT_THRESHOLD,
  evaluateWeeklyAlignment,
} from '../campaign-ai/campaignAiAlignmentHelpers';
import { canonicalJsonStringify } from '../viralitySnapshotBuilder';
import { normalizeStructuredPlanForOutput } from './structuredPlanTransforms';

interface AlignmentRecoveryArgs {
  structured: any;
  alignmentResult: any;
  alignmentScoreForDebug: number | null;
  planningInput: Record<string, unknown>;
  companyId: string;
  campaignId: string;
  recommendationContext: any;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  fastPath?: boolean;
  planSkeleton: any;
  /** Caller AbortSignal propagated to both the regeneration LLM call and the
   * post-regen alignment re-evaluation so the full alignment budget can
   * cancel everything in flight. */
  signal?: AbortSignal;
}

export async function recoverLowAlignmentPlan({
  structured,
  alignmentResult,
  alignmentScoreForDebug,
  planningInput,
  companyId,
  campaignId,
  recommendationContext,
  campaignStage,
  psychologicalGoal,
  momentum,
  fastPath,
  planSkeleton,
  signal,
}: AlignmentRecoveryArgs): Promise<{
  structured: any;
  alignmentResult: any;
  alignmentScoreForDebug: number | null;
  regenerationTriggered: boolean;
}> {
  if (
    fastPath ||
    !alignmentResult ||
    alignmentResult.alignmentScore >= ALIGNMENT_ACCEPT_THRESHOLD ||
    !planSkeleton
  ) {
    return {
      structured,
      alignmentResult,
      alignmentScoreForDebug,
      regenerationTriggered: false,
    };
  }

  const regenInstruction =
    'Alignment score is below threshold. Improve intelligence fields only based on issues below.\n' +
    'Do NOT change week count or required deliverable quantities.\n' +
    `Issues: ${alignmentResult.issues.join('; ') || 'General alignment improvement required'}\n` +
    `Suggested adjustments: ${canonicalJsonStringify(alignmentResult.suggestedAdjustments)}\n` +
    `Skeleton JSON:\n${canonicalJsonStringify(planSkeleton)}`;

  try {
    const regenInput = {
      ...planningInput,
      repair_instruction: regenInstruction,
    };
    // Alignment recovery is a full draft regeneration but it lives inside
    // the alignment phase budget. Route to the `alignment` pool so it shares
    // concurrency with scoring rather than starving primary drafting calls.
    const { rawOutput: regeneratedRaw } = await generateCampaignPlanAI(regenInput as any, { signal, pool: 'alignment' });
    let regeneratedStructured = await parseAndValidateCampaignPlan({
      companyId,
      rawOutput: regeneratedRaw,
    });
    const regenValidation = validatePlanAgainstSkeleton(regeneratedStructured, planSkeleton);
    if (regenValidation.ok) {
      regeneratedStructured = normalizeStructuredPlanForOutput({
        structured: regeneratedStructured as any,
        planSkeleton,
      }) as any;
      try {
        const regeneratedAlignment = await evaluateWeeklyAlignment({
          campaignId,
          recommendationContext,
          campaignStage: campaignStage ?? null,
          psychologicalGoal: psychologicalGoal ?? null,
          momentum: momentum ?? null,
          normalizedWeeks: regeneratedStructured.weeks || [],
          signal,
          pool: 'alignment',
        });
        if (regeneratedAlignment.alignmentScore >= (alignmentResult?.alignmentScore ?? 0)) {
          return {
            structured: regeneratedStructured,
            alignmentResult: regeneratedAlignment,
            alignmentScoreForDebug: regeneratedAlignment.alignmentScore,
            regenerationTriggered: true,
          };
        }
      } catch (reEvalErr) {
        console.warn('Regenerated alignment evaluation failed, keeping best available plan:', reEvalErr);
      }
    }
  } catch (regenErr) {
    console.warn('Alignment regeneration failed, accepting best available plan:', regenErr);
  }

  return {
    structured,
    alignmentResult,
    alignmentScoreForDebug,
    regenerationTriggered: true,
  };
}
