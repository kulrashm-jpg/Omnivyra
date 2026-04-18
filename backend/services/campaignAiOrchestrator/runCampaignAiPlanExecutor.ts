import { supabase } from '../../db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../db/campaignVersionStore';
import { getPrimaryCampaignType, BACKWARD_COMPAT_DEFAULTS } from '../campaignContextConfig';
import { recommendationDurationSeed, toValidWeeks } from '../campaign-ai/campaignAiPlanningContext';
import { buildDeterministicPlanSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';
import { extractDurationFromConversation, DEFAULT_PLATFORM_STRATEGIES } from './runWithContextGuards';
import { resolveAssistContext } from './resolveAssistContext';
import { runGatherPhaseGate } from './runGatherPhaseGate';
import { resolveExecutionContext } from './resolveExecutionContext';
import { preparePrefilledPlanningState } from './preparePrefilledPlanningState';
import { prepareRuntimePlanningContext } from './prepareRuntimePlanningContext';
import { evaluateGeneratedPlan } from './evaluateGeneratedPlan';
import { buildCompanyContextBlock } from '../campaign-ai/campaignAiPlanningContext';
import type { CampaignAiPlanInput, CampaignAiPlanResult } from './publicTypes';
import type { MappedWeeklySkeleton } from '../strategyMapper';

export async function executeRunCampaignAiPlan(
  input: CampaignAiPlanInput,
  runWithContext: (input: CampaignAiPlanInput, ctx: any) => Promise<CampaignAiPlanResult>
): Promise<CampaignAiPlanResult> {
  const isConversational = input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0;
  const [campaignResult, versionRow] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, start_date, description, name')
      .eq('id', input.campaignId)
      .maybeSingle(),
    getLatestCampaignVersionByCampaignId(input.campaignId),
  ]);
  const { data: campaignRow, error: campaignQueryError } = campaignResult;
  if (campaignQueryError) {
    console.error('[campaignAiOrchestrator] campaign query error:', campaignQueryError.message);
  }

  if (input.mode === 'generate_plan') {
    if (!campaignRow) {
      throw new Error('Campaign not found. Please save the campaign and try again.');
    }
    if (!versionRow) {
      throw new Error('Campaign version not found. Please save the campaign and try again.');
    }
  }

  const fromConversation = extractDurationFromConversation(input.conversationHistory ?? []);
  const dbDuration: number | null = null;
  const recommendationSeed = recommendationDurationSeed(input.recommendationContext);
  const explicitConversationDuration = toValidWeeks(fromConversation);
  const snapshot = versionRow?.campaign_snapshot as Record<string, unknown> | null | undefined;
  const execConfig = snapshot?.execution_config as Record<string, unknown> | null | undefined;

  const { assistBlogContext, assistInsightContext, assistTopicContext, assistAi } = await resolveAssistContext(snapshot);
  const durationFromExecConfig =
    execConfig != null && typeof execConfig.campaign_duration === 'number'
      ? toValidWeeks(execConfig.campaign_duration)
      : null;

  const sourcedDurationWeeks =
    explicitConversationDuration ??
    durationFromExecConfig ??
    dbDuration ??
    recommendationSeed ??
    toValidWeeks(input.durationWeeks);
  const resolvedDurationWeeks = Math.min(12, sourcedDurationWeeks ?? 12);
  const inputWithDuration = { ...input, durationWeeks: resolvedDurationWeeks };

  const gatherPhaseResult = await runGatherPhaseGate({ input, campaignRow, versionRow });
  if (gatherPhaseResult) return gatherPhaseResult;

  const buildMode = versionRow?.build_mode ?? BACKWARD_COMPAT_DEFAULTS.build_mode;
  const contextScope = versionRow?.context_scope ?? null;
  const campaignTypes = versionRow?.campaign_types ?? BACKWARD_COMPAT_DEFAULTS.campaign_types;
  const campaignWeights = versionRow?.campaign_weights ?? BACKWARD_COMPAT_DEFAULTS.campaign_weights;
  const primaryType = getPrimaryCampaignType(campaignWeights);
  const campaignIntentSummary = {
    types: campaignTypes,
    weights: campaignWeights,
    primary_type: primaryType,
  };

  const lastUserMessage = (input.conversationHistory ?? []).filter((m: any) => m?.type === 'user').pop()?.message ?? '';
  const looksLikePlanConfirmation =
    input.mode === 'generate_plan' &&
    lastUserMessage.trim().length > 0 &&
    (/^\s*(yes|sure|ok|okay|please|yeah|yep)\s*$/i.test(lastUserMessage.trim()) ||
      /\b(proceed with|use)\s+\d{1,2}\s*weeks?\b/i.test(lastUserMessage) ||
      /^\s*\d{1,2}\s*weeks?\s*$/i.test(lastUserMessage.trim()) ||
      /\bcreate\b.*\bplan\b/i.test(lastUserMessage));
  const useFastPath = isConversational && looksLikePlanConfirmation;
  if (useFastPath) {
    console.info('[campaign-ai] Fast path: skipping profile/snapshot/assessVirality for plan confirmation', {
      campaignId: input.campaignId,
      lastUserMessage: lastUserMessage.slice(0, 80),
    });
  }

  const { ctx, baselineContext } = await resolveExecutionContext({
    input,
    versionRow,
    buildMode,
    contextScope,
    isConversational,
    useFastPath,
    campaignIntentSummary,
    buildCompanyContextBlock,
  });

  const recommendationPayload = (input.recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const recommendationStage = String(recommendationPayload.campaign_stage ?? '').trim();
  const recommendationPsychological = String(
    recommendationPayload.psychological_goal ?? recommendationPayload.behavioral_goal ?? ''
  ).trim();
  const recommendationMomentum = String(
    recommendationPayload.momentum ?? recommendationPayload.momentum_goal ?? ''
  ).trim();
  ctx.campaignStage = versionRow?.company_stage ?? (recommendationStage || null);
  ctx.psychologicalGoal = recommendationPsychological || null;
  ctx.momentum = recommendationMomentum || null;

  const { prefilledPlanning, trustedUtcTodayISO, qaPrefilledKeys, deterministicSkeleton } =
    await preparePrefilledPlanningState({
      input,
      campaignRow,
      versionRow,
      resolvedDurationWeeks,
      sourcedDurationWeeks,
    });

  const {
    qaState,
    distributionStrategy,
    distributionReason,
    strategyMemory,
    strategyLearningProfile,
    strategyLearningFromCache,
    campaignContext,
  } = await prepareRuntimePlanningContext({
    input,
    versionRow,
    prefilledPlanning,
    qaPrefilledKeys,
    trustedUtcTodayISO,
    resolvedDurationWeeks,
  });

  let result: CampaignAiPlanResult;
  try {
    result = await runWithContext(inputWithDuration, {
      ...ctx,
      companyId: versionRow?.company_id ?? null,
      fastPath: useFastPath,
      prefilledPlanning,
      strategyMemory,
      strategyLearningProfile,
      strategyLearningFromCache,
      campaignContext,
      distributionStrategy,
      distributionReason,
      assistContext: {
        blog_context: assistBlogContext,
        insight_context: assistInsightContext,
        topic_context: assistTopicContext,
        ai_assist: assistAi,
      },
      planSkeleton:
        input.mode === 'generate_plan' && !deterministicSkeleton
          ? buildDeterministicPlanSkeleton({
              durationWeeks: resolvedDurationWeeks,
              contentCapacity: (prefilledPlanning as any)?.content_capacity,
            })
          : null,
      qaState: qaState
        ? {
            answeredKeys: qaState.answeredKeys,
            userConfirmed: qaState.userConfirmed,
            nextQuestion: qaState.nextQuestion,
            readyToGenerate: qaState.readyToGenerate,
            allRequiredAnswered: qaState.allRequiredAnswered,
            missingRequiredKeys: qaState.missingRequiredKeys,
          }
        : undefined,
    });
  } catch (aiErr) {
    const mappedSkeleton = (prefilledPlanning as any)?.mapped_weekly_skeleton as MappedWeeklySkeleton | null | undefined;
    if (input.mode === 'generate_plan' && mappedSkeleton?.weekly_strategies?.length) {
      console.warn('[campaign-ai][failsafe] AI generation failed, returning mapped skeleton without AI topics:', aiErr);
      // Carry platform_content_requests from the planning context so the skeleton
      // has proper platform_allocation and content_type_mix for activity card generation.
      const pcr = (prefilledPlanning as any)?.platform_content_requests as Array<{ platform?: string; content_type?: string; count_per_week?: number }> | undefined;
      const platformAllocation: Record<string, number> = {};
      const contentTypeMixSet = new Set<string>();
      if (Array.isArray(pcr)) {
        for (const r of pcr) {
          if (r.platform) platformAllocation[r.platform] = (platformAllocation[r.platform] || 0) + (r.count_per_week || 1);
          if (r.content_type) contentTypeMixSet.add(r.content_type);
        }
      }
      const fallbackWeeks = mappedSkeleton.weekly_strategies.map((ws) => ({
        week: ws.week,
        theme: ws.theme,
        funnel_stage: ws.funnel_stage,
        primary_objective: ws.primary_objective,
        platform_allocation: Object.keys(platformAllocation).length > 0 ? platformAllocation : (ws as any).platform_allocation ?? {},
        content_type_mix: contentTypeMixSet.size > 0 ? Array.from(contentTypeMixSet) : (ws as any).content_type_mix ?? ['post'],
        daily: [],
      }));
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        plan: { weeks: fallbackWeeks },
        raw_plan_text: JSON.stringify({ weeks: fallbackWeeks }),
        validation_result: (prefilledPlanning as any)?.validation_result ?? null,
      };
    }
    throw aiErr;
  }

  if (result.omnivyre_decision && baselineContext && !('unavailable' in baselineContext)) {
    result.omnivyre_decision = {
      ...result.omnivyre_decision,
      raw: {
        ...(typeof result.omnivyre_decision.raw === 'object' && result.omnivyre_decision.raw ? result.omnivyre_decision.raw : {}),
        baseline: {
          expectedBaseline: baselineContext.expectedBaseline,
          actualFollowers: baselineContext.actualFollowers,
          ratio: baselineContext.ratio,
          status: baselineContext.status,
        },
      },
    };
  }

  const { campaign_validation, paid_recommendation } = await evaluateGeneratedPlan({
    input,
    result,
    prefilledPlanning,
    resolvedDurationWeeks,
    deterministicSkeleton,
  });

  return {
    ...result,
    validation_result: (prefilledPlanning as any)?.validation_result ?? null,
    campaign_validation,
    paid_recommendation,
  };
}
