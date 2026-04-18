import { saveStructuredCampaignPlan } from '../../db/campaignPlanStore';
import { evaluateAndPersistCampaignHealth } from '../../jobs/campaignHealthEvaluationJob';
import { adjustCampaignMomentum, recoverNarrativeMomentum } from '../momentumAdjustmentService';
import { refineLanguageOutput } from '../languageRefinementService';

interface PostProcessGeneratedPlanArgs {
  structured: any;
  campaignId: string;
  snapshotHash: string;
  omnivyreDecision: any;
  rawPlanText: string;
  distributionStrategy?: string;
  distributionReason?: string;
  validationResult?: any;
  effectivePrefilledPlanning: Record<string, unknown> | null | undefined;
  prefilledPlanning: any;
  strategyMemory?: { preferred_tone?: string | null } | null;
  companyId?: string | null;
}

export async function postProcessGeneratedPlan({
  structured,
  campaignId,
  snapshotHash,
  omnivyreDecision,
  rawPlanText,
  distributionStrategy,
  distributionReason,
  validationResult,
  effectivePrefilledPlanning,
  prefilledPlanning,
  strategyMemory,
  companyId,
}: PostProcessGeneratedPlanArgs): Promise<any> {
  const strategy = distributionStrategy ?? 'AI_OPTIMIZED';
  const reason = distributionReason ?? undefined;
  const planningAdjustmentReason = validationResult?.planning_adjustment_reason ?? undefined;
  const planningAdjustmentsSummary = validationResult?.planning_adjustments_summary ?? undefined;
  let weeks = structured.weeks.map((w: any) => ({
    ...w,
    distribution_strategy: w.distribution_strategy ?? strategy,
    ...(reason != null ? { distribution_reason: w.distribution_reason ?? reason } : {}),
    ...(planningAdjustmentReason != null
      ? { planning_adjustment_reason: w.planning_adjustment_reason ?? planningAdjustmentReason }
      : {}),
    ...(planningAdjustmentsSummary != null
      ? { planning_adjustments_summary: w.planning_adjustments_summary ?? planningAdjustmentsSummary }
      : {}),
  }));
  weeks = adjustCampaignMomentum({ weeks, validation_result: validationResult });
  structured = { ...structured, weeks };
  structured.weeks = recoverNarrativeMomentum(structured.weeks);

  const campaignTone =
    (effectivePrefilledPlanning as any)?.communication_style ??
    (prefilledPlanning as any)?.communication_style ??
    strategyMemory?.preferred_tone;
  for (const week of structured.weeks as any[]) {
    if (typeof week.theme === 'string' && week.theme.trim()) {
      const r = await refineLanguageOutput({
        content: week.theme,
        card_type: 'weekly_plan',
        campaign_tone: campaignTone,
      });
      week.theme = (r.refined as string) || week.theme;
    }
    if (typeof week.primary_objective === 'string' && week.primary_objective.trim()) {
      const r = await refineLanguageOutput({
        content: week.primary_objective,
        card_type: 'weekly_plan',
        campaign_tone: campaignTone,
      });
      week.primary_objective = (r.refined as string) || week.primary_objective;
    }
    if (Array.isArray(week.topics_to_cover) && week.topics_to_cover.length > 0) {
      const r = await refineLanguageOutput({
        content: week.topics_to_cover.filter((t: unknown) => typeof t === 'string').map((t: unknown) => String(t).trim()).filter(Boolean),
        card_type: 'weekly_plan',
        campaign_tone: campaignTone,
      });
      if (Array.isArray(r.refined)) {
        week.topics_to_cover = r.refined;
      }
    }
  }

  try {
    const executionPressureMetadata = structured.executionPressureMetadata;
    const executionMomentumMetadata = structured.executionMomentumMetadata;
    const momentumRecoveryMetadata = structured.momentumRecoveryMetadata;
    await saveStructuredCampaignPlan({
      campaignId,
      snapshot_hash: snapshotHash,
      weeks: structured.weeks,
      omnivyre_decision: omnivyreDecision,
      raw_plan_text: rawPlanText,
      executionPressureMetadata:
        executionPressureMetadata && typeof executionPressureMetadata === 'object' ? executionPressureMetadata : undefined,
      executionMomentumMetadata:
        executionMomentumMetadata && typeof executionMomentumMetadata === 'object' ? executionMomentumMetadata : undefined,
      momentumRecoveryMetadata:
        momentumRecoveryMetadata && typeof momentumRecoveryMetadata === 'object' ? momentumRecoveryMetadata : undefined,
    });
  } catch (saveErr) {
    console.warn('saveStructuredCampaignPlan failed, returning plan anyway:', saveErr);
  }

  const companyIdForHealth = companyId ?? '';
  if (companyIdForHealth) {
    evaluateAndPersistCampaignHealth(campaignId, companyIdForHealth).catch((e) =>
      console.warn('[campaign-ai] health evaluation after plan save:', e)
    );
  }

  return structured;
}
