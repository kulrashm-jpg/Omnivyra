import { supabase } from '../db/supabaseClient';
import { resolvePlannerFlag } from './plannerRolloutMode';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { generateCampaignPlan, getLlmPoolPressure } from './aiGateway';
import { PlannerBudget } from './plannerBudget';
import { recordPlannerAlertCounter } from './plannerAlerting';
import { attemptPartialDraftSalvage } from './campaignAiOrchestrator/partialDraftSalvage';
import { withPhaseHeartbeat } from './campaignAiOrchestrator/heartbeat';
import { plannerEventBus } from './plannerEventBus';
import { getBoltQueuePressure } from './bullmqOverloadSignals';
import { enqueueAsyncRefinement } from './campaignAiOrchestrator/asyncRefinement';
import { applyActiveRolloutMode } from './plannerRolloutMode';
import { getClusterOverloadMode, policyForMode } from './distributedOverloadCoordinator';
import { checkAdmission, type PlannerPriority } from './plannerAdmissionControl';
import { getCostGuidance } from './plannerCostGovernance';
import { generateCampaignPlanAI } from './aiPlanningService';
import { assessVirality } from './viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from './viralitySnapshotBuilder';
import { parseAiRefinedDay, parseAiPlatformCustomization } from './campaignPlanParser';
import { getPlatformStrategies } from './externalApiService';
import { saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent } from '../db/campaignPlanStore';
import { evaluateAndPersistCampaignHealth } from '../jobs/campaignHealthEvaluationJob';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getCampaignById } from '../db/campaignStore';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
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
import { resolveBrandVoice } from './brand/resolveBrandVoice';
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
// PMF-005 — reversible platform-runtime wiring (default legacy → unchanged).
import { shouldRunPlatform } from './campaignCapability/campaignMigrationFlag';
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

  // Defensive sub-stage emitter — advisory only, never blocks the plan run.
  // Fires only for generate_plan so refine_day / platform_customize stay quiet.
  const emitSubStage = (substage: string) => {
    if (input.mode !== 'generate_plan') return;
    try { input.onSubStage?.(substage); } catch { /* observer errors are swallowed */ }
  };

  // Structured perf-log helper: logs durations for every planner phase. Survives
  // exceptions because callers wrap the timed block in try/finally.
  const planStartedAt = Date.now();

  // ── Rollout mode resolution ─────────────────────────────────────────────
  // `PLANNER_ROLLOUT_MODE` is the operator-facing knob for staged rollout.
  // The call below reads the active mode and propagates the resulting
  // feature flags to process.env so the rest of this function (and its
  // dependencies, like the gateway and the refinement enqueue) see the
  // correct values. Individual env vars still override the mode defaults.
  applyActiveRolloutMode();

  // ── DISTRIBUTED ADMISSION CONTROL ───────────────────────────────────────
  // When the cluster is in `critical` overload mode, low-priority requests
  // are rejected with a structured Retry-After. High-priority and paid-plan
  // requests always pass through. Disabled when PLANNER_ADMISSION_ENABLED=false.
  if (input.mode === 'generate_plan') {
    const callerPriority: PlannerPriority =
      ((input as any).priority as PlannerPriority) ?? 'normal';
    const admission = await checkAdmission({
      campaignId: input.campaignId,
      priority: callerPriority,
      paidPlan: (input as any).paidPlan === true,
    });
    if (!admission.admitted) {
      logger.warn('planner_admission_rejected', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        priority: admission.priority,
        mode: admission.mode,
        reason: admission.reason,
        retry_after_ms: admission.retryAfterMs,
      });
      return {
        mode: input.mode,
        snapshot_hash: ctx.snapshot_hash,
        omnivyre_decision: {
          ...ctx.omnivyreDecision,
          raw: {
            ...(typeof ctx.omnivyreDecision.raw === 'object' && ctx.omnivyreDecision.raw ? ctx.omnivyreDecision.raw : {}),
            admission_rejected: true,
            admission_reason: admission.reason,
            admission_retry_after_ms: admission.retryAfterMs,
            admission_mode: admission.mode,
          },
        },
        conversationalResponse: `The campaign planner is currently under heavy load. Please retry in ~${Math.round((admission.retryAfterMs ?? 5000) / 1000)} seconds.`,
        raw_plan_text: '',
      };
    }
  }

  // ── CLUSTER OVERLOAD POLICY ─────────────────────────────────────────────
  // Read the cluster-wide overload mode (cached 2s) and merge its policy
  // into the orchestrator's local overload signal. The cluster mode is
  // authoritative when stricter than local; otherwise the existing local
  // checks (pool pressure + BullMQ + per-process) decide.
  const clusterOverload = await getClusterOverloadMode();
  const clusterPolicy = policyForMode(clusterOverload.mode);
  if (clusterOverload.mode !== 'normal' && input.mode === 'generate_plan') {
    logger.info('planner_cluster_overload_policy', {
      request_id: getRequestContext().requestId,
      campaign_id: input.campaignId,
      cluster_mode: clusterOverload.mode,
      pressure_score: clusterOverload.pressureScore,
      policy: clusterPolicy,
    });
  }

  // ── COST GUIDANCE (advisory) ───────────────────────────────────────────
  // The cost layer suggests whether refinement is worth doing for this org/
  // campaign and whether a cheaper model should be preferred. The
  // orchestrator combines this with overload policy when choosing what to
  // skip — overload policy wins when stricter.
  const costGuidance = await getCostGuidance(
    ctx.companyId ?? null,
    input.campaignId,
  );
  if (!costGuidance.shouldRefine) {
    logger.info('planner_cost_guidance_refinement_off', {
      request_id: getRequestContext().requestId,
      campaign_id: input.campaignId,
      reasons: costGuidance.reasons,
      rolling_org_spend_usd: costGuidance.rollingOrgSpendUsd,
      refinement_roi: costGuidance.refinementRoi,
    });
  }

  // ── Centralized planner budget (PLANNER_TOTAL_BUDGET_MS, default 180s) ──
  // Provides a single global ceiling on planner wall-clock and a remaining-
  // budget query so optional phases can decline to start when the wall clock
  // is almost gone. Per-phase budgets (drafting/alignment/repair) still apply
  // — this is an outer guardrail, not a replacement.
  const plannerBudget = new PlannerBudget({ campaignId: input.campaignId });
  const logPhase = (
    stage: string,
    startedAt: number,
    extra: Record<string, unknown> = {},
  ): void => {
    try {
      logger.info('campaign_ai_plan_phase', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        stage,
        duration_ms: Date.now() - startedAt,
        ...extra,
      });
    } catch { /* never let logging break the run */ }
  };

  emitSubStage('context');

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

  // ── PLANNER OVERLOAD MODE ────────────────────────────────────────────────
  // Inspect current LLM-pool pressure before drafting. When the gateway is
  // already under pressure (high queue depth or high recent wait time) we
  // degrade the planner: skip alignment recovery, skip the refinement LLM
  // pass, and propagate the "fast" flag so resolveExecutionContext drops
  // expensive context-building. The decision is request-scoped — a new
  // request reads fresh pressure when it starts.
  const overloadQueueThreshold = Math.max(
    0,
    Number(process.env.PLANNER_OVERLOAD_QUEUE_THRESHOLD || 3),
  );
  const overloadWaitMsThreshold = Math.max(
    0,
    Number(process.env.PLANNER_OVERLOAD_WAIT_MS || 5000),
  );
  const poolPressure = getLlmPoolPressure();
  // BullMQ queue pressure is read in parallel (≤2s cached, fail-open). When
  // the BOLT job queue is backed up, we degrade BEFORE the LLM pool itself
  // saturates so the planner doesn't compound the backlog.
  const queuePressure = await getBoltQueuePressure();
  const overloadActive =
    poolPressure.pendingAcquires >= overloadQueueThreshold ||
    poolPressure.recentAvgWaitMs >= overloadWaitMsThreshold ||
    queuePressure.pressureHigh;
  if (overloadActive && input.mode === 'generate_plan') {
    logger.warn('planner_overload_degradation_active', {
      request_id: getRequestContext().requestId,
      campaign_id: input.campaignId,
      pending_acquires: poolPressure.pendingAcquires,
      active_calls: poolPressure.activeCalls,
      max_allowed: poolPressure.maxAllowed,
      recent_avg_wait_ms: poolPressure.recentAvgWaitMs,
      queue_threshold: overloadQueueThreshold,
      wait_threshold_ms: overloadWaitMsThreshold,
      bullmq_pressure_high: queuePressure.pressureHigh,
      bullmq_reasons: queuePressure.reasons,
      bullmq_waiting: queuePressure.waiting,
      bullmq_delayed: queuePressure.delayed,
      bullmq_active: queuePressure.active,
    });
    if (queuePressure.pressureHigh) {
      logger.warn('planner_overload_queue_triggered', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        reasons: queuePressure.reasons,
      });
    }
    recordPlannerAlertCounter('overload_mode_activation');
    plannerEventBus.emit({
      type: 'overload_mode_activated',
      campaign_id: input.campaignId,
      payload: {
        pool_pressure: poolPressure,
        queue_pressure: queuePressure,
      },
    });
  }

  // ── DRAFTING PHASE with hard budget + abort ──────────────────────────────
  // Drafting is the single biggest contributor to tail latency. Cap it so a
  // hung provider call can't freeze the UI for minutes. On budget expiry we
  // abort the in-flight call (signal propagates through aiGateway →
  // callOpenAi/callAnthropic) and fall back to a deterministic placeholder
  // plan derived from the plan skeleton. The user ALWAYS gets a campaign
  // object — never a broken UI.
  // Per-phase budget. The global PlannerBudget caps total wall-clock; this
  // local budget caps just the drafting phase. We clamp to whichever is
  // smaller — never wait past the global budget for one phase.
  const draftingBudgetMs = plannerBudget.phaseBudgetMs(
    Math.max(1000, Number(process.env.DRAFTING_BUDGET_MS || 90000)),
  );
  emitSubStage('drafting');
  const draftingStartedAt = Date.now();
  let draftingSuccess = false;
  let draftingBudgetExceeded = false;
  let rawOutput = '';
  // Streaming-mode toggle: opt-in via STREAMING_DRAFT_ENABLED=true. When
  // enabled, the provider streams its response and the salvage layer can use
  // the accumulated partial output if the budget aborts mid-stream — far
  // better than the previous behavior where a timeout yielded an empty body.
  const streamingDraftEnabled =
    resolvePlannerFlag('STREAMING_DRAFT_ENABLED', true);
  const draftingController = new AbortController();
  let draftingTimeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(
    () => draftingController.abort(),
    draftingBudgetMs,
  );
  // Streaming salvage buffer: every chunk appends here so an abort can hand
  // the accumulated text to attemptPartialDraftSalvage even when the stream
  // never completes. Mutates the same `rawOutput` variable on stream finish.
  let streamingAccumulated = '';
  try {
    // Heartbeat: emit `still-drafting` every 15s so the UI never sits silently
    // while we wait for the provider. Stops as soon as the awaited promise
    // resolves or rejects.
    const result = await withPhaseHeartbeat(
      () => generateCampaignPlanAI(planningInput, {
        signal: draftingController.signal,
        pool: 'drafting',
        campaignId: input.campaignId ?? null,
        stream: streamingDraftEnabled,
        onChunk: streamingDraftEnabled
          ? (_delta, accumulated) => {
              streamingAccumulated = accumulated;
            }
          : undefined,
      }),
      {
        substage: 'still-drafting',
        onSubStage: emitSubStage,
        signal: draftingController.signal,
      },
    );
    rawOutput = result.rawOutput;
    draftingSuccess = true;
  } catch (err: unknown) {
    // Recover streamed partial output if the gateway threw a partial-stream
    // error. The gateway attaches `partialOutput` on GatewayPartialStreamError;
    // we duck-type via `code === 'PROVIDER_PARTIAL_STREAM'` so we don't have
    // to import the class here.
    const errCode = (err as { code?: string })?.code;
    const partialOutput = (err as { partialOutput?: string })?.partialOutput;
    if (errCode === 'PROVIDER_PARTIAL_STREAM' && typeof partialOutput === 'string' && partialOutput.length > streamingAccumulated.length) {
      streamingAccumulated = partialOutput;
    }
    // The salvage layer below reads streamingAccumulated → rawOutput.
    if (streamingAccumulated.length > 0) {
      rawOutput = streamingAccumulated;
    }
    if (draftingController.signal.aborted) {
      draftingBudgetExceeded = true;
      logger.warn('drafting_budget_exceeded_falling_back_to_placeholder', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        duration_ms: Date.now() - draftingStartedAt,
        budget_ms: draftingBudgetMs,
        streamed_partial_chars: streamingAccumulated.length,
      });
      recordPlannerAlertCounter('drafting_timeout');
    } else {
      logger.warn('drafting_call_failed_falling_back_to_placeholder', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        error: err instanceof Error ? err.message : String(err),
        streamed_partial_chars: streamingAccumulated.length,
      });
    }
  } finally {
    if (draftingTimeoutHandle) {
      clearTimeout(draftingTimeoutHandle);
      draftingTimeoutHandle = null;
    }
    if (draftingSuccess) plannerBudget.markPhaseCompleted('drafting');
    else plannerBudget.markPhaseSkipped('drafting', draftingBudgetExceeded ? 'timeout' : 'error');
    logPhase('drafting', draftingStartedAt, {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      success: draftingSuccess,
      budget_exceeded: draftingBudgetExceeded,
      overload_active: overloadActive,
      planner_remaining_ms: plannerBudget.remainingMs(),
    });
    if (input.mode === 'generate_plan') {
      plannerEventBus.emit({
        type: 'drafting_completed',
        campaign_id: input.campaignId,
        payload: {
          success: draftingSuccess,
          budget_exceeded: draftingBudgetExceeded,
          streamed_partial_chars: streamingAccumulated.length,
          duration_ms: Date.now() - draftingStartedAt,
        },
      });
    }
  }

  // Drafting fallback: if the budget was exceeded OR drafting threw for any
  // other reason without producing output, attempt partial salvage from any
  // raw text we managed to capture. Falls back to a deterministic placeholder
  // if salvage rejects the output. This guarantees the user ALWAYS receives
  // a campaign object — never a broken UI. No second drafting attempt is made.
  if (!draftingSuccess && input.mode === 'generate_plan') {
    let salvagedStructured: any = null;
    let partialSalvageUsed = false;
    let salvagedWeekCount = 0;
    if (rawOutput && rawOutput.length > 0 && ctx.planSkeleton) {
      try {
        const salvage = attemptPartialDraftSalvage({
          rawText: rawOutput,
          planSkeleton: ctx.planSkeleton,
          prefilledPlanning: ctx.prefilledPlanning ?? null,
        });
        if (salvage.salvaged && salvage.structured) {
          salvagedStructured = salvage.structured;
          partialSalvageUsed = true;
          salvagedWeekCount = salvage.salvagedWeekCount;
          logger.info('drafting_partial_salvage_accepted', {
            request_id: getRequestContext().requestId,
            campaign_id: input.campaignId,
            salvaged_week_count: salvagedWeekCount,
            total_week_count: salvage.totalWeekCount,
          });
          plannerEventBus.emit({
            type: 'salvage_applied',
            campaign_id: input.campaignId,
            payload: {
              salvaged_week_count: salvagedWeekCount,
              total_week_count: salvage.totalWeekCount,
            },
          });
        } else {
          logger.info('drafting_partial_salvage_rejected', {
            request_id: getRequestContext().requestId,
            campaign_id: input.campaignId,
            reason: salvage.reason,
            salvaged_week_count: salvage.salvagedWeekCount,
            total_week_count: salvage.totalWeekCount,
          });
        }
      } catch (salvageErr) {
        logger.warn('drafting_partial_salvage_failed', {
          request_id: getRequestContext().requestId,
          campaign_id: input.campaignId,
          error: salvageErr instanceof Error ? salvageErr.message : String(salvageErr),
        });
      }
    }

    let placeholderStructured: any = salvagedStructured;
    if (!placeholderStructured) {
      try {
        placeholderStructured = ctx.planSkeleton
          ? buildPlaceholderPlanFromSkeleton({
              skeleton: ctx.planSkeleton,
              prefilledPlanning: ctx.prefilledPlanning ?? null,
            })
          : null;
      } catch (placeholderErr) {
        logger.warn('drafting_placeholder_build_failed', {
          request_id: getRequestContext().requestId,
          campaign_id: input.campaignId,
          error: placeholderErr instanceof Error ? placeholderErr.message : String(placeholderErr),
        });
      }
    }
    recordPlannerAlertCounter('placeholder_fallback');
    logPhase('plan_total', planStartedAt, {
      success: !!placeholderStructured,
      drafting_budget_exceeded: draftingBudgetExceeded,
      overload_active: overloadActive,
      generation_mode: partialSalvageUsed ? 'partial-salvage' : 'fallback-placeholder',
      partial_salvage_used: partialSalvageUsed,
      salvaged_week_count: partialSalvageUsed ? salvagedWeekCount : undefined,
      planner_remaining_ms: plannerBudget.remainingMs(),
    });
    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: {
        ...ctx.omnivyreDecision,
        raw: {
          ...(typeof ctx.omnivyreDecision.raw === 'object' && ctx.omnivyreDecision.raw ? ctx.omnivyreDecision.raw : {}),
          drafting_budget_exceeded: draftingBudgetExceeded || undefined,
          drafting_fallback_used: true,
          partial_salvage_used: partialSalvageUsed || undefined,
          salvaged_week_count: partialSalvageUsed ? salvagedWeekCount : undefined,
          planner_overload_active: overloadActive || undefined,
        },
      },
      plan: placeholderStructured,
      conversationalResponse: undefined,
      raw_plan_text: '',
    };
  }

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
  const parseRecoveryStartedAt = Date.now();
  let parseRecoverySuccess = false;
  let parseRecovery: Awaited<ReturnType<typeof parseStructuredPlanWithRecovery>>;
  try {
    parseRecovery = await parseStructuredPlanWithRecovery({
      companyId: ctx.companyId ?? '',
      inputMode: input.mode,
      raw,
      planText,
      planningInput,
      planSkeleton: ctx.planSkeleton,
      prefilledPlanning: ctx.prefilledPlanning ?? null,
      hasDeterministicPlanSkeleton,
      // Surface parse-repair / skeleton-repair as their own UI substages.
      onSubStage: emitSubStage,
      // Repair phases share a single AbortController inside parseStructuredPlanWithRecovery.
      // Clamp that budget to the global planner budget remaining so we never
      // exceed PLANNER_TOTAL_BUDGET_MS.
      repairBudgetMs: plannerBudget.phaseBudgetMs(
        Math.max(1000, Number(process.env.REPAIR_BUDGET_MS || 30_000)),
      ),
    });
    parseRecoverySuccess = true;
  } finally {
    logPhase('parse_recovery', parseRecoveryStartedAt, {
      success: parseRecoverySuccess,
    });
  }
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
  let alignmentBudgetExceeded = false;
  // PlannerBudget gating: alignment is optional. When the global budget is
  // nearly exhausted, skip the entire alignment phase so refinement (or at
  // least returning the plan) still fits inside the cumulative cap.
  const alignmentAllowed =
    input.mode === 'generate_plan' &&
    plannerBudget.shouldRunOptionalPhase('alignment');
  if (input.mode === 'generate_plan' && !alignmentAllowed) {
    plannerBudget.markPhaseSkipped('alignment', 'global_budget_low');
  }
  if (alignmentAllowed) {
    // ── Alignment phase: hard 45s execution budget across scoring + recovery ──
    // Prevents the UI from sitting on "Scoring strategic alignment" while the
    // backend silently runs 2–3 extra LLM calls. If the budget blows, we keep
    // the current plan and continue to refinement. Local budget is clamped
    // to the global remaining budget so we never exceed PLANNER_TOTAL_BUDGET_MS.
    const alignmentBudgetMs = plannerBudget.phaseBudgetMs(
      Math.max(1000, Number(process.env.ALIGNMENT_BUDGET_MS || 45000)),
    );
    // Full alignment recovery (a second full plan re-draft) is OFF by default.
    // Enable explicitly via ENABLE_ALIGNMENT_RECOVERY=true. When disabled, a
    // low alignment score still attaches a metadata warning, but no expensive
    // synchronous redraft is performed.
    const recoveryEnabled = String(process.env.ENABLE_ALIGNMENT_RECOVERY ?? 'false')
      .toLowerCase() === 'true';

    // Planner overload mode forces recovery off even when the env flag is on,
    // so a burst of users hitting the planner can't compound the LLM load.
    const recoveryEnabledEffective = recoveryEnabled && !overloadActive;

    const alignmentStartedAt = Date.now();
    const requestId = getRequestContext().requestId;

    // AbortController bound to the alignment budget. When the race times out we
    // call `.abort()` and the signal propagates through every LLM call this
    // sequence makes (evaluate + recovery + re-evaluate), cancelling them at
    // the network layer and releasing the gateway semaphore immediately.
    const alignmentController = new AbortController();

    const alignmentSequence = async (): Promise<void> => {
      // ── Step 1: evaluate alignment ─────────────────────────────────────────
      emitSubStage('evaluating-alignment');
      const scoringStartedAt = Date.now();
      let scoringSuccess = false;
      try {
        alignmentResult = await withPhaseHeartbeat(
          () => evaluateWeeklyAlignment({
            campaignId: input.campaignId,
            recommendationContext: input.recommendationContext ?? null,
            campaignStage: ctx.campaignStage ?? null,
            psychologicalGoal: ctx.psychologicalGoal ?? null,
            momentum: ctx.momentum ?? null,
            normalizedWeeks: structured.weeks || [],
            signal: alignmentController.signal,
            pool: 'alignment',
          }),
          {
            substage: 'still-evaluating-alignment',
            onSubStage: emitSubStage,
            signal: alignmentController.signal,
          },
        );
        alignmentScoreForDebug = alignmentResult.alignmentScore;
        scoringSuccess = true;
      } catch (e) {
        logger.warn('alignment_evaluation_failed_accepting_current_plan', {
          request_id: requestId,
          campaign_id: input.campaignId,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        logPhase('alignment_scoring', scoringStartedAt, {
          success: scoringSuccess,
          alignment_score: alignmentScoreForDebug,
        });
      }

      // Surface intermediate granular substages so the UI never sits silently.
      // These are inexpensive emits — no extra LLM calls — they just rename
      // the visible stage as the orchestrator inspects sub-scores.
      if (alignmentResult) {
        emitSubStage('checking-psychological-progression');
        emitSubStage('validating-content-diversity');
      }

      // ── Step 2: optional full plan regeneration on low alignment ──────────
      if (!recoveryEnabledEffective) {
        if (
          alignmentResult &&
          alignmentResult.alignmentScore < ALIGNMENT_ACCEPT_THRESHOLD
        ) {
          logger.info(
            overloadActive
              ? 'alignment_recovery_skipped_overload_mode'
              : 'alignment_recovery_skipped_flag_disabled',
            {
              request_id: requestId,
              campaign_id: input.campaignId,
              alignment_score: alignmentResult.alignmentScore,
              threshold: ALIGNMENT_ACCEPT_THRESHOLD,
              overload_active: overloadActive || undefined,
            },
          );
        }
        return;
      }

      emitSubStage('recovering-low-alignment-sections');
      const recoveryStartedAt = Date.now();
      let recoverySuccess = false;
      try {
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
          signal: alignmentController.signal,
        });
        structured = alignmentRecovery.structured;
        alignmentResult = alignmentRecovery.alignmentResult;
        alignmentScoreForDebug = alignmentRecovery.alignmentScoreForDebug;
        regenerationTriggered =
          regenerationTriggered || alignmentRecovery.regenerationTriggered;
        recoverySuccess = true;
      } catch (e) {
        logger.warn('alignment_recovery_failed_accepting_current_plan', {
          request_id: requestId,
          campaign_id: input.campaignId,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        logPhase('alignment_recovery', recoveryStartedAt, {
          success: recoverySuccess,
          alignment_score: alignmentScoreForDebug,
        });
      }

      // After recovery, surface a re-check substage label. evaluateWeeklyAlignment
      // is already re-invoked INSIDE recoverLowAlignmentPlan when the regen
      // produced a valid plan; no extra LLM call is added here.
      emitSubStage('rechecking-strategic-alignment');
    };

    // Promise.race with a timeout. On timeout we DO NOT abort the in-flight
    // call (Node lacks free cancellation for fetch), but we stop *waiting* for
    // it and continue with the current plan. The orphaned alignment promise
    // resolves later harmlessly — any structured mutation that lands after we
    // moved on is ignored because we have already passed the alignment block.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const budgetSentinel = new Promise<'__alignment_budget_exceeded__'>(
      (resolve) => {
        timeoutHandle = setTimeout(() => {
          // Fire the abort FIRST so the in-flight LLM call is cancelled and
          // the gateway concurrency slot is freed immediately. Then resolve
          // the race so the orchestrator continues to refinement.
          try {
            alignmentController.abort();
          } catch { /* already aborted */ }
          resolve('__alignment_budget_exceeded__');
        }, alignmentBudgetMs);
      },
    );
    try {
      const safeAlignment = alignmentSequence()
        .then(() => '__alignment_completed__' as const)
        .catch((err: unknown) => {
          // alignmentSequence already logs scoring + recovery failures with
          // structured warnings, but defend in depth: any unexpected throw
          // (e.g. a bug in evaluateWeeklyAlignment or recoverLowAlignmentPlan)
          // must not break the planner — we just accept the current plan.
          logger.warn('alignment_sequence_unexpected_error', {
            request_id: requestId,
            campaign_id: input.campaignId,
            error: err instanceof Error ? err.message : String(err),
          });
          return '__alignment_completed__' as const;
        });
      const winner = await Promise.race([safeAlignment, budgetSentinel]);
      if (winner === '__alignment_budget_exceeded__') {
        alignmentBudgetExceeded = true;
        logger.warn('alignment_budget_exceeded_accepting_current_plan', {
          request_id: requestId,
          campaign_id: input.campaignId,
          duration_ms: Date.now() - alignmentStartedAt,
          budget_ms: alignmentBudgetMs,
        });
        recordPlannerAlertCounter('alignment_timeout');
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      logPhase('alignment_total', alignmentStartedAt, {
        budget_exceeded: alignmentBudgetExceeded,
        recovery_enabled: recoveryEnabled,
        alignment_score: alignmentScoreForDebug,
        planner_remaining_ms: plannerBudget.remainingMs(),
      });
      if (alignmentBudgetExceeded) {
        plannerBudget.markPhaseSkipped('alignment', 'budget_exceeded');
      } else {
        plannerBudget.markPhaseCompleted('alignment');
      }
      plannerEventBus.emit({
        type: 'alignment_completed',
        campaign_id: input.campaignId,
        payload: {
          budget_exceeded: alignmentBudgetExceeded,
          alignment_score: alignmentScoreForDebug,
          duration_ms: Date.now() - alignmentStartedAt,
        },
      });
    }

    emitSubStage('continuing-to-refinement');
  }

  if (input.mode === 'generate_plan') {
    // Phase 2B — resolve the authoritative brand voice (runtime when a brand
    // row exists, undefined otherwise). Fail-safe: never blocks planning.
    const brandVoiceOverride = await resolveBrandVoice(ctx.companyId ?? undefined, undefined);
    structured = enrichWeeklyWritingContext({
      structured,
      recommendationContext: input.recommendationContext ?? null,
      prefilledPlanning: effectivePrefilledPlanning,
      campaignStage: ctx.campaignStage ?? null,
      psychologicalGoal: ctx.psychologicalGoal ?? null,
      momentum: ctx.momentum ?? null,
      alignment: alignmentResult,
      brandVoiceOverride,
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
  // SKIP conditions (in priority order):
  //   1. Overload mode active — drop the optional refinement LLM call to lighten load.
  //   2. PlannerBudget says no — global wall-clock is almost exhausted; refinement
  //      is the first optional phase to drop per the policy in PlannerBudget.
  // The plan is still saved with the alignment-recovered structure; we just
  // don't run the extra language-refinement LLM call.
  // Refinement gate (in stricter-wins order):
  //   1. Mode must be generate_plan AND structured weeks must exist.
  //   2. Local overload off.
  //   3. Cluster overload policy permits refinement.
  //   4. PlannerBudget says the global wall-clock has room.
  //   5. Cost guidance says refinement is worth it.
  // Any single "no" skips inline refinement (and async-offload).
  const refinementAllowed =
    input.mode === 'generate_plan' &&
    Array.isArray(structured?.weeks) &&
    structured.weeks.length > 0 &&
    !overloadActive &&
    clusterPolicy.refinementEnabled &&
    plannerBudget.shouldRunOptionalPhase('refinement') &&
    costGuidance.shouldRefine;
  // ── Async refinement branch ──────────────────────────────────────────────
  // When ASYNC_REFINEMENT_ENABLED=true, enqueue refinement as a BullMQ job
  // and return the base plan immediately. The synchronous request unblocks
  // ~5–15s earlier; the campaign object becomes richer when the job persists.
  const { isAsyncRefinementEnabled } =
    await import('./campaignAiOrchestrator/asyncRefinement');
  let refinementAsyncEnqueued = false;
  let refinementAsyncJobId: string | null = null;
  if (refinementAllowed && isAsyncRefinementEnabled()) {
    try {
      const enq = await enqueueAsyncRefinement({
        campaignId: input.campaignId,
        planRevisionId: ctx.snapshot_hash || `plan::${input.campaignId}::${planStartedAt}`,
        snapshotHash: ctx.snapshot_hash ?? null,
        companyId: ctx.companyId ?? null,
        rawPlanText: planText,
        distributionStrategy: ctx.distributionStrategy ?? null,
        distributionReason: ctx.distributionReason ?? null,
        prefilledPlanningKey: null,
      });
      refinementAsyncEnqueued = enq.enqueued;
      refinementAsyncJobId = enq.jobId;
    } catch {
      refinementAsyncEnqueued = false;
    }
    if (refinementAsyncEnqueued) {
      plannerBudget.markPhaseSkipped('refinement', 'async_offload');
      logger.info('refinement_async_offloaded', {
        request_id: getRequestContext().requestId,
        campaign_id: input.campaignId,
        job_id: refinementAsyncJobId,
      });
    }
  }
  if (refinementAllowed && !refinementAsyncEnqueued) {
    emitSubStage('refining');
    const refiningStartedAt = Date.now();
    let refiningSuccess = false;
    try {
      structured = await withPhaseHeartbeat(
        () => postProcessGeneratedPlan({
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
        }),
        {
          substage: 'still-refining',
          onSubStage: emitSubStage,
        },
      );
      refiningSuccess = true;
    } finally {
      logPhase('refining', refiningStartedAt, {
        success: refiningSuccess,
        planner_remaining_ms: plannerBudget.remainingMs(),
      });
      if (refiningSuccess) plannerBudget.markPhaseCompleted('refinement');
      else plannerBudget.markPhaseSkipped('refinement', 'error');
    }
  } else if (
    input.mode === 'generate_plan' &&
    Array.isArray(structured?.weeks) &&
    structured.weeks.length > 0
  ) {
    const reason = overloadActive ? 'overload_mode' : 'global_budget_low';
    logger.info('refining_skipped', {
      request_id: getRequestContext().requestId,
      campaign_id: input.campaignId,
      reason,
      planner_remaining_ms: plannerBudget.remainingMs(),
    });
    plannerBudget.markPhaseSkipped('refinement', reason);
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

  const repairBudgetExceededFinal = !!(parseRecovery && parseRecovery.repairBudgetExceeded);
  if (fallbackTriggered) {
    recordPlannerAlertCounter('placeholder_fallback');
  }
  if (plannerBudget.isExceeded()) {
    recordPlannerAlertCounter('planner_total_budget_exceeded');
  }
  if (input.mode === 'generate_plan') {
    plannerEventBus.emit({
      type: 'plan_created',
      campaign_id: input.campaignId,
      plan_revision_id: ctx.snapshot_hash ?? null,
      payload: {
        generation_mode: generationMode,
        alignment_score: alignmentScoreForDebug,
        regeneration_triggered: regenerationTriggered,
        fallback_triggered: fallbackTriggered,
        async_refinement_enqueued: refinementAsyncEnqueued,
        async_refinement_job_id: refinementAsyncJobId,
        duration_ms: Date.now() - planStartedAt,
      },
    });
  }
  logPhase('plan_total', planStartedAt, {
    success: true,
    alignment_score: alignmentScoreForDebug,
    alignment_budget_exceeded: alignmentBudgetExceeded,
    drafting_budget_exceeded: draftingBudgetExceeded,
    repair_budget_exceeded: repairBudgetExceededFinal,
    overload_active: overloadActive,
    regeneration_triggered: regenerationTriggered,
    fallback_triggered: fallbackTriggered,
    generation_mode: generationMode,
    planner_budget_snapshot: plannerBudget.snapshot(),
  });
  // Telemetry: emit plan latency histograms so dashboards can plot
  // p50/p95/p99 without log-based metrics.
  try {
    const { histogramMs } = require('./plannerTelemetry') as typeof import('./plannerTelemetry');
    const totalMs = Date.now() - planStartedAt;
    histogramMs('planner_p95_latency_ms', totalMs, { mode: generationMode });
    histogramMs('planner_p99_latency_ms', totalMs, { mode: generationMode });
  } catch { /* telemetry must not break the planner */ }

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
        alignment_budget_exceeded: alignmentBudgetExceeded || undefined,
        drafting_budget_exceeded: draftingBudgetExceeded || undefined,
        repair_budget_exceeded: repairBudgetExceededFinal || undefined,
        planner_overload_active: overloadActive || undefined,
        planner_total_budget_exceeded: plannerBudget.isExceeded() || undefined,
        async_refinement_enqueued: refinementAsyncEnqueued || undefined,
        async_refinement_job_id: refinementAsyncJobId || undefined,
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
  // PMF-005 — platform path (flag-gated). The Campaign Planner AIA agent orchestrates
  // the capability graph; the definitive plan is produced by the existing engine
  // (executeRunCampaignAiPlan) inside the AIC pipeline, and the exact plan is served
  // (parity) with a safety net to the engine directly. Default 'legacy' = unchanged.
  if (shouldRunPlatform()) {
    const { runCampaignPlanViaPlatform } = await import('./campaignCapability/campaignPlatformRuntime');
    return runCampaignPlanViaPlatform<CampaignAiPlanResult>({
      companyId: (input as { companyId?: string }).companyId ?? '',
      generate: () => executeRunCampaignAiPlan(input, runWithContext),
      correlationId: input.campaignId,
    });
  }
  return executeRunCampaignAiPlan(input, runWithContext);
}
