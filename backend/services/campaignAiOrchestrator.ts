import { supabase } from '../db/supabaseClient';
import { generateCampaignPlan } from './aiGateway';
import { generateCampaignPlanAI } from './aiPlanningService';
import { assessVirality } from './viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from './viralitySnapshotBuilder';
import { parseAiRefinedDay, parseAiPlatformCustomization } from './campaignPlanParser';
import { getPlatformStrategies } from './externalApiService';
import { saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent } from '../db/campaignPlanStore';
import { evaluateAndPersistCampaignHealth } from '../jobs/campaignHealthEvaluationJob';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getCampaignById } from '../db/campaignStore';
import { getProfile } from './companyProfileService';
import { validateCampaignPlan, type CampaignValidation } from '../lib/validation/campaignValidator';
import { generatePaidRecommendation, type PaidRecommendation } from '../lib/ads/paidAmplificationEngine';
import {
  type CapacityValidationResult,
} from './capacityFrequencyValidationGateway';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  formatForcedContextForPrompt,
} from './companyContextService';
import { buildCompanyStrategyDNA } from './companyStrategyDNAService';
import { getPrimaryCampaignType, BACKWARD_COMPAT_DEFAULTS } from './campaignContextConfig';
import {
  type DistributionStrategy,
} from './planningIntelligenceService';
import { inferExecutionMode, type ExecutionMode, isExecutionMode } from './executionModeInference';
import { buildCreatorInstruction } from './buildCreatorInstruction';
import { refreshAccountContext } from './accountContextRefreshService';
import {
  type CampaignContext,
} from './contextCompressionService';
import type { StrategyProfile } from './campaignStrategyLearner';
import {
  normalizeCapacityCounts,
} from './campaignAiCapacity';
import {
  applyPlatformContentTypePrefsToWeeks,
  buildCompanyContextBlock,
  recommendationDurationSeed,
  toValidWeeks,
} from './campaign-ai/campaignAiPlanningContext';
import {
  buildAlignmentProfile,
  evaluateWeeklyAlignment,
  parseAlignmentEvaluation,
  ALIGNMENT_ACCEPT_THRESHOLD,
  type AlignmentEvaluation,
  type AlignmentSuggestion,
  type WeeklyAlignmentProfile,
} from './campaign-ai/campaignAiAlignmentHelpers';
import {
  buildDeterministicPlanSkeleton,
  buildPlaceholderPlanFromSkeleton,
  type PlanSkeleton,
} from './campaign-ai/campaignAiPlanSkeleton';
import {
  ARCHIVED_GATHER_ITEMS,
} from '../constants/campaignPlanningGatherOrder';
import {
  createLightweightContext,
} from './campaignAiOrchestrator/lightweightContext';
import { sumSkeletonDeliverables, deliverablesToArray } from './campaignAiOrchestrator/planSkeletonHelpers';
import { enrichWeeklyWritingContext, normalizeStructuredPlanForOutput } from './campaignAiOrchestrator/structuredPlanTransforms';
import { resolveBaselineContext, type BaselineContextResult } from './campaignAiOrchestrator/baselineContext';
import { deriveTopicWeights, weightedAssignment } from './campaignAiOrchestrator/topicAssignmentHelpers';
import {
  buildCapacityValidationFailureResult,
  buildQaFallbackResult,
  DEFAULT_PLATFORM_STRATEGIES,
  extractDurationFromConversation,
  isQuestionAligned,
} from './campaignAiOrchestrator/runWithContextGuards';
import { preparePlanningRunContext } from './campaignAiOrchestrator/preparePlanningRunContext';
import { parseStructuredPlanWithRecovery } from './campaignAiOrchestrator/planRecovery';
import { enrichDeterministicWeekBriefs } from './campaignAiOrchestrator/enrichDeterministicWeekBriefs';
import { finalizeDeterministicWeeks } from './campaignAiOrchestrator/finalizeDeterministicWeeks';
import { postProcessGeneratedPlan } from './campaignAiOrchestrator/postProcessGeneratedPlan';
import { recoverLowAlignmentPlan } from './campaignAiOrchestrator/alignmentRecovery';
import { buildDeterministicWeeks } from './campaignAiOrchestrator/buildDeterministicWeeks';
import { resolveAssistContext } from './campaignAiOrchestrator/resolveAssistContext';
import { runGatherPhaseGate } from './campaignAiOrchestrator/runGatherPhaseGate';
import { preparePrefilledPlanningState } from './campaignAiOrchestrator/preparePrefilledPlanningState';
import { prepareRuntimePlanningContext } from './campaignAiOrchestrator/prepareRuntimePlanningContext';
import { resolveExecutionContext } from './campaignAiOrchestrator/resolveExecutionContext';
import { evaluateGeneratedPlan } from './campaignAiOrchestrator/evaluateGeneratedPlan';
import {
  type CampaignAiMode,
  type CampaignAiPlanInput,
  type CampaignAiPlanResult,
  type ConversationMessage,
  type OptimizationContext,
  type RecommendationContext,
} from './campaignAiOrchestrator/publicTypes';
import { executeRunCampaignAiPlan } from './campaignAiOrchestrator/runCampaignAiPlanExecutor';
import {
  actionExpectationToDesiredAction,
  communicationStyleToTone,
  contentDepthScale,
  deterministicAlignmentReasonDefaults,
  deterministicFormatRequirements,
  ensureWriterFormatRequirements,
  hasNumericAlignmentScore,
  narrativePositionFromIndex,
  narrativeRoleFromPosition,
  readContextText,
  validateContentTypeFormatPlatform,
} from './campaignAiOrchestrator/weeklyWritingHelpers';
import type {
  CampaignAiRuntimeContext,
  DeterministicWriterContentBrief,
  WeeklyWritingContextInput,
} from './campaignAiOrchestrator/types';
export {
  normalizeCapacityCounts,
  normalizeCapacityCountsWithBreakdown,
  type StructuredCapacityBreakdown,
  type StructuredCapacityCounts,
  type StructuredCapacityCountsWithBreakdown,
} from './campaignAiCapacity';

export type {
  CampaignAiMode,
  CampaignAiPlanInput,
  CampaignAiPlanResult,
  ConversationMessage,
  OptimizationContext,
  RecommendationContext,
} from './campaignAiOrchestrator/publicTypes';

async function runWithContext(
  input: CampaignAiPlanInput,
  ctx: CampaignAiRuntimeContext
): Promise<CampaignAiPlanResult> {
  let didParseFail = false;
  let didValidationFail = false;
  let regenerationTriggered = false;
  let fallbackTriggered = false;
  let generationMode: 'llm-generated' | 'fallback-placeholder' = 'llm-generated';
  let validationReasons: string[] = [];
  let alignmentScoreForDebug: number | null = null;

  const {
    platformContentTypePrefs,
    effectivePrefilledPlanning,
    deterministicPlanSkeleton,
    hasDeterministicPlanSkeleton,
    weeklyStrategyIntelligence,
    strategy_bias,
    previousPerformanceInsights,
    durationFromPrefilled,
    planningInput,
  } = await preparePlanningRunContext({ input, ctx });

  const validationResult: CapacityValidationResult | null =
    (effectivePrefilledPlanning as any)?.validation_result ?? null;
  if (
    input.mode === 'generate_plan' &&
    ctx.qaState?.readyToGenerate &&
    validationResult?.status === 'invalid' &&
    !validationResult.override_confirmed
  ) {
    return buildCapacityValidationFailureResult({
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyreDecision: ctx.omnivyreDecision,
      validationResult,
    });
  }

  // QA short-circuit: do NOT call the LLM until we are ready to generate.
  if (input.mode === 'generate_plan' && ctx.qaState && !ctx.qaState.readyToGenerate) {
    const forcedNextQuestion = ctx.qaState?.nextQuestion?.question ?? null;
    const waitingForConfirmation = !!ctx.qaState?.allRequiredAnswered && !ctx.qaState?.userConfirmed;
    return buildQaFallbackResult({
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyreDecision: ctx.omnivyreDecision,
      forcedNextQuestion,
      waitingForConfirmation,
    });
  }

  (input as any).previous_performance_insights = previousPerformanceInsights;

  // Refresh account context before planning so authority score and engagement trends are current
  if (ctx.companyId) {
    await refreshAccountContext(ctx.companyId).catch(() => { /* non-blocking */ });
  }

  const { rawOutput } = await generateCampaignPlanAI(planningInput);

  let raw = rawOutput || '';
  let hasPlanMarker = raw.includes('BEGIN_12WEEK_PLAN') && raw.includes('END_12WEEK_PLAN');

  if (input.mode === 'generate_plan' && input.conversationHistory?.length) {
    const forcedNextQuestion = ctx.qaState?.nextQuestion?.question;
    const waitingForConfirmation = !!ctx.qaState?.allRequiredAnswered && !ctx.qaState?.userConfirmed;
    const confirmationQuestion = 'I have everything I need. Would you like me to create your week plan now?';

    // Hard ready-to-generate gate: ignore plan marker unless backend says generation is allowed.
    if (hasPlanMarker && !ctx.qaState?.readyToGenerate) {
      const fallbackQuestion =
        forcedNextQuestion ??
        (waitingForConfirmation ? confirmationQuestion : 'I still need a few details to build your plan.');
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        conversationalResponse: fallbackQuestion,
        raw_plan_text: raw,
      };
    }

    if (raw && !hasPlanMarker && !ctx.qaState?.readyToGenerate) {
      let authoritativeResponse = raw;
      if (waitingForConfirmation) {
        authoritativeResponse = confirmationQuestion;
      } else if (forcedNextQuestion) {
        // Server-side question authority: always use backend's exact question (includes profile-based examples).
        authoritativeResponse = forcedNextQuestion;
      }
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: ctx.omnivyreDecision,
        conversationalResponse: authoritativeResponse,
        raw_plan_text: raw,
      };
    }
  }

  const planMatch = raw.match(/BEGIN_12WEEK_PLAN([\s\S]*?)END_12WEEK_PLAN/);
  const planText = planMatch ? planMatch[1].trim() : raw;
  if (input.mode === 'generate_plan') {
    console.info('[campaign-ai][llm-raw-preview-extended]', {
      first3000: raw.slice(0, 3000),
    });
  }
  if (input.mode === 'refine_day') {
    const dayPlan = await parseAiRefinedDay(raw);

    await saveStructuredCampaignPlanDayUpdate({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      dayPlan,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    const companyIdForHealth = ctx.companyId ?? '';
    if (companyIdForHealth) {
      evaluateAndPersistCampaignHealth(input.campaignId, companyIdForHealth).catch((e) =>
        console.warn('[campaign-ai] health evaluation after day update:', e)
      );
    }

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      day: dayPlan,
      raw_plan_text: raw,
    };
  }

  if (input.mode === 'platform_customize') {
    const customization = await parseAiPlatformCustomization(raw);

    await savePlatformCustomizedContent({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      day: customization.day,
      platforms: customization.platforms,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      platform_content: customization,
      raw_plan_text: raw,
    };
  }

  let structured;
  let autopilotResult: CampaignAiPlanResult['autopilot_result'] | undefined;
  const parseRecovery = await parseStructuredPlanWithRecovery({
    companyId: ctx.companyId ?? '',
    inputMode: input.mode,
    raw,
    planText,
    planningInput,
    planSkeleton: ctx.planSkeleton,
    prefilledPlanning: ctx.prefilledPlanning ?? null,
    hasDeterministicPlanSkeleton,
  });
  structured = parseRecovery.structured;
  didParseFail = parseRecovery.didParseFail;
  didValidationFail = parseRecovery.didValidationFail;
  regenerationTriggered = regenerationTriggered || parseRecovery.regenerationTriggered;
  fallbackTriggered = parseRecovery.fallbackTriggered;
  generationMode = parseRecovery.generationMode;
  validationReasons = parseRecovery.validationReasons;

  if (parseRecovery.conversationalResponse) {
    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      conversationalResponse: parseRecovery.conversationalResponse,
      raw_plan_text: raw,
    };
  }

  if (input.mode === 'generate_plan') {
    structured = normalizeStructuredPlanForOutput({
      structured,
      planSkeleton: ctx.planSkeleton ?? null,
    });
  }

  let alignmentResult: AlignmentEvaluation | null = null;
  if (input.mode === 'generate_plan') {
    try {
      alignmentResult = await evaluateWeeklyAlignment({
        campaignId: input.campaignId,
        recommendationContext: input.recommendationContext ?? null,
        campaignStage: ctx.campaignStage ?? null,
        psychologicalGoal: ctx.psychologicalGoal ?? null,
        momentum: ctx.momentum ?? null,
        normalizedWeeks: structured.weeks || [],
      });
      alignmentScoreForDebug = alignmentResult.alignmentScore;
    } catch (e) {
      console.warn('Alignment evaluation failed, continuing with plan:', e);
    }

    const alignmentRecovery = await recoverLowAlignmentPlan({
      structured,
      alignmentResult,
      alignmentScoreForDebug,
      planningInput,
      companyId: ctx.companyId ?? '',
      campaignId: input.campaignId,
      recommendationContext: input.recommendationContext ?? null,
      campaignStage: ctx.campaignStage ?? null,
      psychologicalGoal: ctx.psychologicalGoal ?? null,
      momentum: ctx.momentum ?? null,
      fastPath: ctx.fastPath,
      planSkeleton: ctx.planSkeleton,
    });
    structured = alignmentRecovery.structured;
    alignmentResult = alignmentRecovery.alignmentResult;
    alignmentScoreForDebug = alignmentRecovery.alignmentScoreForDebug;
    regenerationTriggered = regenerationTriggered || alignmentRecovery.regenerationTriggered;
  }

  if (input.mode === 'generate_plan') {
    structured = enrichWeeklyWritingContext({
      structured,
      recommendationContext: input.recommendationContext ?? null,
      prefilledPlanning: effectivePrefilledPlanning,
      campaignStage: ctx.campaignStage ?? null,
      psychologicalGoal: ctx.psychologicalGoal ?? null,
      momentum: ctx.momentum ?? null,
      alignment: alignmentResult,
    });
    if (platformContentTypePrefs) {
      structured = {
        ...structured,
        weeks: applyPlatformContentTypePrefsToWeeks(structured.weeks, platformContentTypePrefs),
      };
    }
    if (hasDeterministicPlanSkeleton && Array.isArray(structured?.weeks)) {
      structured = buildDeterministicWeeks({
        structured,
        deterministicPlanSkeleton,
        effectivePrefilledPlanning,
        recommendationContext: input.recommendationContext ?? null,
        campaignId: input.campaignId,
      });

      structured = enrichDeterministicWeekBriefs({
        structured,
        campaignId: input.campaignId,
        recommendationContext: input.recommendationContext ?? null,
        effectivePrefilledPlanning,
      });
      const finalizedWeeks = await finalizeDeterministicWeeks({
        structured,
        campaignId: input.campaignId,
        currentPlanWeeks: input.currentPlan?.weeks,
        recommendationContext: input.recommendationContext ?? null,
        effectivePrefilledPlanning,
        snapshot: ctx.snapshot,
        prefilledPlanning: ctx.prefilledPlanning,
        autopilot: input.autopilot,
      });
      structured = finalizedWeeks.structured;
      autopilotResult = finalizedWeeks.autopilotResult;
    }
  }

  // Apply strategy mapping, momentum recovery, and language refinement BEFORE save
  // so the database stores refined weekly plan text (Weekly Plan → refined → Daily Distribution → BOLT)
  if (input.mode === 'generate_plan' && Array.isArray(structured?.weeks) && structured.weeks.length > 0) {
    structured = await postProcessGeneratedPlan({
      structured,
      campaignId: input.campaignId,
      snapshotHash: ctx.snapshot_hash,
      omnivyreDecision: ctx.omnivyreDecision,
      rawPlanText: planText,
      distributionStrategy: ctx.distributionStrategy,
      distributionReason: ctx.distributionReason,
      validationResult: (ctx.prefilledPlanning as any)?.validation_result ?? undefined,
      effectivePrefilledPlanning,
      prefilledPlanning: ctx.prefilledPlanning,
      strategyMemory: (ctx as any).strategyMemory ?? null,
      companyId: ctx.companyId ?? null,
    });
  }

  if (input.mode === 'generate_plan') {
    const weekOne = Array.isArray(structured.weeks) ? structured.weeks.find((w: any) => Number(w?.week) === 1) ?? structured.weeks[0] : null;
    const weekOneObjective = String(weekOne?.primary_objective ?? weekOne?.objective ?? '').trim();
    const weekOneTheme = String(weekOne?.theme ?? '').trim();
    const weekOneTopicFocus = String(weekOne?.topicFocus ?? weekOne?.week_extras?.topic_focus ?? weekOne?.week_extras?.topicFocus ?? '').trim();
    const usingPlaceholder =
      /topic placeholder/i.test(weekOneTheme) ||
      /topic placeholder/i.test(weekOneTopicFocus) ||
      /placeholder objective/i.test(weekOneObjective);
    console.info('[campaign-ai][weekly-intelligence-check]', {
      hasObjective: weekOneObjective.length > 0,
      hasTheme: weekOneTheme.length > 0,
      hasTopicFocus: weekOneTopicFocus.length > 0,
      usingPlaceholder,
      generationMode,
    });
    console.info('[campaign-ai][weekly-generation-debug]', {
      didParseFail,
      didValidationFail,
      alignmentScore: alignmentScoreForDebug,
      regenerationTriggered,
      fallbackTriggered,
      generationMode,
      validationReasons,
    });
  }

  return {
    mode: input.mode,
    snapshot_hash: ctx.snapshot_hash,
    omnivyre_decision: {
      ...ctx.omnivyreDecision,
      raw: {
        ...(typeof ctx.omnivyreDecision.raw === 'object' && ctx.omnivyreDecision.raw ? ctx.omnivyreDecision.raw : {}),
        alignment_evaluation: alignmentResult,
        alignment_profile: buildAlignmentProfile(alignmentResult),
        alignment_warning:
          alignmentResult && alignmentResult.alignmentScore < ALIGNMENT_ACCEPT_THRESHOLD
            ? `Alignment score below threshold (${alignmentResult.alignmentScore}/${ALIGNMENT_ACCEPT_THRESHOLD}); accepted best available plan.`
            : null,
      },
    },
    plan: structured,
    autopilot_result: autopilotResult,
    // When a structured plan exists, avoid returning raw text as a conversational response.
    conversationalResponse: undefined,
    raw_plan_text: raw,
  };
}

export async function runCampaignAiPlan(
  input: CampaignAiPlanInput
): Promise<CampaignAiPlanResult> {
  return executeRunCampaignAiPlan(input, runWithContext);
}
