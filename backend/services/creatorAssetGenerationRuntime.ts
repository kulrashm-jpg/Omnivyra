import { ownedDbTable } from '../db/writeOwner';
import { generateCreatorThemeTreatment } from './creatorThemeTreatmentService';
import {
  getCreatorGovernance,
  isAttachmentRequiredFormat,
  isAutonomousRenderableFormat,
  normalizeCreatorFormat,
  CREATOR_LIFECYCLE_STATES,
} from '../../lib/shared/creatorGovernanceRegistry';
import { isSupportedManualVideoUpload } from '../../lib/shared/contentTypeClassification';
import { logPipelineEvent } from '../../lib/shared/observability';
import { applyTransition } from '../../lib/shared/creatorLifecycleStateMachine';
import { enqueueBoltCreatorRowExecution, awaitBoltCreatorRowExecution } from './creator/boltCreatorQueueBridge';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { recordRowFailure } from './boltRowFailureDiagnostics';

type DailyPlanRow = {
  id: string;
  campaign_id: string;
  week_number?: number | null;
  day_of_week?: string | null;
  date?: string | null;
  platform?: string | null;
  content_type?: string | null;
  title?: string | null;
  topic?: string | null;
  content?: unknown;
  content_status?: string | null;
  intent_type?: string | null;
  asset_type?: string | null;
  template_id?: string | null;
  plan_version?: number | null;
  retry_count?: number | null;
  max_retries?: number | null;
  failure_reason?: string | null;
  failure_type?: string | null;
};

/**
 * Generation mode hint. With per-row eligibility this no longer gates
 * runtime behavior — the runtime decides per row. The mode is kept as a
 * telemetry / log signal so dashboards still report what the campaign
 * looked like at runtime invocation.
 *
 *   SCHEDULE_AND_RENDER  — all rows autonomous, schedule outcome requested
 *   RENDER_ONLY          — all rows autonomous, no schedule requested
 *   MIXED                — mix of autonomous + attachment-required
 *   ATTACHMENT_ONLY      — all rows attachment-required (no rendering)
 *   GUIDANCE_ONLY        — legacy alias, retained for back-compat
 */
export type CreatorAssetGenerationMode =
  | 'SCHEDULE_AND_RENDER'
  | 'RENDER_ONLY'
  | 'MIXED'
  | 'ATTACHMENT_ONLY'
  | 'GUIDANCE_ONLY';

export type CreatorAssetGenerationResult = {
  mode: CreatorAssetGenerationMode;
  rendered_count: number;
  /**
   * Count of rows in `awaiting_media_upload`. Kept under the legacy
   * `guidance_ready_count` name for back-compat with downstream telemetry
   * consumers.
   */
  guidance_ready_count: number;
  /** Alias of `guidance_ready_count` under the new vocabulary. */
  awaiting_media_upload_count: number;
  skipped_count: number;
  failed_count: number;
  final_status:
    | 'render_ready'
    | 'guidance_ready'         // legacy alias when all rows are attachment-required
    | 'awaiting_media_upload'  // new aggregate when all rows are attachment-required
    | 'partially_rendered'     // autonomous rendered + attachment-required awaiting upload
    | 'partially_schedulable'  // synonym surfaced when at least one row is renderable
    | 'render_failed';
};

// Phase 3 cleanup — `hashAsset`, `mergeRenderedMedia`, the local
// `persistCreatorAsset`, and the local `extractMediaUrls` are all gone
// after the Phase 4 stabilization. The renderable row mutation is now
// owned by the creator-content queue worker (see
// creatorContentProcessor.ts), so the runtime no longer reads media URLs
// from a canonical output here. `safeObject` remains because it has a
// string-JSON-parse code path used by markAwaitingMediaUpload.

function safeObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Mark an attachment-required row (video / reel / short / podcast) as
 * `awaiting_media_upload` AND persist the full theme treatment, creator
 * guidance, and marketing package so the workspace surfaces a complete
 * production brief while the user uploads media.
 *
 * Transition is funneled through {@link applyTransition} so the FSM
 * captures the change in `content.creator_lifecycle_history` and mirrors
 * `creator_lifecycle_state` + `content_status` consistently.
 *
 * `content_status` is a free-text column on daily_content_plans (no CHECK
 * constraint — see database/daily_content_plans_creator_asset.sql:11-12),
 * so writing `awaiting_media_upload` directly is safe.
 *
 * If theme-treatment generation fails (LLM timeout, missing API key, etc.)
 * the row still lands in `awaiting_media_upload`; the failure reason is
 * captured on the row so the workspace can offer a retry without blocking
 * the upload affordance.
 */
async function markAwaitingMediaUpload(input: {
  row: DailyPlanRow;
  campaignId: string;
  companyId: string;
  userId: string;
}): Promise<void> {
  const { row, campaignId, companyId, userId } = input;
  const parsed = safeObject(row.content);
  const creatorCard = safeObject(parsed.creator_card);
  const platform = String(row.platform || parsed.platform || 'instagram').toLowerCase();
  const contentType = normalizeCreatorFormat(row.content_type || '');

  let treatment: Awaited<ReturnType<typeof generateCreatorThemeTreatment>> | null = null;
  let treatmentError: string | null = null;
  try {
    treatment = await generateCreatorThemeTreatment({
      companyId,
      userId,
      topic: String(row.topic || row.title || parsed.topic || 'Creator brief'),
      contentType,
      targetPlatforms: [platform],
      audience: String(parsed.whoAreWeWritingFor ?? parsed.target_audience ?? creatorCard.target_audience ?? ''),
      objective: String(parsed.dailyObjective ?? parsed.objective ?? creatorCard.objective ?? ''),
      summary: String(parsed.summary ?? parsed.whatProblemAreWeAddressing ?? creatorCard.summary ?? ''),
      creatorCard,
    });
  } catch (error) {
    treatmentError = error instanceof Error ? error.message : String(error);
    console.warn('[creator-runtime][theme-treatment-failed]', {
      daily_plan_id: row.id,
      content_type: contentType,
      message: treatmentError,
    });
  }

  // Persistence shape: keep the legacy structure intact, then OVERWRITE the
  // lifecycle + guidance fields. applyTransition validates the transition
  // from the row's current state (typically null on first emission) into
  // `awaiting_media_upload` and writes the audit history entry.
  const contentPatch: Record<string, unknown> = {
    render_policy: {
      mode: 'attachment_required',
      skipped_reason: 'attachment_required_format_awaiting_media_upload',
    },
    // Empty upload slot — populated by the upload API.
    uploaded_media_url: null,
    upload_source: null,
    upload_validated_at: null,
    upload_validation: null,
    uploaded_mime_type: null,
    uploaded_size_bytes: null,
    upload_error: null,
  };
  if (treatment) {
    contentPatch.theme_treatment = treatment.asset_payload;
    contentPatch.creator_guidance = treatment.asset_payload.creator_guidance;
    contentPatch.marketing_package = treatment.asset_payload.marketing_package;
    contentPatch.platform_notes = treatment.asset_payload.platform_notes;
    contentPatch.theme_treatment_metadata = treatment.metadata;
  } else {
    contentPatch.theme_treatment_error = treatmentError;
  }

  const transition = applyTransition(parsed, CREATOR_LIFECYCLE_STATES.AWAITING_MEDIA_UPLOAD, {
    contentPatch,
    reason: treatment ? 'guidance_persisted' : `guidance_failed:${treatmentError ?? 'unknown'}`,
  });

  await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify(transition.content),
      content_status: transition.contentStatus,
      failure_reason: null,
      failure_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
}

export async function runCreatorAssetGenerationRuntime(input: {
  campaignId: string;
  companyId: string | null;
  userId?: string | null;
  mode: CreatorAssetGenerationMode;
  onProgress?: (stage: string) => void;
  /** BOLT run id — when provided, per-row failures are recorded into
   *  bolt_row_failure_diagnostics so the failure dashboard can show
   *  which specific rows failed to render. Diagnostics are skipped when
   *  this is missing (non-BOLT callers). */
  runId?: string | null;
}): Promise<CreatorAssetGenerationResult> {
  const { data: campaign, error: campaignError } = await ownedDbTable('campaigns')
    .select('id, user_id, company_id')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (campaignError || !campaign) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND,
      `Campaign not found for creator asset generation: ${input.campaignId}`,
      { details: { campaign_id: input.campaignId } }
    );
  }

  const companyId = String(input.companyId || (campaign as any).company_id || '').trim();
  let userId = String(input.userId || (campaign as any).user_id || '').trim();
  if (!userId && companyId) {
    const { data: companyUser } = await ownedDbTable('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    userId = String((companyUser as any)?.user_id || '').trim();
  }
  if (!companyId || !userId) {
    throw new BoltError(
      BOLT_ERROR_CODES.CREATOR_ASSET_CONTEXT_INCOMPLETE,
      'Creator asset generation requires company_id and user_id',
      { details: { campaign_id: input.campaignId } }
    );
  }

  const { data, error } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id, week_number, day_of_week, date, platform, content_type, title, topic, content, content_status, intent_type, asset_type, template_id, plan_version, retry_count, max_retries, failure_reason, failure_type')
    .eq('campaign_id', input.campaignId)
    .order('date', { ascending: true })
    .order('week_number', { ascending: true });
  if (error) throw new BoltError(
    BOLT_ERROR_CODES.CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED,
    `Failed to load creator daily plans: ${error.message}`,
    { cause: error, details: { campaign_id: input.campaignId, db_error: error.message } }
  );

  const rows = Array.isArray(data) ? data as DailyPlanRow[] : [];
  // Phase 6 — engine + render + persist + FSM chain delegated to the
  // creatorOrchestrator via the queue worker. The runtime keeps row
  // iteration + BOLT-specific governance branching + daily_content_plans
  // failure-write safety net; the queue worker owns retries + render +
  // persist + FSM transitions for renderable rows.
  let renderedCount = 0;
  let awaitingUploadCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // ── Pass 1: governance branching (sequential, side-effectful). ─────────
  // Classifies each row + handles the synchronous side-effects:
  //   - awaiting_media_upload (uploads attachment-required theme treatment)
  //   - skipped (unsupported or non-renderable)
  // Collects renderable rows for parallel queue dispatch in Pass 2.
  type RenderableJob = {
    row: DailyPlanRow;
    contentType: string;
    parsed: Record<string, unknown>;
    creatorCard: Record<string, unknown>;
    maxRetries: number;
    primaryPlatform: string;
  };
  const renderable: RenderableJob[] = [];

  for (const row of rows) {
    const contentType = normalizeCreatorFormat(row.content_type || '');
    const governance = getCreatorGovernance(contentType);

    if (!governance) {
      skippedCount++;
      continue;
    }

    const supportedVideo = isSupportedManualVideoUpload(contentType);
    if (!supportedVideo && isAttachmentRequiredFormat(contentType)) {
      logPipelineEvent('creator.routing_deactivated', 'info', {
        campaign_id: input.campaignId,
        content_type: contentType,
        reason: 'unsupported_creator_flow_deactivated',
      }, { dedupeKey: contentType });
    }
    if (supportedVideo) {
      await markAwaitingMediaUpload({ row, campaignId: input.campaignId, companyId, userId });
      awaitingUploadCount++;
      input.onProgress?.(`awaiting-upload-${contentType}`);
      continue;
    }

    if (!isAutonomousRenderableFormat(contentType)) {
      skippedCount++;
      continue;
    }

    const parsed = safeObject(row.content);
    const creatorCard = safeObject(parsed.creator_card);
    const maxRetries = Math.max(1, Number(row.max_retries ?? 3) || 3);
    const primaryPlatform = String(row.platform || parsed.platform || 'linkedin').toLowerCase();
    input.onProgress?.(`render-creator-${contentType}`);
    renderable.push({ row, contentType, parsed, creatorCard, maxRetries, primaryPlatform });
  }

  // ── Pass 2: parallel queue dispatch. ───────────────────────────────────
  // Phase 6 — instead of awaiting each row sequentially, enqueue all
  // rows up to a concurrency cap and await them in parallel batches.
  // Retry / lifecycle / idempotency ownership stays inside the queue
  // worker; we ONLY change the wait pattern. Aggregate counters are
  // updated AFTER every batch settles so the failure_reason DB write
  // for enqueue/await errors still runs on the row's own thread of
  // control. The deterministic counts come from the per-row result
  // object the queue worker returns.
  const PARALLEL_CAP = Math.max(1, Math.min(8, renderable.length));
  for (let i = 0; i < renderable.length; i += PARALLEL_CAP) {
    const batch = renderable.slice(i, i + PARALLEL_CAP);
    const settled = await Promise.allSettled(batch.map(async (job) => {
      const handle = await enqueueBoltCreatorRowExecution({
        run_id: null,
        campaign_id: input.campaignId,
        company_id: companyId,
        user_id: userId || null,
        daily_plan_id: job.row.id,
        parsed_content: job.parsed,
        topic: String(job.row.topic || job.row.title || job.parsed.topic || 'Creator asset'),
        content_type: job.contentType,
        platform: job.primaryPlatform,
        audience: String(job.parsed.whoAreWeWritingFor ?? job.parsed.target_audience ?? job.creatorCard.target_audience ?? ''),
        objective: String(job.parsed.dailyObjective ?? job.parsed.objective ?? job.creatorCard.objective ?? ''),
        summary: String(job.parsed.summary ?? job.parsed.whatProblemAreWeAddressing ?? job.creatorCard.summary ?? ''),
        template_id: typeof job.parsed.template_id === 'string' ? job.parsed.template_id : job.row.template_id ?? null,
        max_retries: job.maxRetries,
      });
      return { job, result: await awaitBoltCreatorRowExecution(handle) };
    }));

    // Aggregate batch results deterministically (Promise.allSettled
    // preserves input order, so iteration matches `batch[i] ↔ settled[i]`).
    for (let k = 0; k < settled.length; k++) {
      const outcome = settled[k];
      const job = batch[k];
      if (outcome.status === 'fulfilled') {
        const { result } = outcome.value;
        if (result.rendered) {
          renderedCount++;
        } else if (result.failed) {
          failedCount++;
          console.warn('[creator-render-only][row-failed]', {
            daily_plan_id: job.row.id,
            content_type: job.contentType,
            message: result.failure_reason,
          });
          // Per-row diagnostic. Policy: SKIP-AND-RECORD — the runtime
          // already swallows the per-row failure into final_status so
          // the overall stage doesn't abort. We record the row so the
          // failure dashboard surfaces it without changing aggregation.
          if (input.runId) {
            await recordRowFailure({
              runId: input.runId,
              campaignId: input.campaignId,
              companyId: input.companyId,
              dailyPlanId: typeof job.row.id === 'string' ? job.row.id : null,
              weekNumber: typeof job.row.week_number === 'number' ? job.row.week_number : null,
              platform: typeof job.primaryPlatform === 'string' ? job.primaryPlatform : null,
              contentType: typeof job.contentType === 'string' ? job.contentType : null,
              stage: 'creator-asset-generation',
              code: BOLT_ERROR_CODES.CREATOR_ASSET_RENDER_FAILED,
              message: result.failure_reason || 'Creator row rendering failed',
              details: { rendered: false, failure_branch: 'worker_reported_failure' },
            });
          }
        } else {
          skippedCount++;
        }
      } else {
        failedCount++;
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        console.warn('[creator-render-only][row-enqueue-failed]', {
          daily_plan_id: job.row.id,
          content_type: job.contentType,
          message,
        });
        // Per-row diagnostic for the enqueue-side failure (worker
        // never ran). Same SKIP-AND-RECORD policy.
        if (input.runId) {
          await recordRowFailure({
            runId: input.runId,
            campaignId: input.campaignId,
            companyId: input.companyId,
            dailyPlanId: typeof job.row.id === 'string' ? job.row.id : null,
            weekNumber: typeof job.row.week_number === 'number' ? job.row.week_number : null,
            platform: typeof job.primaryPlatform === 'string' ? job.primaryPlatform : null,
            contentType: typeof job.contentType === 'string' ? job.contentType : null,
            stage: 'creator-asset-generation',
            code: BOLT_ERROR_CODES.CREATOR_ASSET_QUEUE_FAILURE,
            message: message || 'Creator row enqueue failed',
            details: { rendered: false, failure_branch: 'enqueue_rejected' },
          });
        }
        // Safety-net DB write: the worker never ran, so the row would
        // otherwise stay in a stale state. Mirrors the prior sequential
        // failure path.
        await ownedDbTable('daily_content_plans')
          .update({
            retry_count: job.maxRetries,
            max_retries: job.maxRetries,
            failure_reason: message,
            failure_type: 'transient',
            content_status: 'render_failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.row.id);
      }
    }
  }

  // ── Final-status aggregate ──────────────────────────────────────────────
  // Maps the per-row counts to a campaign-level summary. With the per-row
  // model this is purely a telemetry signal — it never gates downstream
  // scheduling, which now operates row by row.
  const finalStatus: CreatorAssetGenerationResult['final_status'] =
    renderedCount > 0 && awaitingUploadCount > 0 && failedCount === 0
      ? 'partially_rendered'
      : renderedCount > 0 && failedCount === 0
        ? 'render_ready'
        : renderedCount > 0 && failedCount > 0
          ? 'partially_rendered'
          : renderedCount === 0 && awaitingUploadCount > 0 && failedCount === 0
            ? 'awaiting_media_upload'
            : 'render_failed';

  return {
    mode: input.mode,
    rendered_count: renderedCount,
    guidance_ready_count: awaitingUploadCount, // legacy alias preserved
    awaiting_media_upload_count: awaitingUploadCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    final_status: finalStatus,
  };
}
