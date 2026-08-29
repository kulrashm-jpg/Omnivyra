/** Structured plan scheduler — daily-plan scheduling core — split from structuredPlanSchedulerExecWeekly.ts (barrel preserved; importers unchanged). */
/** Structured plan scheduler — weekly structure execution — split from structuredPlanSchedulerExec.ts (barrel preserved; importers unchanged). */
/** Structured plan scheduler — execution — split from structuredPlanScheduler.ts (barrel preserved; importers unchanged). */
import { safeEnqueue } from '../middleware/queueBackpressure';
import { supabase } from '../db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { recordRowFailureBatch, type RowFailureRecord } from './boltRowFailureDiagnostics';
// `getCreatorGovernance` is already imported below from the creator
// governance registry — kept there to avoid duplicate identifier.

import { getPlatformRules, listPlatformCatalog } from './platformIntelligenceService';
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



function topicGroupKeyForQueue(row: DailyPlanRow): string {
  let parsed: Record<string, unknown> = {};
  if (row.content && typeof row.content === 'string') {
    try { parsed = JSON.parse(row.content); } catch { /* ok */ }
  } else if (row.content && typeof row.content === 'object') {
    parsed = row.content as Record<string, unknown>;
  }
  const src  = String((parsed as any).source_execution_id ?? '').trim();
  const mid  = String((parsed as any).master_content_id    ?? '').trim();
  const eid  = String((parsed as any).execution_id         ?? '').trim();
  const topic = String(row.topic || row.title || (parsed as any).topicTitle || '').trim() || 'untitled';
  const week  = Number(row.week_number) || 1;
  if (src) return `shared::${src}::${week}`;
  if (mid) return `master::${mid}::${week}`;
  if (eid) return `unique::${eid}::${week}`;
  return `topic::${topic}::${week}`;
}

/**
 * Group daily_content_plans rows into topic groups, create bolt_content_jobs rows
 * in DB, create platform_content_slots rows, then push to the bolt-content-jobs
 * BullMQ queue. Returns the number of jobs queued.
 *
 * IMPORTANT: `normalize` converts raw platform values from daily_content_plans
 * (e.g. 'LinkedIn', 'twitter') to canonical keys (e.g. 'linkedin', 'x') that
 * match the accountMap keys. Without this, all platforms are silently dropped.
 */
export async function queueBoltContentJobs(
  runId: string,
  campaignId: string,
  dailyPlans: DailyPlanRow[],
  campaign: { start_date: string; user_id: string; company_id?: string | null },
  accountMap: Map<string, string>,
  typeMapByPlatform: Record<string, Record<string, string>>,
  normalize: PlatformNormalizer,
): Promise<number> {
  const companyId = campaign.company_id ?? null;

  // Group rows by content_type × topic
  const contentTypeGroups = new Map<string, Map<string, DailyPlanRow[]>>();
  for (const row of dailyPlans) {
    const ct  = String(row.content_type || 'post').toLowerCase().trim();
    const key = topicGroupKeyForQueue(row);
    if (!contentTypeGroups.has(ct)) contentTypeGroups.set(ct, new Map());
    const topicMap = contentTypeGroups.get(ct)!;
    const list = topicMap.get(key) ?? [];
    list.push(row);
    topicMap.set(key, list);
  }

  // Flatten into job descriptors
  type JobDescriptor = {
    contentType: string;
    topic: string;
    rows: DailyPlanRow[];
    priority: number;
    platformTargets: Array<{ platform: string; content_type: string; raw_platform: string }>;
    enriched: Record<string, unknown>;
  };

  const jobs: JobDescriptor[] = [];
  for (const [ct, topicMap] of contentTypeGroups.entries()) {
    for (const rows of topicMap.values()) {
      const first  = rows[0]!;
      let parsed: Record<string, unknown> = {};
      if (first.content && typeof first.content === 'string') {
        try { parsed = JSON.parse(first.content); } catch { /* ok */ }
      } else if (first.content && typeof first.content === 'object') {
        parsed = first.content as Record<string, unknown>;
      }
      const topic = String(
        first.topic || first.title || (parsed as any).topicTitle || ''
      ).trim() || 'Untitled';

      // CRITICAL: normalize raw platform values before checking accountMap.
      // daily_content_plans stores raw values like 'LinkedIn', 'twitter', 'Instagram'.
      // accountMap keys are canonical: 'linkedin', 'x', 'instagram'.
      const platformTargets = rows.map((r) => {
        const rawPlatform = String(r.platform || '').trim().toLowerCase();
        const canonical   = normalize(rawPlatform);
        if (!canonical || !accountMap.has(canonical)) return null;
        return {
          platform:     canonical,           // normalized — used for accountMap lookup
          raw_platform: rawPlatform,         // original — stored for debugging
          content_type: String(r.content_type || 'post').trim().toLowerCase(),
        };
      }).filter((t): t is NonNullable<typeof t> => t !== null);

      if (platformTargets.length === 0) {
        console.warn('[schedule] queueBoltContentJobs: no valid platforms for topic', {
          topic, ct,
          rawPlatforms: rows.map((r) => r.platform),
          accountMapKeys: Array.from(accountMap.keys()),
        });
        continue;
      }

      jobs.push({
        contentType: ct,
        topic,
        rows,
        priority: CONTENT_TYPE_PRIORITY_MAP[ct] ?? 5,
        platformTargets,
        enriched: {
          topic: first.topic || first.title || '',
          title: first.title || first.topic || '',
          ...parsed,
        },
      });
    }
  }

  if (jobs.length === 0) {
    console.warn('[schedule] queueBoltContentJobs: 0 jobs after platform normalization', {
      dailyPlansCount: dailyPlans.length,
      accountMapKeys: Array.from(accountMap.keys()),
      rawPlatforms: [...new Set(dailyPlans.map((r) => r.platform))],
    });
    return 0;
  }

  // Serialize accountMap for job payload (Map isn't JSON-serialisable).
  // Keys are canonical platform names — processor must use canonical name for lookup.
  const accountMapObj: Record<string, string> = {};
  accountMap.forEach((v, k) => { accountMapObj[k] = v; });

  const queue = getContentQueue('bolt-content-jobs');
  let queued = 0;

  for (const jd of jobs) {
    // 1. Insert bolt_content_jobs row
    const { data: jobRow, error: jobInsertErr } = await ownedDbTable('bolt_content_jobs')
      .insert({
        run_id:         runId,
        campaign_id:    campaignId,
        daily_plan_ids: jd.rows.map((r) => r.id),
        content_type:   jd.contentType,
        topic:          jd.topic,
        priority:       jd.priority,
        status:         'pending',
      })
      .select('id')
      .maybeSingle();

    if (jobInsertErr || !jobRow) {
      console.warn('[schedule] bolt_content_jobs insert failed:', jobInsertErr?.message, { topic: jd.topic });
      continue;
    }

    const boltJobId = (jobRow as any).id as string;

    // 2. Insert platform_content_slots (one per daily_plan row)
    const slotRows = jd.rows.map((r) => ({
      campaign_id:   campaignId,
      daily_plan_id: r.id,
      bolt_job_id:   boltJobId,
      platform:      String(r.platform || '').toLowerCase(),
      content_type:  String(r.content_type || 'post').toLowerCase(),
      scheduled_for: r.date ? enforceScheduleFloor(new Date(`${String(r.date).slice(0, 10)}T09:00:00Z`)).toISOString() : null,
      status:        'empty',
    }));

    // Insert in batches of 50 to avoid Supabase payload limits
    for (let i = 0; i < slotRows.length; i += 50) {
      const batch = slotRows.slice(i, i + 50);
      const { error: slotErr } = await ownedDbTable('platform_content_slots').insert(batch);
      if (slotErr) console.warn('[schedule] platform_content_slots insert error:', slotErr.message);
    }

    // 3. Mark job as queued and push to BullMQ
    await ownedDbTable('bolt_content_jobs')
      .update({ status: 'queued' })
      .eq('id', boltJobId);

    const jobData: BoltContentJobData = {
      run_id:               runId,
      campaign_id:          campaignId,
      bolt_job_id:          boltJobId,
      topic:                jd.topic,
      content_type:         jd.contentType,
      daily_plan_ids:       jd.rows.map((r) => r.id),
      enriched:             jd.enriched,
      platform_targets:     jd.platformTargets,
      campaign: {
        start_date: campaign.start_date,
        user_id:    campaign.user_id,
        company_id: companyId,
      },
      account_map:          accountMapObj,
      type_map_by_platform: typeMapByPlatform,
    };

    await safeEnqueue(queue, 'bolt-content-jobs', `bolt-topic-${boltJobId}`, jobData, {
      priority: jd.priority,
      attempts: 3,
      backoff:  { type: 'exponential', delay: 3000 },
    });

    queued++;
  }

  console.log('[schedule] queueBoltContentJobs done', { runId, queued, totalJobs: jobs.length });
  return queued;
}

export async function processCreatorStructuredSchedule(input: {
  campaignId: string;
  companyId: string | null;
  userId: string;
  dailyPlans: DailyPlanRow[];
  accountMap: Map<string, string>;
  normalize: PlatformNormalizer;
  typeMapByPlatform: Record<string, Record<string, string>>;
  currentPlanVersion: number;
  onProgress?: (stage: string) => void;
}): Promise<{
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
}> {
  const {
    campaignId,
    companyId,
    userId,
    dailyPlans,
    accountMap,
    normalize,
    typeMapByPlatform,
    currentPlanVersion,
    onProgress,
  } = input;
  const engine = getExecutionEngine('creator');
  const skippedPlatforms: string[] = [];
  let scheduledCount = 0;
  let skippedCount = 0;

  for (const row of dailyPlans) {
    const rowContentType = normalizeCreatorFormat(row.content_type || '');
    const rowGovernance = getCreatorGovernance(rowContentType);
    // ── Per-row eligibility gate ─────────────────────────────────────────
    // Attachment-required formats (video / reel / short / podcast):
    //   - Hold in `awaiting_media_upload` / `upload_failed` until the user
    //     uploads via /api/activity-workspace/[id]/upload-media.
    //   - Schedule directly (no engine call) once `ready_for_schedule` + a
    //     valid upload validation, embedding `uploaded_media_url` into the
    //     scheduled_posts row's `media_urls` array.
    if (rowGovernance && isAttachmentRequiredFormat(rowContentType)) {
      const attachedContent = tryParseExecutionContent(row.content) as Record<string, unknown>;
      const eligibility = getRowSchedulingEligibility({
        content_type: rowContentType,
        content_status: row.content_status ?? null,
        creator_lifecycle_state: typeof attachedContent.creator_lifecycle_state === 'string'
          ? attachedContent.creator_lifecycle_state
          : (typeof (row as any).creator_lifecycle_state === 'string' ? (row as any).creator_lifecycle_state : null),
        uploaded_media_url: attachedContent.uploaded_media_url,
        upload_validation: attachedContent.upload_validation,
      });
      if (!eligibility.can_schedule_now) {
        // Preserve the row's existing per-row state — DO NOT overwrite a
        // `upload_failed` row with `awaiting_media_upload`.
        const currentLifecycle = typeof attachedContent.creator_lifecycle_state === 'string'
          ? attachedContent.creator_lifecycle_state
          : CREATOR_LIFECYCLE_STATES.AWAITING_MEDIA_UPLOAD;
        await ownedDbTable('daily_content_plans')
          .update({
            content_status: String(currentLifecycle),
            failure_reason: null,
            failure_type: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        skippedCount++;
        continue;
      }

      // ── Attachment-required + ready_for_schedule: direct schedule path ──
      const platformAttached = normalize(String(row.platform || '').trim().toLowerCase());
      if (!platformAttached) {
        skippedCount++;
        continue;
      }
      const socialAccountAttached = accountMap.get(platformAttached);
      if (!socialAccountAttached) {
        if (!skippedPlatforms.includes(platformAttached)) skippedPlatforms.push(platformAttached);
        skippedCount++;
        continue;
      }
      // Delegate the insert+enqueue+lifecycle-flip to the shared core so the
      // batch path and the post-upload trigger never diverge. The core adds
      // the deterministic idempotency_key + collision recovery, so a row that
      // was already auto-scheduled on upload is a safe no-op here.
      const attachedResult = await scheduleCreatorAttachmentPost({
        row: {
          id: row.id,
          campaign_id: campaignId,
          date: row.date,
          scheduled_time: row.scheduled_time,
          topic: row.topic,
          title: row.title,
          content_type: rowContentType,
        },
        attachedContent,
        userId,
        campaignId,
        platform: platformAttached,
        socialAccountId: socialAccountAttached,
        dbPlatform: toDbPlatformKey(platformAttached),
        dbContentType: toDbContentType(platformAttached, rowContentType, typeMapByPlatform),
      });
      if (attachedResult.status === 'scheduled' || attachedResult.status === 'already_scheduled') {
        scheduledCount++;
      } else {
        if (attachedResult.status === 'error' && !skippedPlatforms.includes(platformAttached)) {
          skippedPlatforms.push(platformAttached);
        }
        skippedCount++;
      }
      continue;
    } else if (rowGovernance && !rowGovernance.schedulable) {
      // Non-attachment non-schedulable formats (e.g. text-only post/thread
      // routed here in error) — preserve the old skip-and-hold behavior.
      await ownedDbTable('daily_content_plans')
        .update({
          content_status: 'guidance_ready',
          failure_reason: null,
          failure_type: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      skippedCount++;
      continue;
    }
    if (row.failure_type === 'permanent' && toNumericValue(row.plan_version, 1) === currentPlanVersion) {
      if (!skippedPlatforms.includes(String(row.platform || '').toLowerCase())) {
        skippedPlatforms.push(String(row.platform || '').toLowerCase());
      }
      skippedCount++;
      continue;
    }
    const platform = normalize(String(row.platform || '').trim().toLowerCase());
    if (!platform) {
      skippedCount++;
      continue;
    }

    const socialAccountId = accountMap.get(platform);
    if (!socialAccountId) {
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      skippedCount++;
      continue;
    }

    const parsed = tryParseExecutionContent(row.content);
    // Calendar unification: an autonomous row may already have been
    // auto-scheduled at render completion (creatorContentProcessor →
    // scheduleRenderedAutonomousRowById, Schedule outcomes). Skip the heavy
    // generate→render→schedule path for those rows so we never double-schedule
    // or wastefully re-render. Count them as scheduled.
    if (parsed.creator_lifecycle_state === 'scheduled' || (typeof parsed.scheduled_post_id === 'string' && parsed.scheduled_post_id)) {
      scheduledCount++;
      continue;
    }
    const topic = String(row.topic || row.title || parsed.topicTitle || 'Untitled').trim();
    const targetPlatforms = [platform];
    const creatorCard = parsed.creator_card && typeof parsed.creator_card === 'object'
      ? parsed.creator_card as Record<string, unknown>
      : null;
    const templateId = typeof parsed.template_id === 'string' ? parsed.template_id : row.template_id ?? null;
    const assetType = deriveCreatorAssetTypeFromIntent({
      contentType: String(row.content_type || 'video'),
      targetPlatforms: [platform],
    });
    const planVersion = Math.max(1, toNumericValue(row.plan_version, 1));
    const lockOwner = `creator:${campaignId}:${row.id}:${Date.now()}`;
    let lockState: Awaited<ReturnType<typeof acquireCreatorExecutionLock>> | null = null;
    let leaseHeartbeat: { stop: () => Promise<void> } | null = null;
    const executionStartedAt = Date.now();

    try {
      lockState = await acquireCreatorExecutionLock({
        dailyPlanId: row.id,
        lockOwner,
        expectedPlanVersion: currentPlanVersion,
      });
      leaseHeartbeat = startCreatorLeaseHeartbeat({
        dailyPlanId: row.id,
        lockOwner,
      });
      const maxRetries = Math.max(1, lockState.max_retries);
      let retryCount = Math.max(0, lockState.retry_count);
      let lastError: Error | null = null;
      let finalOutput: CanonicalCreatorOutput | null = null;
      let finalScheduling: CreatorScheduleResult | null = null;
      let readinessFailure: string | null = null;
      let failureType: 'transient' | 'permanent' | 'stale' | null = null;

      await assertCreatorExecutionWithinRateLimits({
        campaignId,
        userId,
      });
      await logCreatorExecutionAudit({
        campaignId,
        companyId,
        userId,
        dailyPlanId: row.id,
        platform,
        assetType,
        stage: 'intent',
        attemptCount: lockState.attempt_count,
        retryCount,
        planVersion,
        status: 'started',
        payload: {
          topic,
          content_type: row.content_type,
          template_id: templateId,
          target_platforms: targetPlatforms,
          content_status: row.content_status ?? null,
        },
      });

      for (let attempt = retryCount; attempt < maxRetries; attempt++) {
        onProgress?.(`schedule-creator-${platform}`);
        retryCount = attempt;
        try {
          const planVersionAtGenerate = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtGenerate !== planVersion) {
            failureType = 'stale';
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION,
              `Stale creator plan version ${planVersion}; current version is ${planVersionAtGenerate}`,
              { details: { plan_version: planVersion, current_plan_version: planVersionAtGenerate } }
            );
          }
          const generated = await (engine as any).generateFromIntent({
            campaignId,
            companyId,
            userId,
            topic,
            contentType: String(row.content_type || 'video'),
            targetPlatforms,
            audience: String((parsed.whoAreWeWritingFor ?? parsed.target_audience ?? creatorCard?.target_audience ?? '') || ''),
            objective: String((parsed.dailyObjective ?? parsed.objective ?? creatorCard?.objective ?? '') || ''),
            summary: String((parsed.summary ?? parsed.whatProblemAreWeAddressing ?? creatorCard?.summary ?? '') || ''),
            creatorCard,
            enrichedIntent: parsed,
            templateId,
            existingContent: parsed,
          }, { companyId }, {
            assetOverride:
              parsed.asset_payload && typeof parsed.asset_payload === 'object'
                ? parsed.asset_payload as Record<string, unknown>
                : parsed.creator_asset && typeof parsed.creator_asset === 'object'
                  ? parsed.creator_asset as Record<string, unknown>
                  : null,
          });

          const generatedValidation = validateCreatorExecutionOutput(generated);
          if (!generatedValidation.ok) {
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_CREATOR_OUTPUT_INVALID,
              `Generated creator output failed validation: ${generatedValidation.issues.join('; ')}`,
              { details: { issues: generatedValidation.issues } }
            );
          }
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'generated',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: 'ok',
            payload: {
              output: generated,
            },
          });

          const planVersionAtAdapt = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtAdapt !== planVersion) {
            failureType = 'stale';
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION,
              `Stale creator plan version ${planVersion}; current version is ${planVersionAtAdapt}`,
              { details: { plan_version: planVersion, current_plan_version: planVersionAtAdapt } }
            );
          }
          const adapted = await (engine as any).adaptForPlatform(generated, platform) as CanonicalCreatorOutput;
          const schedulingValidation = validateCreatorSchedulingContract({
            output: adapted,
            platform,
          });
          if (!schedulingValidation.ok) {
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_CREATOR_OUTPUT_INVALID,
              `Adapted creator output failed validation: ${schedulingValidation.issues.join('; ')}`,
              { details: { issues: schedulingValidation.issues } }
            );
          }
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'adapted',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: 'ok',
            payload: {
              output: adapted,
            },
          });

          const readiness = await validateAssetReadiness({
            output: adapted,
            platform,
          });
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'asset_validation',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: readiness.ready ? 'ready' : 'blocked',
            payload: {
              validation: readiness,
            },
          });
          if (!readiness.ready) {
            readinessFailure = readiness.failure_reason;
            failureType = 'permanent';
            finalOutput = adapted;
            break;
          }

          const planVersionAtSchedule = await getCurrentCampaignPlanVersion(campaignId);
          if (planVersionAtSchedule !== planVersion) {
            failureType = 'stale';
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION,
              `Stale creator plan version ${planVersion}; current version is ${planVersionAtSchedule}`,
              { details: { plan_version: planVersion, current_plan_version: planVersionAtSchedule } }
            );
          }
          const scheduledFor = buildScheduledForFromDailyPlan(row.date, row.scheduled_time);
          const scheduled = await (engine as any).schedule(adapted, {
            dailyPlanId: row.id,
            userId,
            platform,
            contentType: String(row.content_type || 'video'),
            topic,
            scheduledForIso: scheduledFor.toISOString(),
            socialAccountId,
            dbPlatform: toDbPlatformKey(platform),
            dbContentType: toDbContentType(platform, String(row.content_type || 'video'), typeMapByPlatform),
            status: 'scheduled',
            templateId: adapted.asset_instruction?.template_id ?? templateId,
          }) as CreatorScheduleResult;

          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'schedule',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: scheduled.status,
            failureType: scheduled.failure_reason ? classifyCreatorFailure(scheduled.failure_reason) : null,
            payload: {
              scheduling: scheduled,
            },
          });
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'confirmation',
            attemptCount: lockState.attempt_count,
            retryCount,
            planVersion,
            status: scheduled.published ? 'published' : scheduled.verified ? 'verified' : scheduled.status,
            payload: {
              confirmation: scheduled,
            },
          });

          if (scheduled.status === 'failed') {
            throw new BoltError(
              BOLT_ERROR_CODES.SCHEDULING_NOT_ELIGIBLE,
              scheduled.failure_reason || 'Creator scheduling failed',
              { details: { failure_reason: scheduled.failure_reason ?? null } }
            );
          }

          finalOutput = adapted;
          finalScheduling = scheduled;
          lastError = null;
          break;
        } catch (attemptError) {
          lastError = attemptError as Error;
          const classifiedFailure =
            failureType === 'stale'
              ? 'permanent'
              : classifyCreatorFailure(lastError);
          failureType = failureType === 'stale' ? 'stale' : classifiedFailure;
          await logCreatorExecutionAudit({
            campaignId,
            companyId,
            userId,
            dailyPlanId: row.id,
            platform,
            assetType,
            stage: 'failure',
            attemptCount: lockState.attempt_count,
            retryCount: attempt + 1,
            planVersion,
            status: classifiedFailure === 'transient' ? 'retrying' : 'failed',
            failureType,
            payload: {
              message: lastError.message,
            },
          });
          if (classifiedFailure !== 'transient' || failureType === 'stale') {
            break;
          }
          if (attempt + 1 < maxRetries) {
            await sleep(Math.min(4000, 500 * Math.pow(2, attempt)));
          }
        }
      }

      const nextRetryCount =
        finalScheduling || readinessFailure || failureType === 'permanent' || failureType === 'stale'
          ? retryCount
          : Math.min(maxRetries, retryCount + 1);

      const persisted = {
        ...parsed,
        ...(finalOutput || {}),
        intent_type: 'creator',
        asset_type: assetType,
        template_id: finalOutput?.asset_instruction?.template_id ?? templateId,
        scheduled_post_status: finalScheduling?.status ?? null,
        scheduled_post_id: finalScheduling?.scheduledPostId ?? null,
        schedule_confirmation: finalScheduling
          ? {
              status: finalScheduling.status,
              publish_source: finalScheduling.publish_source,
              platform_id: finalScheduling.platform_id,
              verified: finalScheduling.verified,
              published: finalScheduling.published,
              idempotency_key: finalScheduling.idempotency_key ?? null,
            }
          : null,
        content_status: finalScheduling ? 'scheduled' : failureType === 'stale' ? 'stale' : readinessFailure ? 'generated' : 'failed',
        failure_reason: readinessFailure ?? finalScheduling?.failure_reason ?? lastError?.message ?? null,
        failure_type: failureType,
        finalized_at: new Date().toISOString(),
      };
      const finalStatus =
        finalScheduling
          ? finalScheduling.status
          : readinessFailure
            ? 'generated'
            : persisted.content_status;

      const currentVersionBeforePersist = await getCurrentCampaignPlanVersion(campaignId);
      if (currentVersionBeforePersist !== planVersion) {
        persisted.content_status = 'stale';
        persisted.failure_reason = `Stale creator plan version ${planVersion}; current version is ${currentVersionBeforePersist}`;
        persisted.failure_type = 'stale';
      }
      await ownedDbTable('daily_content_plans')
        .update({
          content: JSON.stringify(persisted),
          intent_type: 'creator',
          asset_type: assetType,
          template_id: finalOutput?.asset_instruction?.template_id ?? templateId,
          plan_version: planVersion,
          retry_count: nextRetryCount,
          max_retries: maxRetries,
          failure_reason: persisted.failure_reason,
          failure_type: persisted.failure_type,
          content_status: persisted.content_status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      await upsertCreatorExecutionSummary({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        totalAttempts: lockState.attempt_count,
        retryCount: nextRetryCount,
        finalStatus,
        failureReason: persisted.failure_reason,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: finalScheduling ? 'execution_success_count' : 'execution_failure_count',
        metricValue: 1,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'retry_count',
        metricValue: nextRetryCount,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'avg_execution_latency',
        metricValue: Date.now() - executionStartedAt,
      });
      if (readinessFailure) {
        await recordCreatorExecutionMetric({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          metricName: 'validation_failure_count',
          metricValue: 1,
        });
      }

      if (finalScheduling) {
        scheduledCount++;
      } else {
        if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
        skippedCount++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLockConflict =
        error instanceof CreatorExecutionLockError &&
        /already locked/i.test(message);
      await logCreatorExecutionAudit({
        campaignId,
        companyId,
        userId,
        dailyPlanId: row.id,
        platform,
        assetType,
        stage: 'failure',
        attemptCount: lockState?.attempt_count ?? Math.max(1, toNumericValue(row.attempt_count, 0) + 1),
        retryCount: Math.min(
          Math.max(1, toNumericValue(row.max_retries, 3)),
          Math.max(0, toNumericValue(row.retry_count, 0) + 1)
        ),
        planVersion,
        status: error instanceof CreatorExecutionLockError ? 'locked' : 'failed',
        failureType:
          error instanceof CreatorExecutionLockError
            ? 'transient'
            : error instanceof CreatorExecutionRateLimitError
              ? 'transient'
              : classifyCreatorFailure(error),
        payload: {
          message,
        },
      });
      if (!isLockConflict) {
        await ownedDbTable('daily_content_plans')
          .update({
            plan_version: planVersion,
            retry_count: Math.min(
              Math.max(1, toNumericValue(row.max_retries, 3)),
              Math.max(0, toNumericValue(row.retry_count, 0) + 1)
            ),
            max_retries: Math.max(1, toNumericValue(row.max_retries, 3)),
            failure_reason: message,
            failure_type:
              message.toLowerCase().includes('stale creator plan version')
                ? 'stale'
                : classifyCreatorFailure(error),
            content_status: message.toLowerCase().includes('stale creator plan version') ? 'stale' : 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
      await upsertCreatorExecutionSummary({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        totalAttempts: lockState?.attempt_count ?? Math.max(1, toNumericValue(row.attempt_count, 0) + 1),
        retryCount: Math.min(
          Math.max(1, toNumericValue(row.max_retries, 3)),
          Math.max(0, toNumericValue(row.retry_count, 0) + 1)
        ),
        finalStatus: message.toLowerCase().includes('stale creator plan version') ? 'stale' : 'failed',
        failureReason: message,
      });
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'execution_failure_count',
        metricValue: 1,
      });
      if (classifyCreatorFailure(error) === 'permanent') {
        await recordCreatorExecutionMetric({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          metricName: 'validation_failure_count',
          metricValue: 1,
        });
      }
      await recordCreatorExecutionMetric({
        campaignId,
        dailyPlanId: row.id,
        platform,
        assetType,
        metricName: 'avg_execution_latency',
        metricValue: Date.now() - executionStartedAt,
      });
      if (classifyCreatorFailure(error) === 'permanent') {
        await writeCreatorDeadLetter({
          campaignId,
          dailyPlanId: row.id,
          platform,
          assetType,
          failureReason: message,
          payloadSnapshot: {
            content: parsed,
            row,
          },
        });
      }
      if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
      skippedCount++;
      console.warn('[schedule][creator] failed to process row', {
        rowId: row.id,
        platform,
        topic,
        error: message,
      });
    } finally {
      if (leaseHeartbeat) {
        await leaseHeartbeat.stop().catch(() => undefined);
      }
      if (lockState) {
        await releaseCreatorExecutionLock({
          dailyPlanId: row.id,
          lockOwner,
        }).catch((releaseError) => {
          console.warn('[schedule][creator] failed to release lock', {
            rowId: row.id,
            error: (releaseError as Error)?.message,
          });
        });
      }
    }
  }

  return {
    scheduled_count: scheduledCount,
    skipped_count: skippedCount,
    skipped_platforms: skippedPlatforms,
  };
}

export class ScheduleEligibilityError extends Error {
  code = 'SCHEDULE_NOT_READY';
  details: ReturnType<typeof evaluateScheduleEligibility>;

  constructor(details: ReturnType<typeof evaluateScheduleEligibility>) {
    super('Campaign has creator-dependent activities that are not ready for scheduling');
    this.name = 'ScheduleEligibilityError';
    this.details = details;
  }
}

