/** Structured plan scheduler — execution-job + allocation scheduling — split from structuredPlanSchedulerExecWeekly.ts (barrel preserved; importers unchanged). */
/** Structured plan scheduler — weekly structure execution — split from structuredPlanSchedulerExec.ts (barrel preserved; importers unchanged). */
/** Structured plan scheduler — execution — split from structuredPlanScheduler.ts (barrel preserved; importers unchanged). */
import { supabase } from '../db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { recordRowFailureBatch, type RowFailureRecord } from './boltRowFailureDiagnostics';
// `getCreatorGovernance` is already imported below from the creator
// governance registry — kept there to avoid duplicate identifier.

import { getPlatformRules, listPlatformCatalog } from './platformIntelligenceService';
import { generateContentForDailyPlans } from './boltContentGenerationForSchedule';
import { processBlockSchedule } from './boltScheduleBlockProcessor';
import { evaluateScheduleEligibility } from './campaignScheduleEligibilityService';
import { getExecutionEngine } from './executionEngines';
import { deriveCreatorAssetTypeFromIntent } from './creatorTemplateRegistryService';
import { validateCreatorExecutionOutput, validateCreatorSchedulingContract } from './creatorExecutionContracts';
import { validateAssetReadiness } from './creatorAssetValidationService';
import { logCreatorExecutionAudit } from './creatorExecutionAuditService';
import { acquireCreatorExecutionLock, CreatorExecutionLockError, extendCreatorExecutionLease, releaseCreatorExecutionLock } from './creatorExecutionLockService';
import { assertCreatorExecutionWithinRateLimits, CreatorExecutionRateLimitError } from './creatorExecutionRateLimitService';
import { recordCreatorExecutionMetric, upsertCreatorExecutionSummary, writeCreatorDeadLetter } from './creatorExecutionObservabilityService';
import { getContentQueue } from '../queue/contentGenerationQueues';
import type { BoltContentJobData } from '../queue/jobProcessors/boltContentJobProcessor';
import { enqueueScheduledPostAt } from '../scheduler/schedulerService';
import { isQueueOperational } from './queueHealth';
import { logPipelineEvent } from '../../lib/shared/observability';
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import type { CanonicalCreatorOutput, CreatorScheduleResult } from './executionEngines/types';
import { ownedDbTable } from '../db/writeOwner';
import {
  makeScheduledPostIdempotencyKey,
  isIdempotencyCollision,
} from './boltScheduleIdempotency';
import {
  assertCreatorFormatsSchedulable,
  assertNoUnschedulableCreatorDailyPlans,
  getCreatorFormatsFromStructuredPlanWeeks,
  getCreatorGovernance,
  getRowSchedulingEligibility,
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
  CREATOR_LIFECYCLE_STATES,
} from '../../lib/shared/creatorGovernanceRegistry';
import { applyTransition } from '../../lib/shared/creatorLifecycleStateMachine';
import { scheduleCreatorAttachmentPost } from './creator/creatorRowScheduler';
// Phase 2B — Intelligent Mix per-row routing (ACTIVE for combined ONLY).
import { partitionRowsByLane } from '../../lib/shared/bolt/rowSchedulingLane';
import { buildRoutingDiagnostics, emitRoutingDiagnostics } from '../../lib/shared/bolt/boltRoutingPreview';

import { type PlatformNormalizer, buildPlatformAliasMap, normalizePlatform, toDbPlatformKey, toLegacyPlatformKey, enforceScheduleFloor, isLegacyPlan, extractTypeMapFromPlatformRules, toDbContentType, type StructuredWeekBlueprint, type StructuredPlan, extractSchedulableJobsFromWeeks, type DailyPlanRow, sleep, toNumericValue, getCurrentCampaignPlanVersion, classifyCreatorFailure, assertNoUnschedulableCreatorPlanWeeks, startCreatorLeaseHeartbeat, buildScheduledForFromDailyPlan, scheduleFromDailyPlans, scheduleFromExecutionJobs, scheduleFromAllocation, scheduleFromLegacy, type ScheduleStructuredPlanOptions, tryParseExecutionContent, CONTENT_TYPE_PRIORITY_MAP } from './structuredPlanSchedulerModel';


import { queueBoltContentJobs, processCreatorStructuredSchedule, ScheduleEligibilityError } from './structuredPlanSchedulerExecWeeklyA';

async function scheduleStructuredPlanRuntime(
  plan: StructuredPlan,
  campaignId: string,
  options?: ScheduleStructuredPlanOptions
): Promise<{
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
  already_scheduled_count?: number;
}> {
  if (!plan?.weeks || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_PLAN_INVALID,
      'Structured plan is required',
    );
  }

  const { data: campaign, error: campaignError } = await ownedDbTable('campaigns')
    .select('id, user_id, company_id, start_date')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    console.error('[scheduleStructuredPlan] Campaign lookup failed', {
      campaignId,
      error: campaignError?.message,
      errorCode: campaignError?.code,
      errorDetails: campaignError?.details,
      hasData: !!campaign,
    });
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND,
      `Campaign not found (id=${campaignId}, err=${campaignError?.message ?? 'no data'})`,
      { cause: campaignError ?? undefined, details: { campaign_id: campaignId } }
    );
  }
  if (!campaign.start_date) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_CONFIG_INCOMPLETE,
      'Campaign start date is required for scheduling',
      { details: { campaign_id: campaignId, field: 'start_date' } }
    );
  }
  // RULE: never schedule activity in a past date. Instead of failing the
  // whole run when start_date is stale (e.g. a config carried over from a
  // previous day), auto-shift the effective start forward to today. Every
  // per-post time is independently clamped to >= now + 1h by
  // enforceScheduleFloor, so this only re-bases the day math — it cannot
  // produce past activity. Compared date-only (YYYY-MM-DD) so "today" is
  // always valid regardless of UTC hour vs campaign midnight parsing.
  {
    const startDateStr = String(campaign.start_date).slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    if (startDateStr && startDateStr < todayStr) {
      console.warn('[scheduleStructuredPlan] start_date in the past; auto-shifting forward', {
        campaignId,
        original_start_date: startDateStr,
        shifted_to: todayStr,
      });
      campaign.start_date = todayStr;
    }
  }

  // G2.1: Resolve company_id for tenant-scoped account lookup
  const { data: versionRow } = await ownedDbTable('campaign_versions')
    .select('company_id, campaign_snapshot, version')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const companyId = (versionRow as { company_id?: string } | null)?.company_id
    ?? (campaign as any).company_id
    ?? null;
  const executionConfig = (((versionRow as any)?.campaign_snapshot ?? {})?.execution_config ?? {}) as Record<string, unknown>;
  const executionProfile = String(options?.executionProfile || executionConfig[['campaign', 'mode'].join('_')] || 'text');
  const usesUnifiedMediaFlow = executionProfile === 'creator';
  // Phase 2B — Intelligent Mix. Row-level routing is activated for `combined`
  // ONLY. `usesUnifiedMediaFlow` is deliberately left unchanged so text /
  // creator / creator_dependent keep their exact existing dispatch.
  const isCombined = executionProfile === 'combined';
  const currentPlanVersion = Math.max(1, toNumericValue((versionRow as any)?.version, 1));

  // Resolve user_id: campaign.user_id may be null if auth fell back to dev context.
  // In that case, look up the first user in the company's role table.
  let effectiveUserId: string | null = (campaign as any).user_id ?? null;
  if (!effectiveUserId && companyId) {
    const { data: companyUser } = await ownedDbTable('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    effectiveUserId = (companyUser as any)?.user_id ?? null;
    if (effectiveUserId) {
      // Backfill the campaign's user_id so future queries work
      await ownedDbTable('campaigns').update({ user_id: effectiveUserId }).eq('id', campaignId);
    }
  }
  if (!effectiveUserId) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_USER_RESOLUTION_FAILED,
      'Campaign has no user_id and no company members found — cannot resolve social accounts',
      { details: { campaign_id: campaignId } }
    );
  }

  let accountsQuery = ownedDbTable('social_accounts')
    .select('id, platform')
    .eq('user_id', effectiveUserId)
    .eq('is_active', true);
  if (companyId) {
    accountsQuery = accountsQuery.or(`company_id.eq.${companyId},company_id.is.null`);
  } else {
    accountsQuery = accountsQuery.is('company_id', null);
  }
  const { data: accounts, error: accountError } = await accountsQuery;

  if (accountError || !accounts) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED,
      'Failed to load social accounts',
    );
  }

  const catalog = await listPlatformCatalog({ activeOnly: true });
  const allowedPlatforms = new Set<string>(
    (catalog.platforms || [])
      .map((p) => String((p as any).canonical_key || '').toLowerCase().trim())
      .filter(Boolean)
  );
  const aliasMap = buildPlatformAliasMap(allowedPlatforms);
  const normalize: PlatformNormalizer = (p: string) => normalizePlatform(p, aliasMap, allowedPlatforms);

  const accountMap = new Map<string, string>();
  accounts.forEach((account: any) => {
    const platform = normalize(account.platform);
    if (platform && !accountMap.has(platform)) {
      accountMap.set(platform, account.id);
    }
  });

  const typeMapByPlatform: Record<string, Record<string, string>> = {};
  for (const platform of accountMap.keys()) {
    try {
      const bundle = await getPlatformRules(platform);
      const fromDb = extractTypeMapFromPlatformRules(bundle);
      if (fromDb) typeMapByPlatform[platform] = fromDb;
    } catch {
      // ignore; fallback mapping will be used
    }
  }

  // STEP 1: Prefer BOLT-generated daily_content_plans when they exist.
  // NOTE: execution_mode and creator_asset are optional columns — if they don't exist in the
  // DB schema, Supabase returns an error and hasDailyPlans becomes false, causing placeholder
  // content. We select only guaranteed-to-exist core columns and handle optional ones gracefully.
  const { data: dailyPlansRaw, error: dailyPlansError } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id, week_number, day_of_week, date, platform, content_type, title, topic, scheduled_time, content, content_status, intent_type, asset_type, template_id, plan_version, locked_by, lease_expires_at, attempt_count, retry_count, max_retries, failure_reason, failure_type')
    .eq('campaign_id', campaignId)
    .order('date', { ascending: true })
    .order('week_number', { ascending: true });
  // `let` alias (Phase-2 Step-34): downstream references are unchanged;
  // physical pruning under AUTHORITATIVE reassigns this to canonical-ready
  // rows only. Fail-soft ⇒ stays the original query result.
  let dailyPlans = dailyPlansRaw;

  if (dailyPlansError) {
    console.warn('[schedule] daily_content_plans query failed — falling back to allocation scheduling', dailyPlansError.message);
  }

  // `let` (was const): Phase-2 Step-34 physically prunes dailyPlans to
  // canonical-ready rows under AUTHORITATIVE, which re-derives this flag.
  let hasDailyPlans = !dailyPlansError && Array.isArray(dailyPlans) && dailyPlans.length > 0;

  if (hasDailyPlans && Array.isArray(dailyPlans)) {
    // Creator-format governance applies ONLY to creator-intent rows. BOLT
    // Text writes intent_type='text' rows with content_type values like
    // 'article'/'feed_post'/'post'/'tweet' that aren't in the creator
    // governance registry — those are governed by the text scheduling
    // eligibility path below, not by `assertNoUnschedulableCreatorDailyPlans`.
    // Without this filter the assertion would reject every BOLT Text
    // Schedule run with "Unsupported creator format: article, feed_post."
    const creatorIntentRows = (dailyPlans as DailyPlanRow[]).filter(
      (row) => (row as { intent_type?: unknown }).intent_type === 'creator'
    );
    if (creatorIntentRows.length > 0) {
      // Closure-pass follow-up: per-row diagnostics for the
      // assert-unschedulable path. The assertion throws when ANY row's
      // content_type isn't a schedulable creator format, but loses the
      // per-row attribution. We enumerate the offending rows here so
      // bolt_row_failure_diagnostics carries the breakdown before the
      // assertion throws the run-level BoltError. Policy: ABORT-STAGE
      // (we don't drop rows here — the existing planner behaviour is to
      // treat any unschedulable creator format as a hard stop, and the
      // diagnostics are purely additive observability).
      const offending: RowFailureRecord[] = [];
      for (const row of creatorIntentRows) {
        const ct = (row as { content_type?: unknown }).content_type;
        const governance = getCreatorGovernance(ct);
        if (!governance || governance.schedulable !== true) {
          offending.push({
            runId: options?.run_id ?? '',
            campaignId,
            dailyPlanId: typeof (row as { id?: unknown }).id === 'string'
              ? ((row as { id: string }).id)
              : null,
            weekNumber: typeof (row as { week_number?: unknown }).week_number === 'number'
              ? ((row as { week_number: number }).week_number)
              : null,
            platform: typeof (row as { platform?: unknown }).platform === 'string'
              ? ((row as { platform: string }).platform)
              : null,
            contentType: typeof ct === 'string' ? ct : null,
            stage: 'schedule-structured-plan',
            code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
            message: `content_type "${String(ct ?? '')}" is not a schedulable creator format.`,
            details: { intent_type: 'creator', schedulable: governance?.schedulable ?? false },
          });
        }
      }
      if (offending.length > 0 && options?.run_id) {
        // Best-effort. The batch writer never throws.
        await recordRowFailureBatch(offending);
      }
      assertNoUnschedulableCreatorDailyPlans(creatorIntentRows);
    }
    // execution_mode and creator_asset are optional columns not always selected —
    // pass them as undefined so eligibility check treats all rows as text-schedulable.
    //
    // Combined (Intelligent Mix) is EXEMPT from this whole-campaign eligibility
    // veto — same as pure-creator (usesUnifiedMediaFlow). A combined campaign
    // carries BOTH text and creator rows; its attachment-required creator rows
    // (video/reel) infer to CREATOR_REQUIRED and would make this gate reject the
    // ENTIRE run, even though the autonomous/text rows are schedulable now. The
    // per-row lane dispatch below (isCombined branch) is the authority for
    // combined: it schedules text + autonomous rows and HOLDS not-ready
    // attachment/video rows in awaiting_media_upload — the per-row eligibility
    // model that already replaced the campaign-wide veto everywhere else.
    if (!usesUnifiedMediaFlow && !isCombined) {
      const eligibility = evaluateScheduleEligibility(dailyPlans.map((r: any) => ({
        id: r.id ?? null,
        title: r.title ?? null,
        platform: r.platform ?? null,
        content_type: r.content_type ?? null,
        execution_mode: r.execution_mode ?? null,
        creator_asset: r.creator_asset ?? null,
      })));
      // Phase-2 Step-32: AUTHORITATIVE scheduler ENFORCEMENT cutover.
      // Under AUTHORITATIVE the canonical PublishingExecutionProjection
      // decides eligibility; otherwise the legacy `eligibility` verdict
      // governs byte-identically (SHADOW diff-only, rollback-safe).
      // Fail-soft: any enforcement failure ⇒ enforced:false ⇒ legacy.
      let canonicalEnforcement: { enforced: boolean; eligible: boolean } = {
        enforced: false,
        eligible: eligibility.eligible,
      };
      try {
        const orch = await import('./orchestration');
        canonicalEnforcement = await orch.enforceSchedulerEligibility(
          campaignId,
          eligibility.eligible,
        );
      } catch {
        canonicalEnforcement = { enforced: false, eligible: eligibility.eligible };
      }
      // Phase-2 Step-33: PER-EXECUTION authoritative enqueue control.
      // Under AUTHORITATIVE the run is rejected ONLY when EVERY execution
      // is blocked/unusable (no whole-run rejection for a single bad row);
      // deferred/blocked executions are recorded with lineage in the
      // ExecutionEnqueueSummary (no silent drops, requeue-eligible).
      // SHADOW/LEGACY/not-usable ⇒ Step-32 whole-run semantics preserved.
      let perExecutionUsable = false;
      let perExecutionAllBlocked = false;
      let pruning: { enqueueableRows: DailyPlanRow[]; usable: boolean } | null = null;
      try {
        const orch = await import('./orchestration');
        const enqueueSummary = await orch.resolveExecutionEnqueue(campaignId);
        orch.diffEnqueueVsLegacy(campaignId, enqueueSummary, eligibility.eligible);
        perExecutionUsable = enqueueSummary.usable;
        perExecutionAllBlocked = enqueueSummary.all_blocked;
        // Phase-2 Step-34: PHYSICAL pruning — deferred/blocked rows exit
        // the live enqueue loop so ONLY canonical-ready executions
        // traverse downstream. Conservative + fail-soft (unmapped rows
        // stay enqueueable; never wipes a non-all-blocked run).
        const pr = orch.pruneExecutions<DailyPlanRow>(
          campaignId,
          dailyPlans as DailyPlanRow[],
          enqueueSummary,
        );
        orch.diffPruningVsLegacy(campaignId, dailyPlans.length, pr);
        pruning = { enqueueableRows: pr.enqueueableRows, usable: pr.summary.usable };
        // Phase-2 Step-35: AUTONOMOUS deferred replay. The coordinator
        // scans canonical state with dedupe + cooldown; the *physical*
        // replay happens by virtue of THIS and future runs re-resolving
        // every execution canonically (a now-ready prior-deferred row
        // routes to enqueue), so nothing stays permanently stranded.
        // Fire-and-forget, cooldown-guarded, fail-soft — never blocks.
        let replayedCount = 0;
        let permanentlyBlockedCount = 0;
        if (pr.summary.deferred_requeue_candidates.length > 0) {
          try {
            const replay = await orch.coordinateReplay(
              campaignId,
              pr.summary.deferred_requeue_candidates,
            );
            replayedCount = replay.replayed_ids.length;
            permanentlyBlockedCount = replay.permanently_blocked_ids.length;
          } catch {
            /* fail-soft: coordinator already isolated + logged */
          }
        }
        // Final orchestration validation + cutover-state observability.
        try {
          orch.emitFinalOrchestrationDiff({
            campaignId,
            legacyEligible: eligibility.eligible,
            enqueueable: enqueueSummary.enqueued_count,
            deferred: enqueueSummary.deferred_count,
            blocked: enqueueSummary.blocked_count,
            pruningUsable: pr.summary.usable,
            replayedCount,
            permanentlyBlockedCount,
          });
        } catch {
          /* observability only — never block the run */
        }
      } catch {
        perExecutionUsable = false;
        pruning = null;
      }

      if (perExecutionUsable) {
        // Per-execution authority: only an entirely-blocked run rejects.
        if (perExecutionAllBlocked) {
          throw new ScheduleEligibilityError(eligibility);
        }
        // Physically prune the in-flight rows so deferred/blocked
        // executions no longer traverse downstream enqueue/publish/CMS
        // loops. Only when pruning is usable (else Step-33 logical only).
        if (pruning && pruning.usable) {
          // Cast: pruned rows are the same DB rows, narrowed to the
          // canonical-ready subset (DailyPlanRow ⊃ the select shape).
          dailyPlans = pruning.enqueueableRows as unknown as typeof dailyPlans;
          hasDailyPlans = Array.isArray(dailyPlans) && dailyPlans.length > 0;
        }
      } else {
        // Authority: canonical when enforced, legacy otherwise. Legacy
        // ScheduleEligibilityError contract is preserved exactly.
        const effectivelyEligible = canonicalEnforcement.enforced
          ? canonicalEnforcement.eligible
          : eligibility.eligible;
        if (!effectivelyEligible) {
          throw new ScheduleEligibilityError(eligibility);
        }
      }
    }
  }

  // ── CONTENT SCHEDULING PATH (BOLT schedule outcome with daily plans) ─────────
  console.log('[schedule] routing decision', {
    hasDailyPlans,
    dailyPlansCount: Array.isArray(dailyPlans) ? dailyPlans.length : 0,
    generateContent: options?.generateContent,
    run_id: options?.run_id ?? null,
    companyId,
    accountMapSize: accountMap.size,
    firstPlanPlatform: Array.isArray(dailyPlans) && dailyPlans.length > 0 ? (dailyPlans[0] as any)?.platform : null,
  });

  if (hasDailyPlans && options?.generateContent && dailyPlans) {
    // ── INTELLIGENT MIX (combined) — PER-ROW LANE DISPATCH (Phase 2B) ───────
    // Combined is the ONLY mode that uses row-level routing. This branch is
    // gated on `isCombined`, so for text / creator / creator_dependent the
    // code below runs byte-identically to before. No second scheduler — we
    // reuse the EXISTING primitives:
    //   • creator-intent rows (autonomous / attachment / video-waiting) →
    //     processCreatorStructuredSchedule, whose EXISTING per-row eligibility
    //     renders autonomous rows and HOLDS attachment/video rows that lack a
    //     validated upload (video can never auto-schedule here).
    //   • text rows → processBlockSchedule (the same inline path combined uses
    //     today; the BOLT pipeline omits run_id, so this is the established
    //     combined path — the async queue path for combined is out of scope).
    //   • ineligible rows → skipped (counted), matching existing skip behavior.
    if (isCombined) {
      options?.onProgress?.('schedule-routing-rows');
      const combinedRows = dailyPlans as DailyPlanRow[];
      // Pure, unit-tested partition (single source of truth in rowSchedulingLane).
      const { creatorLane: creatorLaneRows, textLane: textLaneRows, ineligible } =
        partitionRowsByLane(combinedRows);
      const ineligibleCount = ineligible.length;

      // Telemetry (diagnostics only — no business logic). Pre-dispatch.
      const diagnostics = buildRoutingDiagnostics(executionProfile, combinedRows);
      emitRoutingDiagnostics(diagnostics, (event, payload) =>
        console.log(`[schedule] intelligent-mix ${event}`,
          { campaign_id: campaignId, run_id: options?.run_id ?? null, ...payload })
      );

      let creatorScheduled = 0;
      let creatorSkipped = 0;
      const mergedSkippedPlatforms: string[] = [];
      if (creatorLaneRows.length > 0) {
        options?.onProgress?.('schedule-creating-assets');
        const creatorResult = await processCreatorStructuredSchedule({
          campaignId,
          companyId,
          userId: effectiveUserId,
          dailyPlans: creatorLaneRows,
          accountMap,
          normalize,
          typeMapByPlatform,
          currentPlanVersion,
          onProgress: options?.onProgress,
        });
        creatorScheduled = creatorResult.scheduled_count;
        creatorSkipped = creatorResult.skipped_count;
        mergedSkippedPlatforms.push(...creatorResult.skipped_platforms);
      }

      let textScheduled = 0;
      let textSkipped = 0;
      if (textLaneRows.length > 0) {
        options?.onProgress?.('schedule-creating-content');
        const blockResult = await processBlockSchedule(
          campaignId,
          textLaneRows,
          { ...campaign, user_id: effectiveUserId, company_id: companyId },
          accountMap,
          normalize,
          typeMapByPlatform,
          {
            onProgress: (event) => {
              if (event.phase === 'block-start') {
                options?.onProgress?.(`schedule-block-${event.contentType}`);
              } else if (event.phase === 'topic-master') {
                options?.onProgress?.('schedule-creating-content');
              } else if (event.phase === 'platform-done') {
                options?.onProgress?.('schedule-repurposing-content');
              } else if (event.phase === 'block-complete') {
                options?.onProgress?.('schedule-writing-posts');
              }
            },
          }
        );
        textScheduled = blockResult.scheduled_count;
        textSkipped = blockResult.skipped_count;
        mergedSkippedPlatforms.push(...blockResult.skipped_platforms);
      }

      // Post-dispatch actuals (diagnostics only).
      console.log('[schedule] intelligent-mix routing result', {
        campaign_id: campaignId,
        run_id: options?.run_id ?? null,
        execution_profile: executionProfile,
        rows_total: combinedRows.length,
        rows_creator_lane: creatorLaneRows.length,
        rows_text_lane: textLaneRows.length,
        rows_ineligible: ineligibleCount,
        rows_rerouted: diagnostics.rows_that_would_reroute,
        rows_held: diagnostics.video_waiting_rows + diagnostics.ineligible_rows,
        scheduled_count: creatorScheduled + textScheduled,
      });

      return {
        scheduled_count: creatorScheduled + textScheduled,
        skipped_count: creatorSkipped + textSkipped + ineligibleCount,
        skipped_platforms: mergedSkippedPlatforms,
        already_scheduled_count: 0,
      };
    }
    if (usesUnifiedMediaFlow) {
      options?.onProgress?.('schedule-creating-assets');
      const creatorResult = await processCreatorStructuredSchedule({
        campaignId,
        companyId,
        userId: effectiveUserId,
        dailyPlans: dailyPlans as DailyPlanRow[],
        accountMap,
        normalize,
        typeMapByPlatform,
        currentPlanVersion,
        onProgress: options?.onProgress,
      });
      return {
        scheduled_count: creatorResult.scheduled_count,
        skipped_count: creatorResult.skipped_count,
        skipped_platforms: creatorResult.skipped_platforms,
        already_scheduled_count: 0,
      };
    }
    // ── QUEUE PATH: run_id present → queue jobs for async processing ────────
    // Required for large campaigns (10+ platforms × 5+ content types × 3+/week)
    // where in-process generation would exceed HTTP timeout limits.
    if (options?.run_id) {
      // NO-SILENT-FAILURE (Round-2 item 3): only take the async queue path
      // when the queue is actually operational (Redis up + a bolt worker
      // alive). If not, we do NOT queue-and-return-0 (which previously let
      // the run report `completed` with zero scheduled posts) — we fall
      // through to the SYNCHRONOUS inline block processor instead, which
      // produces real scheduled_posts or a real error.
      const queueOk = await isQueueOperational();
      if (!queueOk) {
        logPipelineEvent('scheduling.degraded', 'warn', {
          run_id: options.run_id,
          campaign_id: campaignId,
          code: PipelineErrorCode.QUEUE_UNAVAILABLE,
          action: 'fallback_inline_synchronous',
          reason: 'queue_not_operational',
        }, { dedupeKey: campaignId });
      } else {
        try {
          options?.onProgress?.('schedule-queuing-jobs');
          const jobCount = await queueBoltContentJobs(
            options.run_id,
            campaignId,
            dailyPlans as DailyPlanRow[],
            { ...campaign, company_id: companyId },
            accountMap,
            typeMapByPlatform,
            normalize,
          );
          if (jobCount > 0) {
            options?.onProgress?.('schedule-writing-posts');
            logPipelineEvent('scheduling.queue_path', 'info', {
              run_id: options.run_id, campaign_id: campaignId, queued_job_count: jobCount,
            }, { dedupeKey: campaignId, throttleMs: 0 });
            return {
              scheduled_count:         0,    // jobs run async — count comes from workers
              skipped_count:           0,
              skipped_platforms:       [],
              already_scheduled_count: 0,
              queued_job_count:        jobCount,
              degraded:                false,
            } as any;
          }
          // jobCount === 0 means all inserts failed — fall through to inline.
          logPipelineEvent('scheduling.zero_scheduled', 'warn', {
            run_id: options.run_id, campaign_id: campaignId,
            code: PipelineErrorCode.SCHEDULING_PRODUCED_ZERO,
            action: 'fallback_inline_synchronous',
          }, { dedupeKey: campaignId });
        } catch (err) {
          logPipelineEvent('scheduling.degraded', 'warn', {
            run_id: options.run_id, campaign_id: campaignId,
            code: PipelineErrorCode.SCHEDULING_DEGRADED,
            action: 'fallback_inline_synchronous',
            err: (err as Error)?.message,
          }, { dedupeKey: campaignId });
          // Fall through to inline block processor
        }
      }
    }

    // ── INLINE BLOCK PROCESSOR: no run_id → process synchronously ───────────
    // Used for small campaigns or when BullMQ is unavailable.
    try {
      options?.onProgress?.('schedule-creating-content');
      const blockResult = await processBlockSchedule(
        campaignId,
        dailyPlans as DailyPlanRow[],
        { ...campaign, user_id: effectiveUserId, company_id: companyId },
        accountMap,
        normalize,
        typeMapByPlatform,
        {
          onProgress: (event) => {
            if (event.phase === 'block-start') {
              options?.onProgress?.(`schedule-block-${event.contentType}`);
            } else if (event.phase === 'topic-master') {
              options?.onProgress?.('schedule-creating-content');
            } else if (event.phase === 'platform-done') {
              options?.onProgress?.('schedule-repurposing-content');
            } else if (event.phase === 'block-complete') {
              options?.onProgress?.('schedule-writing-posts');
            }
          },
        }
      );
      return {
        scheduled_count:         blockResult.scheduled_count,
        skipped_count:           blockResult.skipped_count,
        skipped_platforms:       blockResult.skipped_platforms,
        already_scheduled_count: 0,
      };
    } catch (err) {
      console.warn('[schedule] Block processor failed, falling back to legacy path:', (err as Error)?.message);
      // Fall through to legacy path below
    }
  }

  // ── LEGACY / FALLBACK PATH ─────────────────────────────────────────────────
  // Used when: no daily plans, generateContent is false, or block processor threw.
  let contentMap: Map<string, string> | undefined;
  if (hasDailyPlans && !options?.generateContent && dailyPlans) {
    // No-generate path: try to use any already-finalized content stored in daily plans
    // (no LLM calls; if content is placeholder, post will be skipped)
  }

  // STEP 2–4: Fallback chain when no daily plans
  const schedulableJobs = extractSchedulableJobsFromWeeks(plan.weeks as any[]);
  const hasExecutionJobs = schedulableJobs.length > 0;
  const useLegacy = isLegacyPlan(plan.weeks);
  // Same gating rationale as the daily-plan branch above: this assertion
  // checks every content type in plan.weeks against the creator governance
  // registry, which only knows creator formats. BOLT Text plans carry
  // `article`/`post`/`tweet`/etc. — text formats that live outside the
  // registry. Without this gate the legacy fallback path rejects every
  // BOLT Text Schedule run.
  if (usesUnifiedMediaFlow) {
    assertNoUnschedulableCreatorPlanWeeks(plan.weeks as StructuredWeekBlueprint[]);
  }

  // Use effectiveUserId so legacy paths don't fail on null user_id
  const campaignWithUser = { ...campaign, user_id: effectiveUserId };

  const { scheduledPosts, skippedPlatforms } = hasDailyPlans
    ? scheduleFromDailyPlans(
        dailyPlans as DailyPlanRow[],
        campaignWithUser,
        accountMap,
        campaignId,
        normalize,
        typeMapByPlatform,
        contentMap
      )
    : hasExecutionJobs
    ? scheduleFromExecutionJobs(
        plan.weeks,
        schedulableJobs,
        campaignWithUser,
        accountMap,
        campaignId,
        normalize,
        typeMapByPlatform
      )
    : useLegacy
    ? scheduleFromLegacy(plan.weeks, campaignWithUser, accountMap, campaignId, normalize)
    : scheduleFromAllocation(plan.weeks, campaignWithUser, accountMap, campaignId, normalize, typeMapByPlatform, options?.eligiblePlatforms, options?.frequencyPerWeek);

  if (scheduledPosts.length === 0) {
    return {
      scheduled_count: 0,
      skipped_count: skippedPlatforms.length,
      skipped_platforms: skippedPlatforms,
      already_scheduled_count: 0,
    };
  }

  // ── Idempotency-key tagging ────────────────────────────────────────
  // Every row gets a deterministic key built from
  // (campaign, week_number, day_of_week, platform, content_type, seq).
  // The DB-level partial unique index `uidx_scheduled_posts_idempotency_key`
  // is the hard duplicate guard: retries / resumes / partial recoveries
  // can re-issue the same insert without producing duplicate posts.
  // We use a per-(campaign,week,day,platform,content_type) sequence
  // counter so multi-post-per-day campaigns disambiguate.
  const idempotencySeqByKey = new Map<string, number>();
  const postsWithKey = scheduledPosts.map((p: any) => {
    if (p.idempotency_key) return p; // caller already stamped one
    const keyBase = [
      String(p.campaign_id ?? campaignId),
      String(p.week_number ?? ''),
      String(p.day_of_week ?? ''),
      String(p.platform ?? '').toLowerCase(),
      String(p.content_type ?? '').toLowerCase(),
    ].join('::');
    const seq = (idempotencySeqByKey.get(keyBase) ?? -1) + 1;
    idempotencySeqByKey.set(keyBase, seq);
    return {
      ...p,
      idempotency_key: makeScheduledPostIdempotencyKey({
        campaignId: String(p.campaign_id ?? campaignId),
        weekNumber: Number(p.week_number ?? 0),
        dayOfWeek: String(p.day_of_week ?? ''),
        platform: String(p.platform ?? ''),
        contentType: String(p.content_type ?? ''),
        sequence: seq,
      }),
    };
  });

  // Skip posts whose (platform, date) are already scheduled for this campaign
  let postsToInsert = postsWithKey;
  let alreadyScheduledCount = 0;
  if (options?.skipExisting) {
    const { data: existingPosts } = await ownedDbTable('scheduled_posts')
      .select('platform, scheduled_for, idempotency_key')
      .eq('campaign_id', campaignId)
      .in('status', ['scheduled', 'draft', 'publishing', 'published']);
    if (existingPosts && existingPosts.length > 0) {
      // Pre-filter using BOTH the legacy (platform, date) key (older
      // rows without idempotency_key) AND the new deterministic key
      // (new rows). Falling back to the legacy key keeps existing
      // campaigns that pre-date the migration behaving identically.
      const existingLegacyKeys = new Set(
        existingPosts.map((p: any) => `${String(p.platform).toLowerCase()}_${String(p.scheduled_for || '').slice(0, 10)}`)
      );
      const existingIdempotencyKeys = new Set(
        existingPosts.map((p: any) => p.idempotency_key).filter(Boolean)
      );
      postsToInsert = postsWithKey.filter((p: any) => {
        if (p.idempotency_key && existingIdempotencyKeys.has(p.idempotency_key)) return false;
        const legacy = `${String(p.platform).toLowerCase()}_${String(p.scheduled_for || '').slice(0, 10)}`;
        return !existingLegacyKeys.has(legacy);
      });
      alreadyScheduledCount = postsWithKey.length - postsToInsert.length;
    }
  }

  if (postsToInsert.length === 0) {
    return {
      scheduled_count: 0,
      skipped_count: skippedPlatforms.length,
      skipped_platforms: skippedPlatforms,
      already_scheduled_count: alreadyScheduledCount,
    };
  }

  // Insert. If the unique idempotency_key index throws (collision with
  // a row we missed in the pre-filter — e.g. another worker raced us),
  // fall back to per-row inserts so the successful rows still land and
  // only the colliding rows are skipped. This is the retry-safe insert
  // contract the spec calls for.
  let insertedPosts: Array<{ id: string; user_id: string; social_account_id: string; scheduled_for: string }> = [];
  const { data: bulkInsertedPosts, error: insertError } = await ownedDbTable('scheduled_posts')
    .insert(postsToInsert)
    .select('id, user_id, social_account_id, scheduled_for');
  if (insertError) {
    if (isIdempotencyCollision(insertError)) {
      console.warn('[structuredPlanScheduler] idempotency collision in bulk insert; falling back to per-row');
      let collisionCount = 0;
      for (const post of postsToInsert) {
        const { data: row, error: rowErr } = await ownedDbTable('scheduled_posts')
          .insert(post)
          .select('id, user_id, social_account_id, scheduled_for')
          .maybeSingle();
        if (rowErr) {
          if (isIdempotencyCollision(rowErr)) {
            collisionCount += 1;
            continue;
          }
          throw new BoltError(
            BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
            `Failed to schedule posts: ${rowErr.message}`,
            { cause: rowErr, details: { db_error: rowErr.message } }
          );
        }
        if (row) insertedPosts.push(row as typeof insertedPosts[number]);
      }
      alreadyScheduledCount += collisionCount;
    } else {
      throw new BoltError(
        BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
        `Failed to schedule posts: ${insertError.message}`,
        { cause: insertError, details: { db_error: insertError.message } }
      );
    }
  } else {
    insertedPosts = (bulkInsertedPosts ?? []) as typeof insertedPosts;
  }

  for (const row of insertedPosts || []) {
    if (!row?.id || !row?.social_account_id || !row?.scheduled_for) continue;
    try {
      await enqueueScheduledPostAt(
        String(row.id),
        String(row.user_id),
        String(row.social_account_id),
        String(row.scheduled_for),
      );
    } catch (enqueueError: any) {
      console.warn('[structuredPlanScheduler] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
    }
  }

  return {
    scheduled_count: postsToInsert.length,
    skipped_count: skippedPlatforms.length,
    skipped_platforms: skippedPlatforms,
    already_scheduled_count: alreadyScheduledCount,
  };
}

export { scheduleStructuredPlanRuntime as scheduleStructuredPlan };

// ==========================================================
// Legacy API adapters (DB-backed, platform-intelligence-first)
// ==========================================================

export type LegacyScheduledPost = {
  id: string;
  platform: string;
  contentType: string;
  content: string;
  mediaUrls?: string[];
  hashtags?: string[];
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  publishedAt?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  repurpose_index?: number;
  repurpose_total?: number;
};


