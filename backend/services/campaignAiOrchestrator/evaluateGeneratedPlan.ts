import { validateCampaignPlan } from '../../lib/validation/campaignValidator';
import { generatePaidRecommendation } from '../../lib/ads/paidAmplificationEngine';

export async function evaluateGeneratedPlan(args: {
  input: any;
  result: any;
  prefilledPlanning: Record<string, unknown>;
  resolvedDurationWeeks: number;
  deterministicSkeleton: any;
}) {
  const { input, result, prefilledPlanning, resolvedDurationWeeks, deterministicSkeleton } = args;

  let campaign_validation: any = null;
  if (input.mode === 'generate_plan' && Array.isArray(result.plan?.weeks) && result.plan!.weeks.length > 0) {
    try {
      const pcr = (prefilledPlanning as any)?.platform_content_requests;
      const platformsForValidation: string[] = Array.isArray(pcr)
        ? [...new Set((pcr as any[]).map((r: any) => String(r?.platform ?? '')).filter(Boolean))]
        : typeof pcr === 'object' && pcr !== null
          ? Object.keys(pcr).filter(Boolean)
          : (prefilledPlanning as any)?.platforms ?? [];
      const postingFreqForValidation: Record<string, number> = {};
      for (const p of platformsForValidation) postingFreqForValidation[p] = 3;
      const rawFreq = (prefilledPlanning as any)?.posting_frequency;
      const effectiveFreq =
        rawFreq && typeof rawFreq === 'object' && !Array.isArray(rawFreq)
          ? (rawFreq as Record<string, number>)
          : postingFreqForValidation;

      campaign_validation = validateCampaignPlan({
        plan: result.plan!,
        strategy_context: {
          duration_weeks: resolvedDurationWeeks,
          platforms: platformsForValidation,
          posting_frequency: effectiveFreq,
          content_mix: (prefilledPlanning as any)?.content_mix ?? null,
          campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
          target_audience: (prefilledPlanning as any)?.target_audience ?? null,
        },
        account_context: input.account_context ?? null,
        execution_items: deterministicSkeleton?.execution_items ?? null,
      });
    } catch (validationErr) {
      console.warn('[PLANNER][VALIDATION][WARN] Non-fatal: validation failed:', validationErr);
    }
  }

  let paid_recommendation: any = null;
  if (campaign_validation) {
    try {
      const platformsForPaid: string[] = Array.isArray(campaign_validation)
        ? []
        : ((prefilledPlanning as any)?.platforms ?? []);
      paid_recommendation = generatePaidRecommendation({
        plan: result.plan!,
        campaign_validation,
        account_context: input.account_context ?? null,
        strategy_context: {
          duration_weeks: resolvedDurationWeeks,
          platforms: platformsForPaid,
          posting_frequency: (prefilledPlanning as any)?.posting_frequency ?? {},
          campaign_goal: (prefilledPlanning as any)?.campaign_goal ?? null,
        },
      });
    } catch (paidErr) {
      console.warn('[PLANNER][ADS][WARN] Non-fatal: paid amplification engine failed:', paidErr);
    }
  }

  return {
    campaign_validation,
    paid_recommendation,
  };
}
