import { supabase } from '../../db/supabaseClient';
import { generatePerformanceInsights } from '../performanceInsightGenerator';
import { getWeeklyStrategyIntelligence } from '../weeklyStrategyIntelligenceService';
import { computeStrategyBias } from '../strategyBiasService';
import { normalizeStrategyContext } from '../strategyContextService';
import { extractPlatformContentTypesFromConversation, parsePlatformContentTypesValue } from '../campaign-ai/campaignAiPlanningContext';

export async function preparePlanningRunContext(args: {
  input: any;
  ctx: any;
}) {
  const { input, ctx } = args;

  const prefilledPrefs =
    parsePlatformContentTypesValue((ctx.prefilledPlanning as any)?.platform_content_types) ??
    parsePlatformContentTypesValue((ctx.prefilledPlanning as any)?.platform_content_type_preferences);
  const historyPrefs = extractPlatformContentTypesFromConversation(input.conversationHistory);
  const platformContentTypePrefs = prefilledPrefs ?? historyPrefs;
  const effectivePrefilledPlanning =
    platformContentTypePrefs && !(ctx.prefilledPlanning as any)?.platform_content_types
      ? { ...(ctx.prefilledPlanning ?? {}), platform_content_types: JSON.stringify(platformContentTypePrefs) }
      : (ctx.prefilledPlanning ?? null);

  const deterministicPlanSkeleton = (effectivePrefilledPlanning as any)?.deterministic_plan_skeleton ?? null;
  const hasDeterministicPlanSkeleton = !!(deterministicPlanSkeleton && typeof deterministicPlanSkeleton === 'object');

  let weeklyStrategyIntelligence: any = null;
  let strategy_bias: any = null;
  try {
    weeklyStrategyIntelligence = await getWeeklyStrategyIntelligence(input.campaignId);
  } catch (_) {
    // Optional enrichment; do not fail plan generation
  }
  try {
    strategy_bias = await computeStrategyBias(input.campaignId);
  } catch (_) {
    // Advisory only; do not fail plan generation
  }

  let previousPerformanceInsights = input.previous_performance_insights ?? null;
  if (!previousPerformanceInsights) {
    let lastCampaignId: string | null = input.campaignId ?? null;
    if (!lastCampaignId && ctx.companyId) {
      try {
        const { data: prev } = await supabase
          .from('campaigns')
          .select('id')
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        lastCampaignId = (prev as { id?: string } | null)?.id ?? null;
      } catch (_) {
        // continue
      }
    }
    if (lastCampaignId) {
      try {
        previousPerformanceInsights = await generatePerformanceInsights(lastCampaignId);
      } catch (_) {
        // continue without insights
      }
    }
  }

  const execConfig = effectivePrefilledPlanning?.execution_config as Record<string, unknown> | null | undefined;
  const rawDuration =
    execConfig != null && typeof execConfig.campaign_duration === 'number'
      ? Math.floor(Number(execConfig.campaign_duration))
      : (effectivePrefilledPlanning?.campaign_duration as number) ?? 12;
  const durationFromPrefilled = Math.max(1, Math.min(52, Number.isFinite(rawDuration) ? rawDuration : 12));
  const platformNames = (ctx.platformStrategies ?? []).map((p: { name?: string }) => p?.name ?? 'linkedin').filter(Boolean);
  const platforms = platformNames.length > 0 ? platformNames : ['linkedin'];
  const posting_frequency: Record<string, number> = {};
  for (const p of platforms) posting_frequency[p] = 3;

  const baseDescription = [
    input.message,
    effectivePrefilledPlanning && Object.keys(effectivePrefilledPlanning).length > 0
      ? `Prefilled: ${JSON.stringify(effectivePrefilledPlanning)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const strategy_context = normalizeStrategyContext({
    duration_weeks: durationFromPrefilled,
    platforms,
    posting_frequency,
  });

  const planningInput = {
    companyId: ctx.companyId ?? '',
    idea_spine: {
      refined_title: 'Campaign plan',
      refined_description: baseDescription,
      selected_angle: input.message || null,
    },
    strategy_context,
    campaign_direction: input.message || 'Generate campaign plan',
    account_context: input.account_context || null,
    previous_performance_insights: previousPerformanceInsights,
    previous_campaign_context: input.previous_campaign_context ?? null,
    blog_context: ctx.assistContext?.blog_context ?? null,
    insight_context: ctx.assistContext?.insight_context ?? null,
    topic_context: ctx.assistContext?.topic_context ?? null,
    ai_assist: ctx.assistContext?.ai_assist ?? null,
  };

  return {
    platformContentTypePrefs,
    effectivePrefilledPlanning,
    deterministicPlanSkeleton,
    hasDeterministicPlanSkeleton,
    weeklyStrategyIntelligence,
    strategy_bias,
    previousPerformanceInsights,
    durationFromPrefilled,
    planningInput,
  };
}
