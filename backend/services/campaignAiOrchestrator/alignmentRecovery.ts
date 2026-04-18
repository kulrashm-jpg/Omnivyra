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
    const { rawOutput: regeneratedRaw } = await generateCampaignPlanAI(regenInput as any);
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
