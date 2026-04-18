import { computeCampaignPlanningQAState } from '../../chatGovernance';
import { getAvailablePlatformsFromProfile } from '../../utils/platformEligibility';
import { GATHER_ORDER, REQUIRED_EXECUTION_FIELDS } from '../../constants/campaignPlanningGatherOrder';
import { getProfile } from '../companyProfileService';
import { determineDistributionStrategy, type DistributionStrategy } from '../planningIntelligenceService';
import { getStrategyMemory } from '../campaignStrategyMemoryService';
import { getCachedStrategyProfile } from '../strategyProfileCache';
import {
  buildCampaignContext,
  setCampaignContext,
  formatStrategyProfileForPrompt,
} from '../contextCompressionService';

export async function prepareRuntimePlanningContext(args: {
  input: any;
  versionRow: any;
  prefilledPlanning: Record<string, unknown>;
  qaPrefilledKeys: string[];
  trustedUtcTodayISO: string;
  resolvedDurationWeeks: number;
}) {
  const { input, versionRow, prefilledPlanning, qaPrefilledKeys, trustedUtcTodayISO, resolvedDurationWeeks } = args;

  let gatherOrderForQa = GATHER_ORDER.map((g) => ({
    key: g.key,
    question: g.question,
    contingentOn: (g as { contingentOn?: string }).contingentOn,
  }));
  if (input.mode === 'generate_plan' && versionRow?.company_id) {
    try {
      const profileForExamples = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
      const km = profileForExamples?.key_messages;
      const desiredTransformation = (profileForExamples as { desired_transformation?: string | null })?.desired_transformation;
      const lifeAfterSolution = (profileForExamples as { life_after_solution?: string | null })?.life_after_solution;
      let examplePart = '';
      if (typeof km === 'string' && km.trim()) {
        examplePart = ` (e.g. ${km.trim().slice(0, 120)}${km.length > 120 ? '…' : ''})`;
      } else if (Array.isArray(km) && km.length > 0 && typeof km[0] === 'string' && String(km[0]).trim()) {
        examplePart = ` (e.g. ${String(km[0]).trim().slice(0, 120)}${String(km[0]).length > 120 ? '…' : ''})`;
      } else if (typeof desiredTransformation === 'string' && desiredTransformation.trim()) {
        examplePart = ` (e.g. Desired Transformation: ${desiredTransformation.trim().slice(0, 100)}${desiredTransformation.length > 100 ? '…' : ''})`;
      } else if (typeof lifeAfterSolution === 'string' && lifeAfterSolution.trim()) {
        examplePart = ` (e.g. Life After Solution: ${lifeAfterSolution.trim().slice(0, 100)}${lifeAfterSolution.length > 100 ? '…' : ''})`;
      }
      if (examplePart) {
        gatherOrderForQa = gatherOrderForQa.map((g) =>
          g.key === 'key_messages' ? { ...g, question: g.question + examplePart } : g
        );
      }
    } catch {
      // keep base question without profile examples
    }
  }

  const qaState =
    input.mode === 'generate_plan'
      ? computeCampaignPlanningQAState({
          gatherOrder: gatherOrderForQa,
          prefilledKeys: qaPrefilledKeys,
          prefilledValues: prefilledPlanning || {},
          requiredKeys: REQUIRED_EXECUTION_FIELDS as unknown as string[],
          utcTodayISO: trustedUtcTodayISO,
          conversationHistory: (() => {
            const base = (input.conversationHistory ?? []).map((m: any) => ({
              type: m.type as 'user' | 'ai',
              message: m.message,
            }));
            if (base.length === 0) {
              const msg = String(input.message ?? '').trim();
              if (msg) return [{ type: 'user' as const, message: msg }];
            }
            return base;
          })(),
        })
      : undefined;

  let distributionStrategy: DistributionStrategy | undefined;
  let distributionReason: string | undefined;
  if (input.mode === 'generate_plan') {
    const vr = (prefilledPlanning as any)?.validation_result;
    const skeleton = (prefilledPlanning as any)?.deterministic_plan_skeleton;
    const platformAllocation = skeleton?.platform_allocation ?? (prefilledPlanning as any)?.platform_content_requests;
    const platformCount =
      typeof platformAllocation === 'object' && platformAllocation !== null && !Array.isArray(platformAllocation)
        ? Object.keys(platformAllocation).length
        : Array.isArray(platformAllocation)
          ? platformAllocation.length
          : 0;
    const requested_total =
      vr && typeof vr.requested_total === 'number'
        ? vr.requested_total
        : skeleton?.platform_postings_total ??
          skeleton?.total_weekly_content_count ??
          (skeleton?.execution_items as any[])?.reduce((sum: number, it: any) => sum + (Number(it?.count_per_week) || 0), 0);
    const weekly_capacity_total =
      vr && typeof vr.weekly_capacity_total === 'number'
        ? vr.weekly_capacity_total
        : (prefilledPlanning as any)?.weekly_capacity ?? (prefilledPlanning as any)?.content_capacity;
    const contentTypes = Array.isArray(skeleton?.content_type_mix)
      ? skeleton.content_type_mix
      : Array.isArray((prefilledPlanning as any)?.content_type_mix)
        ? (prefilledPlanning as any).content_type_mix
        : [];
    const strategyResult = determineDistributionStrategy({
      campaignDurationWeeks: resolvedDurationWeeks,
      weekly_capacity_total,
      requested_total: requested_total > 0 ? requested_total : undefined,
      platformCount: platformCount > 0 ? platformCount : undefined,
      contentTypes: contentTypes.length > 0 ? contentTypes : undefined,
      cross_platform_sharing:
        (prefilledPlanning as any)?.cross_platform_sharing != null
          ? Boolean((prefilledPlanning as any).cross_platform_sharing?.enabled ?? (prefilledPlanning as any).cross_platform_sharing)
          : undefined,
      campaignIntent: (prefilledPlanning as any)?.campaign_intent ?? undefined,
    });
    distributionStrategy = strategyResult.strategy;
    distributionReason = strategyResult.reason;
  }

  let strategyMemory: { preferred_tone?: string | null; preferred_platforms?: string[] } | null = null;
  let strategyLearningProfile: any = null;
  let strategyLearningFromCache = false;
  if (versionRow?.company_id) {
    try {
      strategyMemory = await getStrategyMemory(versionRow.company_id);
    } catch {}
    try {
      const { profile, fromCache } = await getCachedStrategyProfile(versionRow.company_id);
      strategyLearningProfile = profile;
      strategyLearningFromCache = fromCache;
    } catch {}
  }

  let campaignContext: any = null;
  const strategicThemesRaw = (prefilledPlanning as any)?.strategic_themes ?? (prefilledPlanning as any)?.recommended_topics ?? [];
  const themeList = Array.isArray(strategicThemesRaw) ? strategicThemesRaw.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
  const hasStrategicThemes = themeList.length > 0;
  const execConfigForCtx = (prefilledPlanning as any)?.execution_config as Record<string, unknown> | undefined;
  const shouldBuildCampaignContext =
    input.mode === 'generate_plan' && versionRow?.company_id ? true : !!(strategyMemory || strategyLearningProfile || hasStrategicThemes);

  if (shouldBuildCampaignContext) {
    let eligiblePlatforms: string[] | undefined =
      (prefilledPlanning as any)?.platforms
        ? String((prefilledPlanning as any).platforms).split(',').map((p: string) => p.trim()).filter(Boolean)
        : undefined;
    if (!eligiblePlatforms?.length && versionRow?.company_id) {
      try {
        const profile = await getProfile(versionRow.company_id, { autoRefine: false, languageRefine: true });
        eligiblePlatforms = getAvailablePlatformsFromProfile(profile);
      } catch {}
    }
    const topicFallback =
      (prefilledPlanning as any)?.theme_or_description ??
      (prefilledPlanning as any)?.polished_title ??
      (prefilledPlanning as any)?.topic ??
      'Campaign';
    const effectiveThemes =
      themeList.length > 0
        ? themeList
        : typeof topicFallback === 'string' && topicFallback !== 'Campaign'
          ? [topicFallback]
          : undefined;
    campaignContext = buildCampaignContext({
      topic: typeof topicFallback === 'string' ? topicFallback : 'Campaign',
      tone: strategyMemory?.preferred_tone ?? undefined,
      themes: effectiveThemes,
      strategyMemory: strategyMemory
        ? {
            preferred_platforms: strategyMemory.preferred_platforms ?? [],
            preferred_content_types: (strategyMemory as { preferred_content_types?: string[] }).preferred_content_types ?? [],
          }
        : undefined,
      strategyLearningProfile: strategyLearningProfile ?? undefined,
      eligiblePlatforms,
      target_audience:
        typeof (prefilledPlanning as any)?.target_audience === 'string'
          ? (prefilledPlanning as any).target_audience
          : typeof execConfigForCtx?.target_audience === 'string'
            ? execConfigForCtx.target_audience
            : undefined,
      content_depth:
        typeof (prefilledPlanning as any)?.content_depth === 'string'
          ? (prefilledPlanning as any).content_depth
          : typeof execConfigForCtx?.content_depth === 'string'
            ? execConfigForCtx.content_depth
            : undefined,
      campaign_goal:
        typeof (prefilledPlanning as any)?.campaign_goal === 'string'
          ? (prefilledPlanning as any).campaign_goal
          : typeof execConfigForCtx?.campaign_goal === 'string'
            ? execConfigForCtx.campaign_goal
            : undefined,
    });
    campaignContext.strategic_themes = effectiveThemes ?? undefined;
    campaignContext.campaign_duration_weeks = resolvedDurationWeeks;
    campaignContext.strategy_learning_profile =
      strategyLearningProfile != null ? formatStrategyProfileForPrompt(strategyLearningProfile) : undefined;
    setCampaignContext(input.campaignId, campaignContext);
  }

  return {
    qaState,
    distributionStrategy,
    distributionReason,
    strategyMemory,
    strategyLearningProfile,
    strategyLearningFromCache,
    campaignContext,
  };
}
