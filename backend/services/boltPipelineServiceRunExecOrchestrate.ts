/** BOLT pipeline — full-run orchestration + entrypoints — split from boltPipelineServiceRunExec.ts (barrel preserved; importers unchanged). */
/** BOLT pipeline — weekly-structure execution + entrypoints — split from boltPipelineServiceRun.ts (barrel preserved; importers unchanged). */
/** TEMP — split from boltPipelineService.ts (barrel preserved; importers unchanged). */
import { WORKER_PROVENANCE } from '../../observability/runtime/workerProvenance';
import { ownedDbTable } from '../db/writeOwner';
import { trackEvent } from './telemetry/telemetryDispatcher';
/**
 * BOLT Pipeline Service
 *
 * Orchestrates the BOLT async execution pipeline stages.
 * Each stage updates bolt_execution_runs and logs to bolt_execution_events.
 * Supports idempotent stage execution, campaign state guards, retry, and timeouts.
 */

import { supabase } from '../db/supabaseClient';

import { getProfile } from './companyProfileService';
import { runCampaignAiPlan } from './campaignAiOrchestrator';
import { saveStructuredCampaignPlan, commitDraftBlueprint } from '../db/campaignPlanStore';
import { fromStructuredPlan } from './campaignBlueprintAdapter';
import { scheduleStructuredPlan } from './structuredPlanScheduler';
import { retryWithBackoff } from '../utils/retryWithBackoff';
import { getUserFriendlyMessage } from '../utils/userFriendlyErrors';
import { getConnectedPlatformsForCompany, CONTENT_PLATFORM_AFFINITY } from '../utils/platformEligibility';
import { sanitizeBoltPlanForTextOnly } from '../utils/boltTextContentConfig';
import { sanitizeBoltPlanForCombined } from '../../lib/shared/bolt/sanitizeBoltPlanForCombined';
import { filterConnectedPlatformsForContent } from '../../lib/shared/social/platformContentFilter';
import { aggregateBoltAiMetrics } from './boltMetricsAggregator';
import { getBlueprintCacheMetrics } from './contentBlueprintCache';
import { getAdaptiveDistributionAdjustments } from './campaignAdaptiveOptimizer';
import {
  determinePostsPerWeek,
  momentumScoreToLevel,
  pressureConfigToLevel,
} from './postDensityEngine';
import { generateWeeklyStructure } from './generateWeeklyStructureService';
import {
  getStoredStrategicThemeTitle,
  normalizeStoredStrategicTheme,
} from '../../lib/recommendationStrategicCard';
import {
  getExecutionProfile,
  isLegacyMediaProfile,
  withBoltMetadata,
} from '../../variants/bolt/boltCampaignMetadata';
import {
  getCreatorFormatsFromExecutionConfig,
  getUnsupportedCreatorFormats,
  getCreatorCampaignAggregate,
  isAutonomousRenderableFormat,
  isAttachmentRequiredFormat,
  validateCreatorScheduleRequest,
  type CreatorCampaignAggregate,
} from '../../lib/shared/creatorGovernanceRegistry';
import {
  runCreatorAssetGenerationRuntime,
  type CreatorAssetGenerationMode,
  type CreatorAssetGenerationResult,
} from './creatorAssetGenerationRuntime';
import {
  persistPipelineFailure,
  deriveBoltCampaignType,
  type BoltPipelineMode,
  type BoltCampaignType,
} from './boltPipelineFailurePersistence';
import { captureStrategySnapshot } from '../../lib/shared/bolt/captureStrategySnapshot';
import { assertValidBoltBlueprint } from '../../lib/shared/bolt/validateBoltBlueprint';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { FORMAT_EXCLUSIVE_PLATFORMS } from '../../lib/shared/bolt/formatPlatformBinding';
// Phase 6G-1 — canonical content↔platform assignment authority (derive, don't duplicate).
import { filterPlatformsForFormat, getSupportedPlatformsForFormat } from '../../lib/shared/bolt/contentPlatformAssignment';
import {
  MAX_CAMPAIGN_DURATION_WEEKS,
  MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
} from '../../lib/shared/campaignDuration';
// Phase 6D-B — Intelligent Mix plan-generation reuses the 6D-A intelligence resolver.
import {
  resolveIntelligenceContext,
  formatIntelligenceForPlanning,
  normalizePlanningIntelligenceMode,
  shouldResolvePlanningIntelligence,
  shouldEnrichPlanning,
} from '../../lib/shared/intelligence/resolveIntelligenceContext';
// Phase 6D-C / 6E-2 — adaptive platform prioritization (ordering only; eligibility untouched).
// Re-pointed to the company-scoped aggregator so new campaigns have data.
import {
  rankPlatformsByCompanyPerformance,
  rankContentTypesByCompanyPerformance,
} from './companyPerformanceAggregator';
import {
  orderPlatformsForIntelligentMix,
  normalizePlatformPriorityMode,
  shouldPrioritizePlatforms,
} from '../../lib/shared/intelligence/platformOrdering';
// Phase 6D-D1 — format preference intelligence (ordering only; counts untouched).
import { getMarketingMemoriesByType } from './marketingMemoryService';
import {
  orderFormatsForIntelligentMix,
  extractFormatSignalsFromMemory,
  normalizeFormatPriorityMode,
  shouldPrioritizeFormats,
} from '../../lib/shared/intelligence/formatOrdering';
import { withBlueprintSaveGuard } from './boltPersistenceGuards';
import {
  acquireRunLock,
  extendRunLock,
  releaseRunLock,
  DEFAULT_LOCK_TTL_MS,
} from './boltExecutionLock';

import { AI_PLAN_TIMEOUT_MS, GENERATE_WEEKLY_TIMEOUT_MS, GENERATE_WEEKLY_HEARTBEAT_MS, withTimeout, type BoltStage, type BoltPayload, updateRun, logEvent, checkStageCompleted, getCompletedStagePlan, assertCampaignValid, runSourceRecommendation } from './boltPipelineServiceModel';

import { runAiPlan, runCommitPlan } from './boltPipelineServiceRunPlan';

import { runGenerateWeeklyStructure, runScheduleStructuredPlan, STAGES, validateExecutionConfig } from './boltPipelineServiceRunExecWeekly';

async function executeBoltPipelineRuntime(runId: string): Promise<void> {
  // Wall-clock anchor for `failed_after_ms`. Captured before any DB work so
  // even pre-validation failures get a meaningful elapsed-time stamp.
  const runStartedAt = Date.now();

  const { data: run, error: fetchError } = await ownedDbTable('bolt_execution_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (fetchError || !run) {
    throw new BoltError(
      BOLT_ERROR_CODES.RUN_NOT_FOUND,
      `BOLT run not found: ${runId}`,
      { details: { run_id: runId } }
    );
  }

  const status = (run as { status?: string }).status;
  // Terminal states never re-enter. Note: 'running' is NO LONGER a
  // bail-out condition — we use the lock for liveness instead, so a
  // crashed worker that left status='running' but lapsed its lock can
  // be recovered by the next attempt.
  if (status === 'failed' || status === 'completed' || status === 'cancelled') {
    return;
  }

  // ── Atomic lock claim with stale-lock recovery ─────────────────────
  // Replaces the prior `status === 'running'` soft guard. The previous
  // guard had no expiry, so a crashed worker permanently locked the run.
  // acquireRunLock atomically claims when nobody holds a non-expired
  // lock, generates a token we present on every subsequent extend /
  // release, and refreshes heartbeat at the same time.
  const lock = await acquireRunLock(runId, DEFAULT_LOCK_TTL_MS);
  if (!lock) {
    // A live worker already holds a valid lock. Back off silently —
    // this is the normal "BullMQ also fired the same job" case.
    return;
  }

  // Set status='running' AFTER claiming the lock so observers see the
  // running state only when there's a live worker to back it.
  await updateRun(runId, { status: 'running' });

  const payload = run.payload as BoltPayload;
  const { companyId, outcomeView } = payload;
  // Stamped on every failure persistence so dashboards can filter
  // "show me all bolt-text schedule-view failures from this week".
  const pipelineMode: BoltPipelineMode = (outcomeView ?? 'week_plan') as BoltPipelineMode;
  const campaignType: BoltCampaignType = deriveBoltCampaignType(payload.executionConfig);
  // Captured up-front so every catch site can attach it without rebuilding.
  // Eligible-platforms isn't known yet; we re-capture later with that field
  // included for the per-stage catches that fire after platform resolution.
  const siblingDifferential = (payload as { sibling_differential?: {
    has_siblings: boolean;
    sibling_count: number;
    latest_succeeded_sibling_run_id: string | null;
    differs_from_succeeded_sibling: string[];
    differs_from_failed_sibling: string[];
  } }).sibling_differential ?? undefined;
  let strategySnapshot = {
    ...captureStrategySnapshot({
      executionConfig: payload.executionConfig,
      sourceStrategicTheme: payload.sourceStrategicTheme,
      outcomeView: payload.outcomeView ?? null,
      sourceOpportunityId: payload.sourceOpportunityId ?? null,
      sourceRecommendationId: payload.recId ?? null,
      regionsFromCard: payload.regionsFromCard ?? null,
    }),
    ...(siblingDifferential ? { sibling_differential: siblingDifferential } : {}),
  };
  const executionProfile = getExecutionProfile(payload.executionConfig);
  if (executionProfile === 'creator') {
    const formats = getCreatorFormatsFromExecutionConfig(payload.executionConfig);
    const unsupportedFormats = getUnsupportedCreatorFormats(formats);
    if (unsupportedFormats.length > 0) {
      const err = new Error(`Unsupported creator format: ${unsupportedFormats.join(', ')}`);
      await persistPipelineFailure({
        runId, stage: 'pre-validate-creator-format', error: err,
        runStartedAt, pipelineMode, campaignType,
        companyId, strategySnapshot,
      });
      // Release the lock so a fast-failing validation doesn't hold the
      // row in "running with valid lock" for the full TTL.
      await releaseRunLock(runId, lock.token);
      throw err;
    }
    const scheduleValidation = validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView,
      executionConfig: payload.executionConfig,
    });
    if (scheduleValidation.ok === false) {
      const err = new Error(scheduleValidation.message);
      await persistPipelineFailure({
        runId, stage: 'pre-validate-creator-schedule', error: err,
        runStartedAt, pipelineMode, campaignType,
        companyId, strategySnapshot,
      });
      await releaseRunLock(runId, lock.token);
      throw err;
    }
  }
  const usesUnifiedMediaFlow = executionProfile === 'creator';
  const usesLegacyMediaFlow = isLegacyMediaProfile(executionProfile);
  const requiresMediaFlow = usesUnifiedMediaFlow || usesLegacyMediaFlow;
  // Combined mode: text + creator formats together. Scheduling applies to the text portion only.
  const isCombined = executionProfile === 'combined';
  // ── Phase 1 — Intelligent Mix (combined) mixed-lane activation (G1/G2) ───
  // Intelligent Mix reuses the existing first-class `combined` mode. A
  // combined campaign carries BOTH text and creator formats, so it must:
  //   G1 — retain creator/image/carousel/video formats through blueprint
  //        commit (NOT be sanitised down to text-only), and
  //   G2 — run the creator asset-generation stage.
  // These flags are intentionally SEPARATE from usesUnifiedMediaFlow, which
  // stays `=== 'creator'`. The scheduler keys its lane routing off
  // campaign_mode === 'creator' and `shouldSchedule` keys off requiresMediaFlow,
  // so BOTH remain unchanged — a combined campaign is still scheduled through
  // the text lane in Phase 1. Per-row scheduler routing is Phase 2.
  const runsCreatorGeneration = usesUnifiedMediaFlow || isCombined;
  const preserveCreatorBlueprint = requiresMediaFlow || isCombined;
  const creatorFormats = runsCreatorGeneration
    ? getCreatorFormatsFromExecutionConfig(payload.executionConfig)
    : [];
  // ── Per-row eligibility (replaces the old campaign-wide veto) ─────────────
  // We classify EACH format independently. Autonomous formats render and
  // schedule on their own. Attachment-required formats produce a theme
  // treatment + creator guidance and wait in `awaiting_media_upload` for a
  // user-uploaded media URL — they no longer poison the rest of the campaign.
  // The previous code collapsed Row[] → boolean (`hasGuidanceOnlyCreatorFormats`)
  // and used that to downgrade the whole campaign to RENDER_ONLY; that
  // category error is removed here.
  const rowEligibility = creatorFormats.map((format) => ({
    format,
    is_autonomous: isAutonomousRenderableFormat(format),
    is_attachment_required: isAttachmentRequiredFormat(format),
  }));
  const hasAutonomousCreatorFormats = rowEligibility.some((row) => row.is_autonomous);
  const hasAttachmentRequiredCreatorFormats = rowEligibility.some((row) => row.is_attachment_required);
  const creatorCampaignAggregate: CreatorCampaignAggregate = runsCreatorGeneration
    ? getCreatorCampaignAggregate(creatorFormats)
    : 'empty';
  const wantsSchedule = outcomeView === 'schedule' || outcomeView === 'campaign_schedule';

  // The generation runtime mode is purely a HINT to the runtime about what
  // mix to expect; it no longer gates anything. The runtime evaluates each
  // row independently and decides render vs. theme-treatment per row.
  const creatorExecutionMode: CreatorAssetGenerationMode | null = runsCreatorGeneration
    ? (hasAutonomousCreatorFormats && hasAttachmentRequiredCreatorFormats)
      ? 'MIXED'
      : hasAutonomousCreatorFormats
        ? (wantsSchedule ? 'SCHEDULE_AND_RENDER' : 'RENDER_ONLY')
        : hasAttachmentRequiredCreatorFormats
          ? 'ATTACHMENT_ONLY'
          : 'RENDER_ONLY'
    : null;

  // Run the creator asset generation stage whenever there's at least one
  // creator format and the user wanted more than a week plan. The stage
  // itself decides per row whether to render or emit awaiting_media_upload.
  const shouldRunCreatorAssetGeneration =
    runsCreatorGeneration &&
    outcomeView !== 'week_plan' &&
    creatorFormats.length > 0;

  // shouldSchedule fires when the user asked to schedule AND there is at
  // least one row that can be scheduled NOW. Autonomous rows count as
  // schedulable; attachment-required rows do not block scheduling — they
  // simply stay in `awaiting_media_upload` until the user uploads media.
  const shouldSchedule = wantsSchedule && (
    (usesUnifiedMediaFlow && hasAutonomousCreatorFormats) ||
    (!requiresMediaFlow)
  );
  const isWeekPlanOnly = outcomeView === 'week_plan';

  const missing = validateExecutionConfig(
    payload.executionConfig,
    isCombined ? MAX_CAMPAIGN_DURATION_WEEKS : MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
  );
  if (missing.length > 0) {
    const invalidDuration = missing.includes('campaign_duration_invalid');
    const filtered = missing.filter((m) => m !== 'campaign_duration_invalid');
    const msg = invalidDuration
      ? `BOLT execution blocked. Campaign duration must be 1–4 weeks.${filtered.length > 0 ? ` Missing: ${filtered.join(', ')}` : ''}`
      : `BOLT execution blocked. Missing execution inputs: ${missing.join(', ')}`;
    const err = new Error(msg);
    await persistPipelineFailure({
      runId, stage: 'validate-execution-config', error: err,
      runStartedAt, pipelineMode, campaignType,
      companyId, strategySnapshot,
    });
    await releaseRunLock(runId, lock.token);
    throw err;
  }

  let eligiblePlatforms: string[] = [];
  try {
    // Use the same "connected at company admin level" source the BOLT picker
    // endpoint uses (social_accounts, with profile-URL fallback). Both must
    // agree, otherwise selected_platforms gets intersected to a smaller set
    // than the user saw in the picker and platforms silently disappear.
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false }).catch(() => null);
    const rawPlatforms = await getConnectedPlatformsForCompany(companyId, profile);
    // Creator and Combined campaigns include all platforms (multi-capability).
    // Text-only BOLT routes through the canonical capability filter so any
    // non-text-capable platform (Instagram/Pinterest/TikTok/YouTube) is
    // excluded by the same rules as the publish validator and UI picker.
    eligiblePlatforms = (requiresMediaFlow || isCombined)
      ? rawPlatforms
      : filterConnectedPlatformsForContent(rawPlatforms, { workflowType: 'text' }).supported;

    // Honor execConfig.selected_platforms (per-campaign platform picker from the
    // BOLT Text strategy builder). Intersect with eligiblePlatforms so the user
    // can narrow scope but never target unconfigured platforms.
    const rawSelected = (payload.executionConfig as Record<string, unknown> | undefined)?.selected_platforms;
    const selectedList = Array.isArray(rawSelected)
      ? rawSelected
          .map((p) => String(p ?? '').trim().toLowerCase().replace(/^twitter$/i, 'x'))
          .filter(Boolean)
      : [];
    if (selectedList.length > 0 && eligiblePlatforms.length > 0) {
      const narrowed = eligiblePlatforms.filter((p) => selectedList.includes(p.toLowerCase()));
      if (narrowed.length > 0) eligiblePlatforms = narrowed;
    }
    console.log('[bolt] eligiblePlatforms resolved', {
      companyId,
      connected: rawPlatforms,
      selected_platforms: selectedList,
      eligible: eligiblePlatforms,
    });
    // Refresh the strategy snapshot now that eligible_platforms is known.
    // Catch sites that fire AFTER this point will attach the richer
    // snapshot to bolt_failure_summary, giving operators the platform
    // narrowing for differential diagnosis.
    strategySnapshot = {
      ...captureStrategySnapshot({
        executionConfig: payload.executionConfig,
        sourceStrategicTheme: payload.sourceStrategicTheme,
        outcomeView: payload.outcomeView ?? null,
        sourceOpportunityId: payload.sourceOpportunityId ?? null,
        sourceRecommendationId: payload.recId ?? null,
        regionsFromCard: payload.regionsFromCard ?? null,
        eligiblePlatforms,
      }),
      ...(siblingDifferential ? { sibling_differential: siblingDifferential } : {}),
    };
  } catch (err) {
    console.error('[bolt] Failed to resolve eligible platforms', err);
    eligiblePlatforms = [];
  }

  const totalStages = isWeekPlanOnly
    ? 3  // source-recommendation, ai/plan, commit-plan — stops at blueprint
    : shouldSchedule
      ? STAGES.length
      : shouldRunCreatorAssetGeneration
        ? STAGES.length - 1
        : STAGES.length - 2;
  // Platforms required for scheduling; generate-weekly-structure falls back to linkedin if none configured
  const needsPlatformsForContent = shouldSchedule;
  if (needsPlatformsForContent && eligiblePlatforms.length === 0) {
    const msg =
      'No social platforms configured for this company. Add platform URLs (LinkedIn, Instagram, X, etc.) in the company profile before generating or scheduling content.';
    const err = new Error(msg);
    await persistPipelineFailure({
      runId, stage: 'validate-platforms', error: err,
      runStartedAt, pipelineMode, campaignType,
      companyId, strategySnapshot,
    });
    await releaseRunLock(runId, lock.token);
    throw err;
  }

  let campaignId: string | null = null;
  let plan: { weeks: unknown[] } | null = null;
  let weeksGenerated = 0;
  let dailySlotsCreated = 0;
  let scheduledPostsCreated = 0;
  let creatorAssetGenerationResult: CreatorAssetGenerationResult | null = null;

  const getProgress = (stageIndex: number) => Math.round((stageIndex / totalStages) * 100);

  try {
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      if (stage === 'creator-asset-generation' && !shouldRunCreatorAssetGeneration) continue;
      if (stage === 'schedule-structured-plan' && !shouldSchedule) continue;
      // Note: generate-weekly-structure now runs even for week_plan so that
      // daily_content_plans rows (activity cards) are created and visible
      // on the campaign detail page.

      // ── Cancellation checkpoint ────────────────────────────────────
      // Polled between stages, NOT mid-stage. Mid-stage cancellation
      // would risk leaving daily_content_plans / scheduled_posts in
      // partial state — between-stage gives us a clean boundary.
      // The campaign's already-completed stages are preserved; we
      // mark remaining stages as skipped on the way out.
      const { data: cancelCheck } = await ownedDbTable('bolt_execution_runs')
        .select('cancel_requested')
        .eq('id', runId)
        .maybeSingle();
      if ((cancelCheck as { cancel_requested?: boolean } | null)?.cancel_requested) {
        await updateRun(runId, {
          status: 'cancelled',
          error_message: 'Cancelled by user',
        });
        await logEvent(runId, stage, 'cancelled', { campaign_id: campaignId ?? undefined });
        await releaseRunLock(runId, lock.token);
        return;
      }

      // ── Lock extension ──────────────────────────────────────────────
      // Push the lock expiry forward at the start of every stage so a
      // long AI plan call (up to 120s × retries) can't let the lock
      // lapse mid-stage and invite a second worker. Token-checked, so
      // if our lock has already been stolen by stale-recovery we hit
      // the failure path with a clean message.
      const lockStillOurs = await extendRunLock(runId, lock.token, DEFAULT_LOCK_TTL_MS);
      if (!lockStillOurs) {
        // Another worker took over via stale-lock recovery. Bail
        // silently — the other worker is the source of truth now.
        return;
      }

      if (campaignId) {
        try {
          await assertCampaignValid(campaignId);
        } catch (guardErr) {
          // Aborted path (campaign was deleted mid-run, etc.) — still
          // capture raw cause so operators can tell why the run gave up.
          // We re-set status='aborted' AFTER persistPipelineFailure to
          // preserve the "aborted vs failed" distinction the UI relies on.
          await persistPipelineFailure({
            runId, stage, error: guardErr,
            runStartedAt, pipelineMode, campaignType, campaignId,
            companyId, strategySnapshot,
          });
          await updateRun(runId, { status: 'aborted' });
          return;
        }
      }

      const stageToCheck = stage === 'generate-weekly-structure' ? null : stage;
      if (stageToCheck && (await checkStageCompleted(runId, stageToCheck))) {
        if (stage === 'source-recommendation') {
          const { data: runRow } = await ownedDbTable('bolt_execution_runs')
            .select('campaign_id')
            .eq('id', runId)
            .maybeSingle();
          const cid = (runRow as { campaign_id?: string } | null)?.campaign_id;
          if (cid) campaignId = cid;
        } else if (stage === 'ai/plan' && campaignId) {
          const cached = await getCompletedStagePlan(runId, stage);
          if (cached) plan = cached;
        }
        continue;
      }

      const isGenerateWeekly = stage === 'generate-weekly-structure';
      const stageStart = Date.now();
      // Always update current_stage so the progress bar reflects the real-time stage.
      // generate-weekly-structure also needs this so the UI doesn't get stuck on the previous stage.
      await updateRun(runId, {
        current_stage: stage,
        status: 'running',
        progress_percentage: getProgress(i),
      });
      if (!isGenerateWeekly) {
        await logEvent(runId, stage, 'started', {
          campaign_id: campaignId ?? undefined,
        });
      }

      try {
        if (stage === 'source-recommendation') {
          if (payload.generatedCampaignId) {
            await assertCampaignValid(payload.generatedCampaignId);
          }
          campaignId = await runSourceRecommendation(runId, payload);
          await updateRun(runId, { campaign_id: campaignId, progress_percentage: getProgress(i + 1) });
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
          });
        } else if (stage === 'ai/plan' && campaignId) {
          const aiResult = await runAiPlan(runId, campaignId, companyId, payload, eligiblePlatforms, requiresMediaFlow, isCombined);
          plan = aiResult.plan;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            weeksCount: plan.weeks.length,
            plan: { weeks: plan.weeks },
          });
        } else if (stage === 'commit-plan' && campaignId && plan) {
          // Part 5 — blueprint guard. Runs BEFORE the structured plan
          // is committed so malformed AI output never reaches
          // generate-weekly-structure with rows that will silently
          // skip or fail with a generic message. Throws a BoltError
          // whose code is one of the BLUEPRINT_* family; the per-stage
          // catch picks it up and persistPipelineFailure surfaces it.
          //
          // Regression fix: text-mode runs pass through
          // `sanitizeBoltPlanForTextOnly` inside runCommitPlan (line ~814),
          // which strips/converts excluded content types (blog, video,
          // reel, …) into BOLT-text formats. The validator must see the
          // SAME post-sanitiser plan, otherwise it rejects values the
          // sanitiser would have cleaned up (observed: `blog` rejected
          // → BLUEPRINT_INVALID_CONTENT_TYPE → BLUEPRINT_SAVE_FAILED
          // friendly message). Pre-sanitise here, then hand the original
          // plan to runCommitPlan (which sanitises again — idempotent).
          // Combined: sanitize unsupported content types (e.g. blog → article)
          // while PRESERVING creator formats — the AI planner occasionally emits
          // a BOLT-excluded type that the validator would otherwise reject. Text:
          // the existing text-only sanitiser. Validate AND commit the SAME
          // sanitized plan so downstream never sees an excluded type.
          const planForValidation = preserveCreatorBlueprint
            ? { weeks: sanitizeBoltPlanForCombined(plan.weeks) }
            : { weeks: sanitizeBoltPlanForTextOnly(plan.weeks) };
          assertValidBoltBlueprint(planForValidation);
          await runCommitPlan(
            campaignId,
            preserveCreatorBlueprint ? planForValidation : plan,
            payload.executionConfig as Record<string, unknown>,
            preserveCreatorBlueprint,
          );
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
          });
        } else if (stage === 'generate-weekly-structure' && campaignId && plan) {
          const theme = payload.sourceStrategicTheme as Record<string, unknown> | undefined;
          const execConfig = payload.executionConfig as Record<string, unknown> | undefined;
          const tentativeStart = execConfig?.tentative_start as string | undefined;
          const campaignStartDate =
            tentativeStart && String(tentativeStart).trim()
              ? String(tentativeStart).includes('T')
                ? String(tentativeStart)
                : `${String(tentativeStart).trim()}T00:00:00.000Z`
              : undefined;

          const momentumLevel = momentumScoreToLevel(theme?.momentum_score as number | undefined);
          const pressureLevel = pressureConfigToLevel(execConfig?.pressure as string | undefined);

          let postsPerWeek: number;
          const rawFreq = execConfig?.frequency_per_week;
          let parsedFreq: number | null = null;
          if (typeof rawFreq === 'number' && rawFreq > 0 && isFinite(rawFreq)) {
            parsedFreq = Math.round(rawFreq);
          } else if (typeof rawFreq === 'string') {
            const s = rawFreq.trim().toLowerCase();
            const p = s === 'daily' ? 7 : parseInt(rawFreq, 10);
            if (!isNaN(p) && p > 0) parsedFreq = p;
          }
          if (parsedFreq !== null) {
            postsPerWeek = parsedFreq;
          } else {
            postsPerWeek = determinePostsPerWeek({
              campaignDurationWeeks: plan.weeks.length,
              momentumLevel,
              pressureLevel,
            });
          }
          postsPerWeek = Math.min(Math.max(postsPerWeek, 1), 20);
          const summary = await runGenerateWeeklyStructure(
            runId,
            campaignId,
            companyId,
            plan.weeks,
            (u) => updateRun(runId, u),
            (rid, s, st, m) => logEvent(rid, s, st, m),
            {
              eligiblePlatforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
              postsPerWeek,
              campaignStartDate,
              boltTextOnly: !requiresMediaFlow && !isCombined,
              execConfig: execConfig ?? undefined,
            }
          );
          weeksGenerated = plan.weeks.length;
          dailySlotsCreated = summary.dailySlotsCreated;
        } else if (stage === 'creator-asset-generation' && campaignId) {
          creatorAssetGenerationResult = await runCreatorAssetGenerationRuntime({
            campaignId,
            companyId,
            userId: payload.userId ?? null,
            mode: creatorExecutionMode ?? 'RENDER_ONLY',
            onProgress: (progressStage) => updateRun(runId, { current_stage: progressStage }),
            runId,
          });
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            mode: creatorAssetGenerationResult.mode,
            rendered_count: creatorAssetGenerationResult.rendered_count,
            guidance_ready_count: creatorAssetGenerationResult.guidance_ready_count,
            skipped_count: creatorAssetGenerationResult.skipped_count,
            failed_count: creatorAssetGenerationResult.failed_count,
            final_status: creatorAssetGenerationResult.final_status,
          });
        } else if (stage === 'schedule-structured-plan' && campaignId && plan) {
          const scheduleResult = await runScheduleStructuredPlan(
            campaignId,
            plan,
            payload.executionConfig,
            executionProfile,
            (s) => updateRun(runId, { current_stage: s }),
            eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
            runId
          );
          scheduledPostsCreated = scheduleResult.scheduled_count;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            scheduled_count: scheduleResult.scheduled_count,
          });
        }
      } catch (stageErr) {
        // Single instrumentation entry: writes raw + friendly to the run,
        // emits the standardized `[bolt/pipeline-error]` log line, and
        // inserts a `failed` event with raw fields in metadata. Never
        // throws — we still re-raise the ORIGINAL stageErr below so
        // upper-level handling stays identical.
        await persistPipelineFailure({
          runId,
          stage,
          error: stageErr,
          runStartedAt,
          stageStartedAt: stageStart,
          pipelineMode,
          campaignType,
          campaignId,
          companyId,
          strategySnapshot,
        });
        throw stageErr;
      }
    }

    const planWeeksCount = plan?.weeks?.length ?? 0;
    let aiMetrics: Partial<{
      ai_calls_total: number;
      ai_tokens_input: number;
      ai_tokens_output: number;
      distribution_batches: number;
      variant_batches: number;
      ai_cost_usd: number;
      stage_campaign_plan_cost: number;
      stage_distribution_cost: number;
      stage_blueprint_cost: number;
      stage_variant_cost: number;
      blueprint_cache_hits: number;
      blueprint_cache_misses: number;
      cache_hit_ratio: number;
    }> = {};
    try {
      const metrics = await aggregateBoltAiMetrics(runId);
      aiMetrics = {
        ai_calls_total: metrics.ai_calls_total,
        ai_tokens_input: metrics.ai_tokens_input,
        ai_tokens_output: metrics.ai_tokens_output,
        distribution_batches: metrics.distribution_batches,
        variant_batches: metrics.variant_batches,
        ai_cost_usd: metrics.ai_cost_usd,
        stage_campaign_plan_cost: metrics.stage_campaign_plan_cost,
        stage_distribution_cost: metrics.stage_distribution_cost,
        stage_blueprint_cost: metrics.stage_blueprint_cost,
        stage_variant_cost: metrics.stage_variant_cost,
      };
      const cacheMetrics = getBlueprintCacheMetrics();
      aiMetrics.blueprint_cache_hits = cacheMetrics.blueprint_cache_hits;
      aiMetrics.blueprint_cache_misses = cacheMetrics.blueprint_cache_misses;
      aiMetrics.cache_hit_ratio = cacheMetrics.cache_hit_ratio;
    } catch (metricsErr) {
      console.warn('[bolt] AI metrics aggregation failed:', (metricsErr as Error)?.message);
    }
    // Mark campaign active now that the pipeline completed successfully.
    // Set current_stage to match the actual outcome so the dashboard reflects the right state.
    if (campaignId) {
      const outcomeStageMap: Record<string, string> = {
        week_plan: 'week_plan',
        daily_plan: 'daily_plan',
        schedule: 'schedule',
        campaign_schedule: 'schedule',
      };
      const finalStage = creatorAssetGenerationResult?.final_status
        ?? outcomeStageMap[String(payload.outcomeView ?? '')]
        ?? 'week_plan';
      await ownedDbTable('campaigns')
        .update({ status: 'active', current_stage: finalStage, updated_at: new Date().toISOString() })
        .eq('id', campaignId);
      // Canonical telemetry (append-only, fail-soft): a campaign was launched
      // (pipeline completed → status active). Deduped per campaign id.
      trackEvent({
        type: 'campaign.launched',
        organizationId: companyId,
        actorId: payload.userId ?? null,
        entityId: campaignId,
        metadata: eligiblePlatforms.length > 0 ? { platforms: eligiblePlatforms } : {},
      });
    }
    await updateRun(runId, {
      status: 'completed',
      progress_percentage: 100,
      result_campaign_id: campaignId ?? undefined,
      error_message: null,
      weeks_generated: weeksGenerated,
      daily_slots_created: dailySlotsCreated,
      scheduled_posts_created: scheduledPostsCreated,
      themes_generated: 1,
      weekly_plan_items: planWeeksCount,
      content_variants_generated: creatorAssetGenerationResult
        ? creatorAssetGenerationResult.rendered_count + creatorAssetGenerationResult.guidance_ready_count
        : dailySlotsCreated,
      expected_content_items: dailySlotsCreated,
      actual_posts_published: scheduledPostsCreated,
      ...aiMetrics,
    });

    // Success completion event. Closes the lifecycle correlation arc
    // started at `bolt_worker_pickup`: a single run_id can now be
    // traced from enqueue → pickup → plan-input → plan-result →
    // completed across logs without DB polling. Single emission per
    // run; minimal payload.
    {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitStructuredEvent } = require('../../observability/runtime/structuredTelemetry') as typeof import('../../observability/runtime/structuredTelemetry');
      emitStructuredEvent(
        'bolt_run_completed',
        'info',
        { run_id: runId, planner_stage: 'completed' },
        {
          campaign_id: campaignId ?? null,
          duration_ms: Date.now() - runStartedAt,
          weeks_generated: weeksGenerated,
          daily_slots_created: dailySlotsCreated,
          scheduled_posts_created: scheduledPostsCreated,
        },
      );
    }

    // Success path — release the lock so the row's lock columns
    // reflect "no live worker holds this" and downstream operators
    // know the run is fully terminal.
    await releaseRunLock(runId, lock.token);
  } catch (err) {
    // Outer pipeline safety net. A per-stage catch usually fires first and
    // has already populated the run row, but we ALSO instrument here so any
    // throw outside a stage (post-loop metrics aggregation, campaign-status
    // update, the final updateRun, …) still leaves an operator-queryable
    // record. persistPipelineFailure is safe to call twice — the run row
    // ends up reflecting the last writer, and a second event row makes the
    // double-write visible.
    await persistPipelineFailure({
      runId,
      stage: 'pipeline-outer',
      error: err,
      runStartedAt,
      pipelineMode,
      campaignType,
      campaignId,
      companyId,
      strategySnapshot,
    });
    // Release lock on failure too — keeps stale-lock rows out of the
    // sweeper's queue. Token-checked, so if our lock was already
    // recovered by a successor this is a no-op.
    await releaseRunLock(runId, lock.token);
    throw err;
  }
}

export { executeBoltPipelineRuntime as executeBoltPipeline };

/**
 * Planner-only: runs generate-weekly-structure (same service as BOLT pipeline stage).
 * Blueprint must already be committed via campaignPlanStore before calling.
 * Does not update campaign status (planner-finalize sets execution_ready, blueprint_status committed).
 */
export async function runPlannerCommitAndGenerateWeekly(params: {
  campaignId: string;
  companyId: string;
  plan: { weeks: unknown[] };
  startDate?: string;
}): Promise<void> {
  const blueprint = fromStructuredPlan({ weeks: params.plan.weeks, campaign_id: params.campaignId });
  const durationWeeks = Math.max(1, blueprint.duration_weeks ?? params.plan.weeks.length ?? 1);
  const weekNumbers = (params.plan.weeks as Array<{ week_number?: number; week?: number }>).map(
    (w, i) => Number(w?.week_number ?? w?.week ?? i + 1)
  );
  if (params.startDate) {
    const startVal = String(params.startDate).trim();
    const startDateValue = startVal.includes('T') ? startVal : `${startVal}T00:00:00.000Z`;
    await ownedDbTable('campaigns').update({
      start_date: startDateValue,
      duration_weeks: durationWeeks,
      updated_at: new Date().toISOString(),
    }).eq('id', params.campaignId);
  }
  await generateWeeklyStructure({
    campaignId: params.campaignId,
    companyId: params.companyId,
    weeks: weekNumbers,
  });
}

// `unwrapErrorForLog` was the previous instrumentation helper. It has been
// superseded by `normalizePipelineError` + `persistPipelineFailure`, which
// also persist the raw failure to bolt_execution_runs (raw_error_message,
// error_stack, failed_stage, failed_after_ms, pipeline_mode, campaign_type).
// See `backend/services/boltPipelineFailurePersistence.ts`.



