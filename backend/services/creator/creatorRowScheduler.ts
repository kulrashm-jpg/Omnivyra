/**
 * Creator single-row scheduler — post-upload auto-scheduling.
 *
 * When a user uploads media for an attachment-required creator row
 * (video / reel / short) the upload endpoints transition the row to
 * `ready_for_schedule`. This module schedules THAT ONE ROW immediately —
 * insert `scheduled_posts`, enqueue the publish job, flip the lifecycle to
 * `scheduled`, and write the `scheduled_post_id` back-pointer (which is what
 * flips the row from the calendar's pending feed to the scheduled feed).
 *
 * It does NOT rerun the BOLT pipeline / planner / asset generation. The
 * insert+enqueue+transition core (`scheduleCreatorAttachmentPost`) is the
 * SAME unit the batch scheduler (`structuredPlanScheduler.ts`) delegates to,
 * so the single-row and batch paths produce byte-identical scheduled posts.
 *
 * Idempotency (no duplicate scheduled_posts / calendar entries):
 *   1. Short-circuit if the row is already `scheduled` or already carries a
 *      `scheduled_post_id` in its content JSON.
 *   2. DB-level: every insert carries a deterministic `idempotency_key`
 *      (`creator-upload:<dailyPlanId>`) backed by the partial unique index
 *      `uidx_scheduled_posts_idempotency_key`; a racing second insert hits
 *      23505 and we recover the existing row instead of duplicating.
 *   3. FSM-level: `applyTransition(... SCHEDULED)` rejects `scheduled →
 *      scheduled`, a final backstop against a double transition.
 *
 * This module is intentionally lean (no queue-worker imports) so it can be
 * pulled into the hot upload API routes without dragging in BullMQ workers.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import { getPlatformRules, listPlatformCatalog } from '../platformIntelligenceService';
import { isIdempotencyCollision } from '../boltScheduleIdempotency';
import {
  getRowSchedulingEligibility,
  isAttachmentRequiredFormat,
  isAutonomousRenderableFormat,
  normalizeCreatorFormat,
  CREATOR_LIFECYCLE_STATES,
} from '../../../lib/shared/creatorGovernanceRegistry';
import {
  applyTransition,
  readLifecycleState,
  CreatorLifecycleTransitionError,
} from '../../../lib/shared/creatorLifecycleStateMachine';
import { resolveVideoForPlatform, readCreatorVideoAsset } from '../../../lib/shared/creatorVideoResolution';
import { buildAutonomousScheduleDiagnostic } from './creatorScheduleDrift';

/**
 * Read the per-video YouTube visibility the user picked at upload from the
 * parsed row content (creator_asset.youtube_visibility). Returns
 * 'unlisted' | 'private', or null (null = the YouTube adapter default 'public').
 * Never throws.
 */
function extractYouTubeVisibility(attachedContent: unknown): string | null {
  try {
    const p = (attachedContent && typeof attachedContent === 'object') ? attachedContent as Record<string, any> : {};
    const asset = (p.creator_asset && typeof p.creator_asset === 'object') ? p.creator_asset : {};
    const vis = String(asset.youtube_visibility ?? p.youtube_visibility ?? '').trim().toLowerCase();
    return vis === 'unlisted' || vis === 'private' ? vis : null;
  } catch {
    return null;
  }
}

// ── Small pure helpers (faithful copies of the structuredPlanScheduler
//    internals; the content-type fallback map is already duplicated across
//    structuredPlanScheduler / boltScheduleBlockProcessor / boltContentJobProcessor,
//    so a self-contained copy here matches the established pattern). ──────────

const SCHEDULE_MIN_LEAD_MS = 60 * 60 * 1000; // 1 hour — never schedule in the past.
function enforceScheduleFloor(d: Date): Date {
  const floor = Date.now() + SCHEDULE_MIN_LEAD_MS;
  if (Number.isNaN(d.getTime()) || d.getTime() < floor) return new Date(floor);
  return d;
}

function toDbPlatformKey(canonicalPlatform: string): string {
  return canonicalPlatform === 'x' ? 'twitter' : canonicalPlatform;
}

const FALLBACK_CONTENT_TYPE_MAP: Record<string, Record<string, string>> = {
  linkedin:  { post: 'post', video: 'video', article: 'article', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post' },
  x:         { post: 'tweet', video: 'video', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet' },
  instagram: { post: 'feed_post', video: 'reel', carousel: 'feed_post', image: 'feed_post', reel: 'reel', short: 'reel', story: 'story' },
  youtube:   { post: 'video', video: 'video', carousel: 'short', image: 'video', reel: 'short', short: 'short', story: 'video' },
  facebook:  { post: 'post', video: 'video', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post' },
};

function toDbContentType(
  platform: string,
  contentType: string,
  typeMapByPlatform: Record<string, Record<string, string>>,
): string {
  const normalizedType = String(contentType || '').toLowerCase().trim();
  const fromDb = typeMapByPlatform[platform];
  if (fromDb && fromDb[normalizedType]) return fromDb[normalizedType];
  const fallback = FALLBACK_CONTENT_TYPE_MAP[platform] || FALLBACK_CONTENT_TYPE_MAP.linkedin;
  return fallback[normalizedType] || 'post';
}

function buildScheduledForFromDailyPlan(dateStr: string, timeStr: string | undefined): Date {
  const time = String(timeStr ?? '09:00').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})/);
  const hours = hhmm ? Math.min(23, Math.max(0, Number(hhmm[1]))) : 9;
  const minutes = hhmm ? Math.min(59, Math.max(0, Number(hhmm[2]))) : 0;
  const datePart = String(dateStr ?? '').slice(0, 10);
  if (!datePart) return enforceScheduleFloor(new Date(0));
  return enforceScheduleFloor(new Date(Date.UTC(
    parseInt(datePart.slice(0, 4), 10),
    parseInt(datePart.slice(5, 7), 10) - 1,
    parseInt(datePart.slice(8, 10), 10),
    hours,
    minutes,
    0,
  )));
}

function tryParseExecutionContent(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractTypeMapFromPlatformRules(bundle: any): Record<string, string> | null {
  const rules = bundle?.content_rules || [];
  for (const rule of rules) {
    const candidate = rule?.formatting_rules?.type_map;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, string>;
    }
  }
  return null;
}

// ── Public types ────────────────────────────────────────────────────────────

export type CreatorAttachmentRow = {
  id: string;
  campaign_id: string;
  date: string;
  scheduled_time?: string | null;
  topic?: string | null;
  title?: string | null;
  content_type: string;
};

export type CreatorAttachmentScheduleResult = {
  status: 'scheduled' | 'already_scheduled' | 'skipped' | 'error';
  scheduledPostId: string | null;
  reason?: string;
};

/**
 * Per-variant differences between the two creator scheduling paths:
 *   - attachment (video/reel/short): media = user-uploaded URL.
 *   - autonomous (image/carousel/infographic): media = AI-rendered URLs.
 * Everything downstream (insert → enqueue → FSM flip → back-pointer) is
 * identical, so the variant only carries the media source + the
 * deterministic idempotency key + audit wording + the state to restore on
 * a transient insert failure.
 */
type CreatorScheduleVariant = {
  mediaUrls: string[];
  idempotencyKey: string;
  transitionReason: string;
  /** content_status to restore on a transient (non-collision) insert error. */
  failureRestoreStatus: string;
  /** skip reason when mediaUrls is empty. */
  noMediaReason: string;
};

/**
 * SHARED CORE — insert scheduled_posts + enqueue + flip lifecycle to
 * `scheduled`, for one creator row whose media is ready (uploaded OR
 * rendered). Called by BOTH the post-upload trigger, the autonomous
 * render-complete trigger, and the batch scheduler
 * (`structuredPlanScheduler.ts`) so all paths never diverge.
 *
 * The caller is responsible for the eligibility gate, resolving the
 * normalized `platform` + `socialAccountId` + DB `platform`/`contentType`,
 * and supplying the media `variant`.
 */
async function scheduleCreatorRowPost(input: {
  row: CreatorAttachmentRow;
  attachedContent: Record<string, unknown>;
  userId: string;
  campaignId: string;
  platform: string;
  socialAccountId: string;
  dbPlatform: string;
  dbContentType: string;
  variant: CreatorScheduleVariant;
}): Promise<CreatorAttachmentScheduleResult> {
  const { row, attachedContent, userId, campaignId, platform, socialAccountId, dbPlatform, dbContentType, variant } = input;
  const rowContentType = normalizeCreatorFormat(row.content_type || '');

  // (1) Idempotency short-circuit — already scheduled.
  const existingState = readLifecycleState(attachedContent);
  const existingScheduledPostId = typeof attachedContent.scheduled_post_id === 'string'
    ? attachedContent.scheduled_post_id
    : null;
  if (existingState === CREATOR_LIFECYCLE_STATES.SCHEDULED || existingScheduledPostId) {
    return { status: 'already_scheduled', scheduledPostId: existingScheduledPostId };
  }

  const mediaUrls = variant.mediaUrls.map((u) => String(u || '').trim()).filter(Boolean);
  if (mediaUrls.length === 0) {
    return { status: 'skipped', scheduledPostId: null, reason: variant.noMediaReason };
  }

  // Caption + hashtags — same derivation as the batch path.
  const marketingPackage = (attachedContent.marketing_package && typeof attachedContent.marketing_package === 'object' && !Array.isArray(attachedContent.marketing_package))
    ? attachedContent.marketing_package as Record<string, unknown>
    : {};
  const themeTreatment = (attachedContent.theme_treatment && typeof attachedContent.theme_treatment === 'object' && !Array.isArray(attachedContent.theme_treatment))
    ? attachedContent.theme_treatment as Record<string, unknown>
    : {};
  const captionFromPackage = String((marketingPackage.caption || (themeTreatment as any)?.marketing_package?.caption || '') as string).trim();
  const captionFallback = String(row.topic || row.title || (attachedContent as any).caption || '').trim();
  const finalCaption = captionFromPackage || captionFallback || `${rowContentType} for ${platform}`;
  const hashtagsRaw = Array.isArray(marketingPackage.hashtags) ? marketingPackage.hashtags : [];
  const finalHashtags = hashtagsRaw.map((tag) => String(tag).trim()).filter(Boolean);
  const scheduledFor = buildScheduledForFromDailyPlan(row.date, row.scheduled_time ?? undefined);
  const idempotencyKey = variant.idempotencyKey;
  const nowIso = new Date().toISOString();

  // (1b) DESIGN ATTRIBUTION propagation — the single creator scheduling seam.
  // Resolve the immutable attribution via the SAME canonical builder used at
  // generation (deterministic → identical stamp; campaign/collection/design-
  // system fields come from the campaign's pinned design system). Copied onto
  // scheduled_posts so the Performance Intelligence reader consumes it directly.
  let designAttribution: Record<string, unknown> | null = null;
  try {
    const ac = attachedContent as Record<string, unknown>;
    const card = (ac.creator_card && typeof ac.creator_card === 'object' ? ac.creator_card : {}) as Record<string, unknown>;
    const templateId = (typeof ac.template_id === 'string' && ac.template_id) || (typeof ac.infographic_template_id === 'string' && ac.infographic_template_id) || (typeof card.template_id === 'string' && card.template_id) || null;
    const tvRaw = ac.template_version ?? card.template_version;
    const templateVersion = typeof tvRaw === 'number' ? tvRaw : Number.isFinite(Number(tvRaw)) ? Number(tvRaw) : null;
    const { resolveCampaignAttribution } = await import('./designAttributionService');
    designAttribution = await resolveCampaignAttribution({ campaignId, templateId, templateVersion }) as unknown as Record<string, unknown>;
  } catch { /* best-effort — attribution stays null, analytics loop simply skips this asset */ }

  // (2) INSERT scheduled_posts with a deterministic idempotency_key.
  let scheduledPostId: string | null = null;
  const { data: inserted, error: insertError } = await ownedDbTable('scheduled_posts')
    .insert({
      user_id: userId,
      social_account_id: socialAccountId,
      campaign_id: campaignId,
      platform: dbPlatform,
      content_type: dbContentType,
      title: String(row.topic || row.title || '').trim() || undefined,
      content: finalCaption,
      hashtags: finalHashtags.length > 0 ? finalHashtags : null,
      media_urls: mediaUrls,
      scheduled_for: scheduledFor.toISOString(),
      status: 'scheduled',
      repurpose_index: 1,
      repurpose_total: 1,
      idempotency_key: idempotencyKey,
      design_attribution: designAttribution,
      // Per-video YouTube visibility chosen at upload (creator_asset). NULL →
      // adapter default 'public'. Defensive: any parse issue leaves it null.
      youtube_privacy: extractYouTubeVisibility(attachedContent),
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    // (2b) Idempotency collision — another caller already inserted this row's
    // post. Recover the existing id and continue to the lifecycle flip.
    if (isIdempotencyCollision(insertError)) {
      const { data: existing } = await ownedDbTable('scheduled_posts')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      scheduledPostId = (existing as { id?: string } | null)?.id ?? null;
      if (!scheduledPostId) {
        return { status: 'already_scheduled', scheduledPostId: null, reason: 'idempotency_collision_no_row' };
      }
    } else {
      // Transient insert failure — leave the row at ready_for_schedule so a
      // retry (or the next pipeline run) can schedule it. Mirror the batch
      // path's failure annotation.
      await ownedDbTable('daily_content_plans')
        .update({
          content: JSON.stringify({ ...attachedContent, schedule_error: insertError.message }),
          content_status: variant.failureRestoreStatus,
          failure_reason: insertError.message,
          failure_type: 'transient',
          updated_at: nowIso,
        })
        .eq('id', row.id);
      return { status: 'error', scheduledPostId: null, reason: insertError.message };
    }
  } else {
    scheduledPostId = (inserted as { id?: string } | null)?.id ?? null;
  }

  // (3) Enqueue the publish job (best-effort — the scheduler sweep is the backstop).
  if (scheduledPostId) {
    try {
      await enqueueScheduledPostAt(String(scheduledPostId), String(userId), String(socialAccountId), scheduledFor.toISOString());
    } catch (enqueueError: any) {
      console.warn('[creator-row-schedule][enqueue-failed]', enqueueError?.message);
    }
  }

  // (4) Flip lifecycle to SCHEDULED + write the scheduled_post_id back-pointer.
  let scheduledTransition;
  try {
    scheduledTransition = applyTransition(attachedContent, CREATOR_LIFECYCLE_STATES.SCHEDULED, {
      contentPatch: { scheduled_post_id: scheduledPostId, scheduled_at: nowIso },
      reason: variant.transitionReason,
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      // The row was concurrently moved to `scheduled` — idempotent outcome.
      return { status: 'already_scheduled', scheduledPostId };
    }
    throw error;
  }

  try {
    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify(scheduledTransition.content),
        content_status: scheduledTransition.contentStatus,
        scheduled_post_id: scheduledPostId,
        failure_reason: null,
        failure_type: null,
        updated_at: nowIso,
      })
      .eq('id', row.id);
  } catch {
    // Pre-migration fallback (no `scheduled_post_id` column yet). The JSON
    // content already carries scheduled_post_id via the transition patch.
    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify(scheduledTransition.content),
        content_status: scheduledTransition.contentStatus,
        failure_reason: null,
        failure_type: null,
        updated_at: nowIso,
      })
      .eq('id', row.id);
  }

  return { status: 'scheduled', scheduledPostId };
}

/**
 * Attachment (video/reel/short) scheduling — media comes from the
 * user-uploaded URL. Public signature unchanged (callers: upload endpoints +
 * structuredPlanScheduler batch path).
 */
export async function scheduleCreatorAttachmentPost(input: {
  row: CreatorAttachmentRow;
  attachedContent: Record<string, unknown>;
  userId: string;
  campaignId: string;
  platform: string;
  socialAccountId: string;
  dbPlatform: string;
  dbContentType: string;
}): Promise<CreatorAttachmentScheduleResult> {
  const uploadedMediaUrl = String(input.attachedContent.uploaded_media_url || '').trim();
  // Single authority for "which video URL is used for platform X?". For
  // 'same'/legacy rows this returns the validated uploaded_media_url unchanged;
  // for 'different' rows it returns the platform-specific URL when supplied,
  // falling back to the same-video url / validated upload (never fails).
  //
  // Format propagation: thread the row's existing format (its creator content
  // format) so the authority can resolve (platform, format) — e.g. a YouTube
  // 'short' row resolves the Short mapping. Where the row's format code matches
  // the stored mapping format the format-specific asset wins; otherwise the
  // authority falls back to the platform primary (no regression).
  const resolvedMediaUrl = resolveVideoForPlatform({
    creatorAsset: readCreatorVideoAsset(input.attachedContent),
    platform: input.platform,
    format: normalizeCreatorFormat(input.row.content_type || ''),
    uploadedMediaUrl,
  });
  return scheduleCreatorRowPost({
    ...input,
    variant: {
      mediaUrls: resolvedMediaUrl ? [resolvedMediaUrl] : [],
      idempotencyKey: `creator-upload:${input.row.id}`,
      transitionReason: 'attachment_post_upload_scheduled',
      failureRestoreStatus: CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE,
      noMediaReason: 'no_uploaded_media',
    },
  });
}

/**
 * Read the AI-rendered media URLs an autonomous row carries after the
 * render worker writes `content.rendered_asset.urls` (string[] from
 * extractCreatorMediaUrls).
 */
function readRenderedMediaUrls(content: Record<string, unknown>): string[] {
  const rendered = content.rendered_asset;
  if (!rendered || typeof rendered !== 'object' || Array.isArray(rendered)) return [];
  const urls = (rendered as Record<string, unknown>).urls;
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => String(u || '').trim()).filter(Boolean);
}

/**
 * Best-effort persistence of the visibility marker. Never throws and never
 * mutates content_status / failure columns / lifecycle — observability only.
 */
async function annotateAutonomousScheduleSkip(
  rowId: string,
  content: Record<string, unknown>,
  reason: string,
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify({ ...content, ...buildAutonomousScheduleDiagnostic(reason, nowIso) }),
        updated_at: nowIso,
      })
      .eq('id', rowId);
  } catch (err: any) {
    console.warn('[creator-row-schedule][autonomous-skip-annotate-failed]', rowId, err?.message);
  }
}

/**
 * Autonomous (image/carousel/infographic) scheduling — media comes from the
 * already-rendered asset URLs. Distinct idempotency key (`creator-render:`)
 * so it never collides with the upload path.
 */
export async function scheduleRenderedAutonomousPost(input: {
  row: CreatorAttachmentRow;
  attachedContent: Record<string, unknown>;
  userId: string;
  campaignId: string;
  platform: string;
  socialAccountId: string;
  dbPlatform: string;
  dbContentType: string;
}): Promise<CreatorAttachmentScheduleResult> {
  return scheduleCreatorRowPost({
    ...input,
    variant: {
      mediaUrls: readRenderedMediaUrls(input.attachedContent),
      idempotencyKey: `creator-render:${input.row.id}`,
      transitionReason: 'autonomous_render_complete_scheduled',
      failureRestoreStatus: CREATOR_LIFECYCLE_STATES.RENDER_READY,
      noMediaReason: 'no_rendered_media',
    },
  });
}

/**
 * POST-UPLOAD ENTRY POINT — schedule a single creator attachment row by id,
 * resolving all context (campaign → user/company → social account → platform
 * type map) itself. Best-effort: NEVER throws to the caller. The upload
 * endpoints call this after committing `ready_for_schedule`; on any skip/error
 * the row simply stays `ready_for_schedule` and a later pipeline run still
 * catches it.
 */
export async function autoScheduleReadyCreatorRowById(
  dailyPlanId: string,
): Promise<CreatorAttachmentScheduleResult> {
  try {
    // Safe column list (mirrors the batch scheduler's select; intentionally
    // omits `scheduled_post_id` which may be absent in some envs — the
    // idempotency short-circuit reads it from the content JSON instead).
    const { data: rowRaw, error: rowError } = await ownedDbTable('daily_content_plans')
      .select('id, campaign_id, date, scheduled_time, platform, content_type, title, topic, content, content_status')
      .eq('id', dailyPlanId)
      .maybeSingle();
    if (rowError) return { status: 'error', scheduledPostId: null, reason: rowError.message };
    if (!rowRaw) return { status: 'error', scheduledPostId: null, reason: 'daily_plan_not_found' };
    const row = rowRaw as Record<string, any>;

    const rowContentType = normalizeCreatorFormat(row.content_type || '');
    if (!isAttachmentRequiredFormat(rowContentType)) {
      // Autonomous rows are scheduled by the pipeline, not by upload.
      return { status: 'skipped', scheduledPostId: null, reason: 'not_attachment_format' };
    }

    const attachedContent = tryParseExecutionContent(row.content);

    // Eligibility gate — only schedule a genuinely ready row.
    const eligibility = getRowSchedulingEligibility({
      content_type: rowContentType,
      content_status: row.content_status ?? null,
      creator_lifecycle_state: typeof attachedContent.creator_lifecycle_state === 'string'
        ? attachedContent.creator_lifecycle_state
        : null,
      uploaded_media_url: attachedContent.uploaded_media_url,
      upload_validation: attachedContent.upload_validation,
    });
    if (!eligibility.can_schedule_now) {
      return { status: 'skipped', scheduledPostId: null, reason: eligibility.reason };
    }

    // Resolve owning user + company.
    const { data: campaignRaw } = await ownedDbTable('campaigns')
      .select('id, user_id, company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    const campaign = campaignRaw as { user_id?: string | null; company_id?: string | null } | null;
    const companyId = campaign?.company_id ?? null;
    let userId = campaign?.user_id ?? null;
    if (!userId && companyId) {
      const { data: companyUser } = await ownedDbTable('user_company_roles')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      userId = (companyUser as { user_id?: string } | null)?.user_id ?? null;
    }
    if (!userId) {
      return { status: 'skipped', scheduledPostId: null, reason: 'no_user_for_campaign' };
    }

    // Normalize platforms via the active platform catalog.
    const catalog = await listPlatformCatalog({ activeOnly: true }).catch(() => ({ platforms: [] as any[] }));
    const allowed = new Set<string>(
      (catalog.platforms || [])
        .map((p: any) => String(p?.canonical_key || '').toLowerCase().trim())
        .filter(Boolean),
    );
    const normalize = (p: string): string | null => {
      const n = String(p || '').toLowerCase().trim();
      const canonical = n === 'twitter' ? 'x' : n;
      return allowed.has(canonical) ? canonical : (allowed.size === 0 ? canonical : null);
    };

    const platform = normalize(String(row.platform || ''));
    if (!platform) {
      return { status: 'skipped', scheduledPostId: null, reason: 'unrecognized_platform' };
    }

    // Resolve the connected social account for this user + platform.
    let accountsQuery = ownedDbTable('social_accounts')
      .select('id, platform')
      .eq('user_id', userId)
      .eq('is_active', true);
    accountsQuery = companyId
      ? accountsQuery.or(`company_id.eq.${companyId},company_id.is.null`)
      : accountsQuery.is('company_id', null);
    const { data: accounts } = await accountsQuery;
    const socialAccountId = (accounts as Array<{ id: string; platform: string }> | null ?? [])
      .find((a) => normalize(a.platform) === platform)?.id ?? null;
    if (!socialAccountId) {
      return { status: 'skipped', scheduledPostId: null, reason: 'no_social_account' };
    }

    // Resolve the platform-specific DB content_type.
    let typeMap: Record<string, string> | null = null;
    try {
      typeMap = extractTypeMapFromPlatformRules(await getPlatformRules(platform));
    } catch {
      typeMap = null;
    }
    const dbContentType = toDbContentType(platform, rowContentType, typeMap ? { [platform]: typeMap } : {});

    return await scheduleCreatorAttachmentPost({
      row: {
        id: row.id,
        campaign_id: row.campaign_id,
        date: row.date,
        scheduled_time: row.scheduled_time,
        topic: row.topic,
        title: row.title,
        content_type: row.content_type,
      },
      attachedContent,
      userId,
      campaignId: row.campaign_id,
      platform,
      socialAccountId,
      dbPlatform: toDbPlatformKey(platform),
      dbContentType,
    });
  } catch (error: any) {
    console.warn('[creator-row-schedule][auto-schedule-failed]', dailyPlanId, error?.message);
    return { status: 'error', scheduledPostId: null, reason: error?.message ?? 'unknown_error' };
  }
}

/**
 * RENDER-COMPLETE ENTRY POINT — schedule a single AUTONOMOUS creator row
 * (image/carousel/infographic) by id after its asset has rendered. Called by
 * the render worker (creatorContentProcessor) ONLY for Schedule outcomes
 * (gated by the `auto_schedule_on_render` payload flag). Best-effort: NEVER
 * throws; on any skip/error the row stays `render_ready` and the BOLT
 * schedule stage remains the backstop.
 */
export async function scheduleRenderedAutonomousRowById(
  dailyPlanId: string,
): Promise<CreatorAttachmentScheduleResult> {
  try {
    const { data: rowRaw, error: rowError } = await ownedDbTable('daily_content_plans')
      .select('id, campaign_id, date, scheduled_time, platform, content_type, title, topic, content, content_status')
      .eq('id', dailyPlanId)
      .maybeSingle();
    if (rowError) return { status: 'error', scheduledPostId: null, reason: rowError.message };
    if (!rowRaw) return { status: 'error', scheduledPostId: null, reason: 'daily_plan_not_found' };
    const row = rowRaw as Record<string, any>;

    const rowContentType = normalizeCreatorFormat(row.content_type || '');
    if (!isAutonomousRenderableFormat(rowContentType)) {
      // Attachment rows schedule via the upload trigger, not here.
      return { status: 'skipped', scheduledPostId: null, reason: 'not_autonomous_format' };
    }

    const attachedContent = tryParseExecutionContent(row.content);

    // Eligibility gate — autonomous rows are schedulable at render_ready.
    const eligibility = getRowSchedulingEligibility({
      content_type: rowContentType,
      content_status: row.content_status ?? null,
      creator_lifecycle_state: typeof attachedContent.creator_lifecycle_state === 'string'
        ? attachedContent.creator_lifecycle_state
        : null,
    });
    if (!eligibility.can_schedule_now) {
      await annotateAutonomousScheduleSkip(row.id, attachedContent, eligibility.reason);
      return { status: 'skipped', scheduledPostId: null, reason: eligibility.reason };
    }
    if (readRenderedMediaUrls(attachedContent).length === 0) {
      await annotateAutonomousScheduleSkip(row.id, attachedContent, 'no_rendered_media');
      return { status: 'skipped', scheduledPostId: null, reason: 'no_rendered_media' };
    }

    // Resolve owning user + company.
    const { data: campaignRaw } = await ownedDbTable('campaigns')
      .select('id, user_id, company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    const campaign = campaignRaw as { user_id?: string | null; company_id?: string | null } | null;
    const companyId = campaign?.company_id ?? null;
    let userId = campaign?.user_id ?? null;
    if (!userId && companyId) {
      const { data: companyUser } = await ownedDbTable('user_company_roles')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      userId = (companyUser as { user_id?: string } | null)?.user_id ?? null;
    }
    if (!userId) {
      await annotateAutonomousScheduleSkip(row.id, attachedContent, 'no_user_for_campaign');
      return { status: 'skipped', scheduledPostId: null, reason: 'no_user_for_campaign' };
    }

    // Normalize platforms via the active platform catalog.
    const catalog = await listPlatformCatalog({ activeOnly: true }).catch(() => ({ platforms: [] as any[] }));
    const allowed = new Set<string>(
      (catalog.platforms || [])
        .map((p: any) => String(p?.canonical_key || '').toLowerCase().trim())
        .filter(Boolean),
    );
    const normalize = (p: string): string | null => {
      const n = String(p || '').toLowerCase().trim();
      const canonical = n === 'twitter' ? 'x' : n;
      return allowed.has(canonical) ? canonical : (allowed.size === 0 ? canonical : null);
    };

    const platform = normalize(String(row.platform || ''));
    if (!platform) {
      await annotateAutonomousScheduleSkip(row.id, attachedContent, 'unrecognized_platform');
      return { status: 'skipped', scheduledPostId: null, reason: 'unrecognized_platform' };
    }

    // Resolve the connected social account for this user + platform.
    let accountsQuery = ownedDbTable('social_accounts')
      .select('id, platform')
      .eq('user_id', userId)
      .eq('is_active', true);
    accountsQuery = companyId
      ? accountsQuery.or(`company_id.eq.${companyId},company_id.is.null`)
      : accountsQuery.is('company_id', null);
    const { data: accounts } = await accountsQuery;
    const socialAccountId = (accounts as Array<{ id: string; platform: string }> | null ?? [])
      .find((a) => normalize(a.platform) === platform)?.id ?? null;
    if (!socialAccountId) {
      await annotateAutonomousScheduleSkip(row.id, attachedContent, 'no_social_account');
      return { status: 'skipped', scheduledPostId: null, reason: 'no_social_account' };
    }

    // Resolve the platform-specific DB content_type.
    let typeMap: Record<string, string> | null = null;
    try {
      typeMap = extractTypeMapFromPlatformRules(await getPlatformRules(platform));
    } catch {
      typeMap = null;
    }
    const dbContentType = toDbContentType(platform, rowContentType, typeMap ? { [platform]: typeMap } : {});

    return await scheduleRenderedAutonomousPost({
      row: {
        id: row.id,
        campaign_id: row.campaign_id,
        date: row.date,
        scheduled_time: row.scheduled_time,
        topic: row.topic,
        title: row.title,
        content_type: row.content_type,
      },
      attachedContent,
      userId,
      campaignId: row.campaign_id,
      platform,
      socialAccountId,
      dbPlatform: toDbPlatformKey(platform),
      dbContentType,
    });
  } catch (error: any) {
    console.warn('[creator-row-schedule][autonomous-auto-schedule-failed]', dailyPlanId, error?.message);
    return { status: 'error', scheduledPostId: null, reason: error?.message ?? 'unknown_error' };
  }
}
