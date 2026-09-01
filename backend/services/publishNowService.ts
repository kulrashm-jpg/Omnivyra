import { ownedDbTable } from '../db/writeOwner';
/**
 * Publish Now Service
 *
 * Minimal wrapper for immediate publish using the canonical pipeline.
 * Reuses the same logic as publishProcessor → platformAdapter.
 * Used by super-admin publish API and any caller that needs "publish now" without enqueueing.
 *
 * @see docs/CANONICAL-SOCIAL-PLATFORM-OPERATIONS-DESIGN.md
 */

import { supabase } from '../db/supabaseClient';
import {
  getScheduledPost,
  updateScheduledPostOnPublish,
  updateScheduledPostOnFailure,
} from '../db/queries';
import { publishToPlatform } from '../adapters/platformAdapter';
import { categorizeError } from './errorRecoveryService';
import { recordPostAnalytics } from './analyticsService';
import { logActivity } from './activityLogger';
import { checkAndCompleteCampaignIfEligible } from './CampaignCompletionService';
import { validatePlatformContentCompatibility } from './platformContentValidator';
import { validatePublishReadiness } from './publishReadinessValidator';
import { refreshDurableMediaBeforePublish } from './mediaReferenceResolver';
import { resolvePublishMedia } from './creator/creatorPublishResolution';
import { resolvePublishingOrganization } from './creator/publishingOrganizationResolver';
import { logPipelineEvent } from '../../lib/shared/observability';
import { logger } from './logger';
import { CAPABILITY_LOG_EVENTS, type CapabilityLogPayload } from '../../lib/shared/social/capabilityEvents';
import {
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
} from '../../lib/shared/creatorGovernanceRegistry';
import { validateMediaUpload } from './mediaUploadValidationService';
import { applyTransition, LIFECYCLE_STATES, CreatorLifecycleTransitionError } from '../../lib/shared/creatorLifecycleStateMachine';
import { ownedDbTable as ownedDbTableShared } from '../db/writeOwner';
import { emitCreatorEvent, CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { recordAuditEntry } from './creatorAuditTrailService';
import { recordPublishFailure } from './creatorQueueReliabilityService';
import { validateCreatorPublishSemanticsLive } from './creatorPublishValidation';
import { publishThread } from './threadRuntime/threadPublishOrchestrator';

/**
 * Publish-time re-validation for attachment-required posts. The
 * `uploaded_media_url` on the row could be hours/days old by the time
 * the publish job fires — signed URLs may have expired, CDN entries
 * removed, etc. We re-hit the URL right before the platform adapter so
 * a dead asset surfaces as a structured workspace error rather than a
 * platform-level publish failure.
 *
 * Only runs for attachment-required content types. Autonomous rows
 * (image / banner / infographic / carousel / pdf / slider) skip this
 * check — their media was just rendered by Omnivyra and is trusted.
 */
async function revalidateAttachmentMediaBeforePublish(input: {
  scheduledPostId: string;
  contentType: string;
  mediaUrls: string[] | null | undefined;
}): Promise<{ ok: true } | { ok: false; reason: string; errors: string[] }> {
  const normalized = normalizeCreatorFormat(input.contentType);
  if (!isAttachmentRequiredFormat(normalized)) return { ok: true };
  const firstUrl = Array.isArray(input.mediaUrls) && input.mediaUrls.length > 0 ? String(input.mediaUrls[0] || '').trim() : '';
  if (!firstUrl) {
    return { ok: false, reason: 'No uploaded media URL recorded on the scheduled post.', errors: ['missing_media_url'] };
  }
  const validation = await validateMediaUpload({
    mediaUrl: firstUrl,
    contentType: normalized,
    skipLiveness: false,
  });
  if (validation.valid === true) return { ok: true };
  const failureErrors: string[] = Array.isArray((validation as { errors?: unknown }).errors)
    ? ((validation as { errors: string[] }).errors)
    : [];
  return {
    ok: false,
    reason: failureErrors.join(' | ') || 'Media validation failed at publish time.',
    errors: failureErrors,
  };
}

/**
 * Roll back the daily_content_plans row to `upload_failed` when
 * publish-time re-validation rejects the media. The row's
 * `scheduled_post_id` linkage is preserved on the lifecycle history so
 * the audit trail remains continuous. Best-effort — failure to write
 * doesn't block the platform error response below.
 */
async function markAttachmentRowPublishFailed(input: {
  scheduledPostId: string;
  reason: string;
  validationErrors: string[];
}): Promise<void> {
  try {
    // ── Preferred: direct FK lookup via daily_content_plans.scheduled_post_id ──
    // The migration at supabase/migrations/20260656_creator_attachment_scheduled_post_fk.sql
    // adds this column + backfill + index. Use it when available; fall
    // back to the legacy heuristic scan if the column doesn't exist (so
    // pre-migration environments still get rollback coverage).
    let target: any = null;
    try {
      const { data: fkRow } = await supabase
        .from('daily_content_plans')
        .select('id, content')
        .eq('scheduled_post_id', input.scheduledPostId)
        .maybeSingle();
      if (fkRow) target = fkRow;
    } catch {
      /* fall through to heuristic */
    }

    if (!target) {
      const { data: rows } = await supabase
        .from('daily_content_plans')
        .select('id, content')
        .eq('content_status', 'scheduled')
        .limit(50);
      const rowsArr = Array.isArray(rows) ? rows : [];
      target = rowsArr.find((r: any) => {
        const c = typeof r.content === 'string'
          ? (() => { try { return JSON.parse(r.content); } catch { return {}; } })()
          : (r.content && typeof r.content === 'object' ? r.content : {});
        return c?.scheduled_post_id === input.scheduledPostId;
      });
    }

    if (!target) return;
    const parsed = (() => {
      const c = (target as any).content;
      if (typeof c === 'string') {
        try { return JSON.parse(c); } catch { return {}; }
      }
      return c && typeof c === 'object' ? c : {};
    })() as Record<string, unknown>;
    const transition = applyTransition(parsed, LIFECYCLE_STATES.UPLOAD_FAILED, {
      contentPatch: {
        publish_validation_error: input.reason,
        publish_validation_errors: input.validationErrors,
        publish_validation_failed_at: new Date().toISOString(),
      },
      reason: 'publish_validation_failed',
    });
    await ownedDbTableShared('daily_content_plans')
      .update({
        content: JSON.stringify(transition.content),
        content_status: transition.contentStatus,
        failure_reason: input.reason,
        failure_type: 'transient',
        updated_at: new Date().toISOString(),
      })
      .eq('id', (target as any).id);
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      console.warn('[publishNow] publish-revalidation rollback skipped (invalid transition)', {
        scheduled_post_id: input.scheduledPostId,
        message: error.message,
      });
      return;
    }
    console.warn('[publishNow] publish-revalidation rollback failed', {
      scheduled_post_id: input.scheduledPostId,
      message: (error as Error)?.message,
    });
  }
}

export type PublishNowInput = {
  scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
  /** Identifies which surface invoked publishNow (api, queue, scheduler,
   *  super-admin). Emitted in observability logs; never reaches the platform. */
  publish_source?: string;
};

export type PublishNowResult = {
  status: 'PUBLISHED' | 'FAILED';
  external_post_id?: string;
  post_url?: string;
  published_at?: string;
  message?: string;
  timestamp: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST-LEVEL PUBLISH CLAIM — the durable idempotency boundary
// ─────────────────────────────────────────────────────────────────────────────
//
// SHARED, NOT DUPLICATED. Both publish surfaces call the SAME two helpers:
//   • the queue worker  — backend/queue/jobProcessors/publishProcessor.ts
//   • the direct path   — `publishNow` below, which serves BOTH the cron
//     safety net (pages/api/cron/process-scheduled-posts.ts, which writes NO
//     queue_jobs row at all) and the manual publish route
//     (pages/api/social/publish.ts).
// They live here, in the service layer, because publishProcessor already
// imports from this module (`refreshScheduledPostMediaFromRefs`); putting them
// the other way round would close an import cycle.
//
// IDENTITY: `scheduled_posts.id`. Not a new identifier — the scheduled post row
// IS the thing that must be published at most once. It is a UUID primary key,
// so it can never collide across companies (property: no cross-tenant
// collision), and it is the identity every publish surface already agrees on.
//
// Why not the BullMQ job id: it identifies a DELIVERY, not the work. Two jobs
// for one post carry two ids and therefore never collide. And the cron path
// has no job id at all.
//
// Why not `scheduled_posts.idempotency_key`: that column is already owned by
// the SCHEDULER (backend/services/boltScheduleBlockProcessor writes the
// deterministic (campaign, week, day, platform, content_type, sequence) hash
// from makeScheduledPostIdempotencyKey, guarded by
// `scheduled_posts_idempotency_key_unique`). It is a row-CREATION key, not an
// execution key; overloading it would collide with the scheduler's use.
//
// WHERE THE BOUNDARY LIVES: Postgres. The claim is a conditional UPDATE whose
// WHERE clause names the column it is about to change:
//
//     UPDATE scheduled_posts SET status='publishing'
//      WHERE id = $1 AND status = $observed
//
// Under READ COMMITTED, two concurrent executions serialise on the row; the
// loser re-evaluates its predicate against the winner's committed version,
// sees status='publishing', and matches zero rows. The DATABASE picks the
// winner — no advisory lock (`try_scheduled_post_lock` is a SESSION-scoped
// `pg_try_advisory_lock` bound to a pooled PostgREST connection, so it is not
// a durable boundary), and no process-local map (these paths run in more than
// one runtime: Railway worker, Vercel cron, Vercel API).
//
// This reuses the mechanism the thread runtime already proved: see
// `transitionRowStatus` in backend/services/threadRuntime/threadPublishOrchestrator.ts
// and the 'publishing' state contract in lib/thread/threadPublishStates.ts —
// "Set BEFORE calling the platform adapter. Cron's status='scheduled' filter
// ignores it (no double-execution)." Claiming therefore ALSO removes the row
// from the cron safety net's `.eq('status','scheduled')` scan while a publish
// is in flight, which is what closes the cron-vs-cron overlap on a publish
// that outlives one cron tick.
//
// NO MIGRATION IS REQUIRED: `scheduled_posts.status` already accepts
// 'publishing' (chk_status, supabase/migrations/20260808_thread_publish_states.sql)
// and is already written with that value in production by the thread
// orchestrator.

/**
 * How long a 'publishing' row is presumed to belong to a live execution.
 * Deliberately the same 5 minutes as publishProcessor's queue_jobs
 * replay-suppression window, and for the same reason: longer than any healthy
 * publish, short enough that a hard-killed worker cannot strand a post forever.
 */
export const PUBLISH_CLAIM_STALE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Statuses a fresh publish attempt may claim FROM.
 *
 *  scheduled — the normal path (the release seam sets this).
 *  failed    — a previous attempt failed. This MUST stay claimable or the
 *              claim would convert every retryable failure into a permanent
 *              block. It mirrors RELEASABLE_POST_STATUSES in
 *              lib/campaign/publishAuthorization, which documents the same
 *              requirement for the authorization gate.
 *
 * 'draft' is deliberately ABSENT, and that does not regress the manual
 * "publish now" button: pages/api/social/publish.ts already applies the shared
 * publish-authorization predicate from lib/campaign/publishAuthorization,
 * whose RELEASABLE_POST_STATUSES is {scheduled, publishing, failed} — a draft
 * is rejected 409 there, before publishNow is ever called. The claim's
 * claimable set is a SUBSET of that gate's (it drops only 'publishing', which
 * is precisely the contended state this boundary exists to refuse), so the
 * claim can never reject a manual publish that the authorization gate would
 * otherwise have let through uncontended.
 *
 * NOTE: this module deliberately does NOT import or evaluate that predicate —
 * authorization stays at the route/worker layer (see the source gate in
 * backend/tests/integration/social_publish_authorization.test.ts). The claim is
 * a concurrency boundary, not an authorization decision.
 */
const CLAIMABLE_FROM_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'failed']);

export type PublishClaimRefusalReason = 'held_by_another_execution' | 'already_published';

/**
 * Deliberately ONE shape rather than a discriminated union: this repo compiles
 * with `"strict": false`, under which a `claimed: true | false` literal
 * discriminant does not narrow, so a union here fails typecheck at every
 * consumer.
 *
 * `fromStatus` is set iff `claimed`; `reason` is set iff `!claimed`.
 */
export interface PublishClaimResult {
  claimed: boolean;
  /** The status this execution claimed FROM. Null when the claim was refused. */
  fromStatus: string | null;
  /** Why the claim was refused. Null when it was granted. */
  reason: PublishClaimRefusalReason | null;
}

const claimGranted = (fromStatus: string): PublishClaimResult =>
  ({ claimed: true, fromStatus, reason: null });

const claimRefused = (reason: PublishClaimRefusalReason): PublishClaimResult =>
  ({ claimed: false, fromStatus: null, reason });

/**
 * Take the post-level publish claim. Returns `claimed:false` when another
 * execution holds it — the caller must then NOT call the platform.
 *
 * `snapshotStatus` / `snapshotUpdatedAt` come from the row the caller already
 * read; they only select WHICH conditional update to issue. They never decide
 * the outcome — the affected-row count does.
 */
export async function claimScheduledPostForPublish(input: {
  scheduledPostId: string;
  snapshotStatus: string | null | undefined;
  snapshotUpdatedAt: string | null | undefined;
}): Promise<PublishClaimResult> {
  const { scheduledPostId } = input;
  const status = String(input.snapshotStatus ?? '').trim().toLowerCase();
  const staleBefore = Date.now() - PUBLISH_CLAIM_STALE_WINDOW_MS;

  let query = ownedDbTable('scheduled_posts')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', scheduledPostId);

  if (CLAIMABLE_FROM_STATUSES.has(status)) {
    query = query.eq('status', status);
  } else if (status === 'publishing') {
    // Another execution already claimed. Refuse while the claim looks live.
    const heldSince = input.snapshotUpdatedAt ? new Date(input.snapshotUpdatedAt).getTime() : NaN;
    if (!Number.isFinite(heldSince) || heldSince > staleBefore) {
      return claimRefused('held_by_another_execution');
    }
    // Stale claim (worker hard-killed mid-publish). Reclaim — but still let
    // the database pick the winner: `updated_at` is part of the predicate AND
    // part of the SET, so a racing reclaimer re-reads a fresh updated_at and
    // matches zero rows.
    query = query
      .eq('status', 'publishing')
      .lt('updated_at', new Date(staleBefore).toISOString());
  } else {
    // Not a claimable state (published / cancelled / draft / blocked /
    // unknown). The authorization gate on each surface should already have
    // rejected these.
    return claimRefused('held_by_another_execution');
  }

  const { data, error } = await query.select('id');
  if (error) {
    throw new Error(`Failed to claim scheduled post ${scheduledPostId} for publish: ${error.message}`);
  }
  if (Array.isArray(data) && data.length > 0) {
    return claimGranted(status);
  }

  // Lost the race. Re-read to report the reason accurately: a post that landed
  // on the platform in the meantime is 'already published', not 'contended'.
  try {
    const current = await getScheduledPost(scheduledPostId);
    if (current?.platform_post_id) return claimRefused('already_published');
  } catch {
    /* fall through — the claim was still refused either way */
  }
  return claimRefused('held_by_another_execution');
}

/**
 * Give the claim back, restoring the status this execution claimed FROM.
 *
 * Used only on the unexpected-throw path. Restoring (rather than forcing
 * 'failed') means an unhandled error leaves the row exactly as it was before
 * the claim, so the claim can never remove a post from a retry surface it was
 * already on — the requirement that a retryable failure stays retryable.
 *
 * Compare-and-set on 'publishing' makes it a no-op whenever a terminal write
 * already happened: the success path wrote 'published', the handled-failure
 * path wrote 'failed', or another execution reclaimed a stale hold.
 */
export async function releaseScheduledPostPublishClaim(
  scheduledPostId: string,
  restoreStatus: string,
): Promise<'released' | 'not_held'> {
  const { data, error } = await ownedDbTable('scheduled_posts')
    .update({ status: restoreStatus, updated_at: new Date().toISOString() })
    .eq('id', scheduledPostId)
    .eq('status', 'publishing')
    .select('id');
  if (error) {
    console.warn('[publishClaim] release failed (non-fatal):', error.message);
    return 'not_held';
  }
  return Array.isArray(data) && data.length > 0 ? 'released' : 'not_held';
}

/**
 * Publish a scheduled post immediately using the canonical path (platformAdapter).
 * Behaves like a queue job executed synchronously: idempotency, same success/failure updates.
 */
/**
 * Re-resolve a scheduled post's creator asset refs through the canonical publishing
 * resolution path (`resolvePublishMedia`) and, on genuine success, REFRESH the row's
 * `media_urls` snapshot so the adapter (which reads the row) and any retry use the
 * CURRENT rendering payload rather than the schedule-time snapshot. This is the single
 * async-worker resolution entry; both `publishNow` (cron + publish-now) and the BullMQ
 * `processPublishJob` call it. No-op / fallback when refs are unavailable or unresolved
 * (no behaviour regression). Fail-open — never blocks publish on a refresh error. The
 * shared path owns telemetry (`creator_publish_ref_resolution`); none is emitted here.
 */
export async function refreshScheduledPostMediaFromRefs(input: {
  scheduledPostId: string;
  userId: string;
  post?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const post = (input.post ?? (await getScheduledPost(input.scheduledPostId))) as Record<string, unknown> | null;
    if (!post) return;
    // Canonical organization identity — never userId-as-companyId. Resolved from the
    // connected account / campaign so the server asset resolver receives the real org.
    const organizationId = await resolvePublishingOrganization({
      socialAccountId: (post.social_account_id as string | null) ?? null,
      campaignId: (post.campaign_id as string | null) ?? null,
      scheduledPostId: input.scheduledPostId,
    });
    const { mediaUrls, resolvedCount } = await resolvePublishMedia({
      companyId: organizationId ?? '',
      userId: input.userId,
      platform: String(post.platform ?? ''),
      creatorAttachments: post.creator_attachment_metadata,
      legacyMediaUrls: post.media_urls,
    });
    if (resolvedCount > 0 && mediaUrls.length) {
      const current = Array.isArray(post.media_urls) ? (post.media_urls as unknown[]).map(String) : [];
      const changed = current.length !== mediaUrls.length || mediaUrls.some((u, i) => u !== current[i]);
      if (changed) {
        await ownedDbTable('scheduled_posts').update({ media_urls: mediaUrls }).eq('id', input.scheduledPostId);
      }
      post.media_urls = mediaUrls; // keep the in-memory row consistent for the caller
    }
  } catch {
    /* fail-open — snapshot refresh must never block a publish */
  }
}

export async function publishNow(input: PublishNowInput): Promise<PublishNowResult> {
  const { scheduled_post_id, social_account_id, user_id } = input;
  const timestamp = new Date().toISOString();

  const scheduledPost = await getScheduledPost(scheduled_post_id);
  if (!scheduledPost) {
    return {
      status: 'FAILED',
      message: `Scheduled post ${scheduled_post_id} not found`,
      timestamp,
    };
  }

  // Phase 1B.2.2 — thread orchestrator delegation.
  // If this row is the root of a multi-row thread (is_thread_start=TRUE),
  // hand off to the thread publish orchestrator instead of running the
  // single-row pipeline below. The orchestrator walks parent → children in
  // thread_position order, publishes each, manages per-node state
  // transitions, and handles native reply-chain (Twitter) or sequential
  // standalone (LinkedIn/IG/FB/other). For single-row posts (the vast
  // majority), this branch is skipped and the existing single-row path runs.
  //
  // G12 — IMPORTANT: this check runs BEFORE the platform_post_id short-circuit
  // below. For threads, the root having a platform_post_id only means the
  // ROOT was published — there may still be unpublished children. The
  // orchestrator's per-node idempotency safely skips already-published nodes
  // and continues with unpublished ones (the resume-from-failed path).
  if (scheduledPost.is_thread_start === true) {
    const threadResult = await publishThread({
      root_scheduled_post_id: scheduled_post_id,
      social_account_id,
      user_id,
    });
    return {
      status: threadResult.status,
      external_post_id: undefined,
      post_url: undefined,
      published_at: threadResult.status === 'PUBLISHED' ? threadResult.timestamp : undefined,
      message: threadResult.message,
      timestamp: threadResult.timestamp,
    };
  }

  // Single-row idempotency: if the row has already been published once and
  // is not a thread root, the platform_post_id alone tells us we're done.
  if (scheduledPost.platform_post_id) {
    return {
      status: 'PUBLISHED',
      external_post_id: scheduledPost.platform_post_id,
      post_url: scheduledPost.post_url,
      published_at: scheduledPost.published_at,
      timestamp,
    };
  }

  // ── POST-LEVEL PUBLISH CLAIM ───────────────────────────────────────────
  //
  // The short-circuit above is a READ-then-ACT on `platform_post_id`: two
  // executions that both observe it null both fall through and both publish.
  // Nothing above this line is a mutual-exclusion boundary, and this path has
  // NO queue_jobs row to lean on — the cron safety net
  // (pages/api/cron/process-scheduled-posts.ts) calls publishNow directly, so
  // publishProcessor's job-level checks never see it.
  //
  // TWO real races this closes:
  //   1. cron × queue — the scheduler enqueues a publish job AND the cron
  //      safety net picks the same due row up; two runtimes, one post.
  //   2. cron × cron — cron's runJob idempotencyKey is minute-bucketed
  //      (`cron:process-scheduled-posts:<post>:<minuteBucket>`), so a publish
  //      that outlives one tick is re-selected next minute (the row is still
  //      `status='scheduled'`, `platform_post_id` still null) under a BRAND
  //      NEW key that collapses nothing. Taking the claim moves the row to
  //      'publishing', which the cron SELECT's `.eq('status','scheduled')`
  //      filter excludes — so tick N+1 no longer sees it at all.
  //
  // Thread roots never reach here: the delegation block above returns first,
  // and the orchestrator runs its own per-node claim (`transitionRowStatus`).
  // Pre-claiming a root would make its `assertCanTransition('publishing',
  // 'publishing')` throw.
  const claim = await claimScheduledPostForPublish({
    scheduledPostId:   scheduled_post_id,
    snapshotStatus:    (scheduledPost as { status?: string | null }).status ?? null,
    snapshotUpdatedAt: (scheduledPost as { updated_at?: string | null }).updated_at ?? null,
  });

  if (!claim.claimed) {
    if (claim.reason === 'already_published') {
      // Another execution completed while we were reading. Report the SAME
      // idempotent success the platform_post_id short-circuit above would
      // have reported, re-read so the id we hand back is the real one.
      const settled = await getScheduledPost(scheduled_post_id);
      return {
        status: 'PUBLISHED',
        external_post_id: settled?.platform_post_id ?? undefined,
        post_url: settled?.post_url ?? undefined,
        published_at: settled?.published_at ?? undefined,
        message: 'Already published (post-level claim: another execution completed it)',
        timestamp,
      };
    }
    // Contended. Do NOT call the platform — that is exactly the duplicate
    // publish this boundary exists to prevent. FAILED (not PUBLISHED) because
    // reporting a publish that did not happen here would let a caller stamp
    // `published`/`published_at` onto a row with no platform_post_id and hide
    // a genuine failure if the holder later fails. The holder owns the
    // outcome and writes the terminal status.
    const message = 'Duplicate publish suppressed (post-level claim held by another execution)';
    logger.warn('publishNow.duplicate_suppressed', {
      surface: 'publishNow',
      publishSource: input.publish_source ?? 'unknown',
      scheduledPostId: scheduled_post_id,
      reason: claim.reason,
    });
    return { status: 'FAILED', message, timestamp };
  }

  try {
    return await runSingleRowPublish(input, scheduledPost, timestamp);
  } catch (error) {
    // Unexpected throw. CAS-restore the exact status claimed from, so the row
    // is left exactly as retryable as it was before the claim — never more
    // blocked. A no-op when a terminal status was already written.
    try {
      await releaseScheduledPostPublishClaim(scheduled_post_id, claim.fromStatus);
    } catch (releaseError) {
      console.warn(
        '[publishNow] publish-claim release threw (non-fatal):',
        releaseError instanceof Error ? releaseError.message : String(releaseError),
      );
    }
    throw error;
  }
}

/**
 * The single-row publish pipeline. Extracted verbatim from `publishNow` so the
 * post-level claim can wrap the WHOLE of it (validation, media refresh, the
 * platform call and the terminal write) in one try/catch without re-indenting
 * the pipeline. Runs ONLY while this execution holds the claim; every exit
 * from here either writes a terminal status ('published' / 'failed') — which
 * releases the claim by definition — or throws, which the caller CAS-restores.
 */
async function runSingleRowPublish(
  input: PublishNowInput,
  scheduledPost: Awaited<ReturnType<typeof getScheduledPost>>,
  timestamp: string,
): Promise<PublishNowResult> {
  const { scheduled_post_id, social_account_id, user_id } = input;

  // Re-resolve creator asset refs and refresh the media snapshot BEFORE any media
  // is consumed (validation + adapter), so late/cron publishes upload the current
  // rendering payload — not the schedule-time snapshot. No-op/fallback when refs
  // are unavailable. Mutates scheduledPost.media_urls in place.
  await refreshScheduledPostMediaFromRefs({ scheduledPostId: scheduled_post_id, userId: user_id, post: scheduledPost as unknown as Record<string, unknown> });

  // Authoritative capability validation. Runs BEFORE adapter selection, account
  // resolution, or any media upload — so queue workers, scheduled jobs, and
  // super-admin/API callers all reject incompatible publishes at the same
  // chokepoint. The API layer also validates; this is the lower-shared layer
  // that guarantees coverage regardless of entry point.
  const compatibility = validatePlatformContentCompatibility({
    platform: scheduledPost.platform,
    contentSignals: { contentType: scheduledPost.content_type },
    payload: {
      hasText: !!(scheduledPost.content && scheduledPost.content.trim().length > 0),
      mediaUrls: scheduledPost.media_urls ?? [],
    },
  });
  if (compatibility.ok === false) {
    const failure = compatibility;
    const eventName = failure.code === 'CAPABILITY_UNRESOLVED'
      ? CAPABILITY_LOG_EVENTS.UNRESOLVED
      : CAPABILITY_LOG_EVENTS.REJECTED;
    const payload: CapabilityLogPayload = {
      surface: 'publishNow',
      publishSource: input.publish_source ?? 'unknown',
      platform: failure.platform ?? scheduledPost.platform,
      resolvedCapability: failure.capability,
      contentType: scheduledPost.content_type,
      code: failure.code,
      scheduledPostId: scheduled_post_id,
    };
    logger.warn(eventName, payload);
    const message = failure.message;
    await updateScheduledPostOnFailure(scheduled_post_id, message);
    await ownedDbTable('scheduled_posts')
      .update({
        error_code: failure.code,
        error_message: message,
      })
      .eq('id', scheduled_post_id);
    return {
      status: 'FAILED',
      message,
      timestamp,
    };
  }

  // ── Publish-time re-validation for attachment-required posts ──────────
  // For video / reel / short / podcast scheduled posts, re-validate the
  // `media_urls[0]` URL right before the platform adapter so an expired
  // signed URL or removed CDN object surfaces as a structured workspace
  // error rather than a platform publish failure. Autonomous rows are
  // exempt (their media is just-rendered).
  const creatorPublishValidation = await validateCreatorPublishSemanticsLive({
    platform: scheduledPost.platform,
    contentType: scheduledPost.content_type,
    text: scheduledPost.content,
    mediaUrls: scheduledPost.media_urls ?? [],
    creatorAttachmentMetadata: scheduledPost.creator_attachment_metadata,
    scheduledPostId: scheduled_post_id,
  });
  if (creatorPublishValidation.ok === false) {
    const message = `Creator attachment publish validation failed: ${creatorPublishValidation.errors.join(', ')}`;
    emitCreatorEvent({
      event: CREATOR_EVENTS.PUBLISH_VALIDATION_FAILED,
      severity: 'critical',
      scheduledPostId: scheduled_post_id,
      campaignId: scheduledPost.campaign_id,
      creatorFormat: String(scheduledPost.content_type ?? ''),
      metadata: {
        errors: creatorPublishValidation.errors,
        warnings: creatorPublishValidation.warnings,
        source: input.publish_source ?? 'unknown',
      },
    });
    await updateScheduledPostOnFailure(scheduled_post_id, message);
    await ownedDbTable('scheduled_posts')
      .update({
        error_code: 'CREATOR_ATTACHMENT_PUBLISH_VALIDATION_FAILED',
        error_message: message,
      })
      .eq('id', scheduled_post_id);
    return {
      status: 'FAILED',
      message,
      timestamp,
    };
  }

  const reval = await revalidateAttachmentMediaBeforePublish({
    scheduledPostId: scheduled_post_id,
    contentType: String(scheduledPost.content_type || ''),
    mediaUrls: scheduledPost.media_urls ?? [],
  });
  if (!reval.ok) {
    const failure = reval as { ok: false; reason: string; errors: string[] };
    emitCreatorEvent({
      event: CREATOR_EVENTS.PUBLISH_VALIDATION_FAILED,
      severity: 'critical',
      scheduledPostId: scheduled_post_id,
      campaignId: scheduledPost.campaign_id,
      creatorFormat: String(scheduledPost.content_type ?? ''),
      metadata: { reason: failure.reason, errors: failure.errors, source: input.publish_source ?? 'unknown' },
    });
    void recordPublishFailure({
      scheduledPostId: scheduled_post_id,
      errorCode: 'PUBLISH_MEDIA_REVALIDATION_FAILED',
      errorMessage: failure.reason,
      attemptCount: 1,
    });
    logger.warn('publishNow.attachment_revalidation_failed', {
      surface: 'publishNow',
      publishSource: input.publish_source ?? 'unknown',
      scheduledPostId: scheduled_post_id,
      reason: failure.reason,
      errors: failure.errors,
    });
    await updateScheduledPostOnFailure(scheduled_post_id, failure.reason);
    await ownedDbTable('scheduled_posts')
      .update({
        error_code: 'PUBLISH_MEDIA_REVALIDATION_FAILED',
        error_message: failure.reason,
      })
      .eq('id', scheduled_post_id);
    await markAttachmentRowPublishFailed({
      scheduledPostId: scheduled_post_id,
      reason: failure.reason,
      validationErrors: failure.errors,
    });
    return {
      status: 'FAILED',
      message: failure.reason,
      timestamp,
    };
  }

  // Centralized publish-readiness gate (Round-4 item 1) — IDENTICAL
  // validator to the manual /api/social/publish path (reuse, not
  // duplicate logic). Mode-gated via PUBLISH_GUARD_MODE. Runs after the
  // attachment-media revalidation, before the adapter. Idempotency
  // unaffected (publishNow's platform_post_id short-circuit already ran).
  const schedReadiness = validatePublishReadiness({
    platform: String(scheduledPost.platform || ''),
    contentSignals: { contentType: String(scheduledPost.content_type || '') },
    hasText: !!(scheduledPost.content && String(scheduledPost.content).trim().length > 0),
    mediaUrls: scheduledPost.media_urls ?? [],
    content: typeof scheduledPost.content === 'string' ? scheduledPost.content : '',
    skipSchedulingReadiness: true,
  });
  if (schedReadiness.ok === false) {
    logPipelineEvent('publish.scheduled_validation', 'warn', {
      scheduled_post_id, platform: scheduledPost.platform,
      code: schedReadiness.code, surface: input.publish_source ?? 'scheduled',
    }, { dedupeKey: `${scheduledPost.platform}|${schedReadiness.code}` });
    void recordPublishFailure({
      scheduledPostId: scheduled_post_id,
      errorCode: schedReadiness.code,
      errorMessage: schedReadiness.message,
      attemptCount: 1,
    });
    await updateScheduledPostOnFailure(scheduled_post_id, schedReadiness.message);
    await ownedDbTable('scheduled_posts')
      .update({ error_code: schedReadiness.code, error_message: schedReadiness.message })
      .eq('id', scheduled_post_id);
    return { status: 'FAILED', message: schedReadiness.message, timestamp };
  }
  if (schedReadiness.warnings.length > 0) {
    logPipelineEvent('publish.scheduled_validation', 'info', {
      scheduled_post_id, platform: scheduledPost.platform,
      warnings: schedReadiness.warnings.map((w) => w.code),
    }, { dedupeKey: `${scheduledPost.platform}|warn` });
  }

  emitCreatorEvent({
    event: CREATOR_EVENTS.PUBLISH_VALIDATION_PASSED,
    scheduledPostId: scheduled_post_id,
    campaignId: scheduledPost.campaign_id,
    creatorFormat: String(scheduledPost.content_type ?? ''),
    metadata: { source: input.publish_source ?? 'unknown' },
  });

  // Durable media refresh (Round-5 item 3). No-op unless DURABLE_MEDIA_REFS
  // is on AND the row has media_storage_refs; fail-open (never regresses
  // legacy media_urls). Mints fresh signed URLs in place so the adapter
  // publishes non-expired media without any adapter change.
  await refreshDurableMediaBeforePublish(scheduled_post_id);

  const result = await publishToPlatform(scheduled_post_id, social_account_id);

  if (result.success && result.platform_post_id) {
    await updateScheduledPostOnPublish(
      scheduled_post_id,
      result.platform_post_id,
      result.post_url || '',
      result.published_at
    );
    // P3-1 — advance the variant experiment tracker for any variant
    // that ships with this scheduled_post. Best-effort; failures
    // never block publish.
    try {
      const { resolveStrategyAttributionForScheduledPost } = await import('./creator/strategyAttributionResolver');
      const { notifyExperimentAssetPublished } = await import('./creator/variantExperimentLifecycle');
      const attribution = await resolveStrategyAttributionForScheduledPost(scheduled_post_id);
      if (attribution?.variantId && attribution.companyId) {
        notifyExperimentAssetPublished({
          companyId: attribution.companyId,
          variantId: attribution.variantId,
          scheduledPostId: scheduled_post_id,
        });
      }
    } catch (err) {
      console.warn('[publishNowService] experiment publish-notify failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
    emitCreatorEvent({
      event: CREATOR_EVENTS.ATTACHMENT_PUBLISH_SUCCESS,
      scheduledPostId: scheduled_post_id,
      campaignId: scheduledPost.campaign_id,
      creatorFormat: String(scheduledPost.content_type ?? ''),
      metadata: { platform_post_id: result.platform_post_id, platform: scheduledPost.platform },
    });
    recordAuditEntry({
      action: 'publish_succeeded',
      actorUserId: user_id,
      actorKind: 'worker',
      source: 'worker',
      scheduledPostId: scheduled_post_id,
      campaignId: scheduledPost.campaign_id,
      newState: { platform_post_id: result.platform_post_id, post_url: result.post_url ?? null },
    });

    try {
      await recordPostAnalytics(
        scheduled_post_id,
        user_id,
        scheduledPost.platform,
        { views: 0, likes: 0, shares: 0, comments: 0 },
        {}
      );
    } catch (e: any) {
      console.warn('publishNow: recordPostAnalytics failed', e?.message);
    }

    try {
      await logActivity(user_id, 'post_published', 'post', scheduled_post_id, {
        campaign_id: scheduledPost.campaign_id,
        platform: scheduledPost.platform,
        platform_post_id: result.platform_post_id,
      });
    } catch (e: any) {
      console.warn('publishNow: logActivity failed', e?.message);
    }

    if (scheduledPost.campaign_id) {
      void checkAndCompleteCampaignIfEligible(scheduledPost.campaign_id).catch(() => {});
    }

    return {
      status: 'PUBLISHED',
      external_post_id: result.platform_post_id,
      post_url: result.post_url,
      published_at: result.published_at?.toISOString(),
      timestamp,
    };
  }

  const platformError = categorizeError(
    scheduledPost.platform,
    result.error || { message: 'Unknown error' }
  );
  // Use the raw message (actual error) so callers can surface it; fall back to user_message
  const errorDetail = platformError.message && platformError.message !== 'Unknown error'
    ? platformError.message
    : platformError.user_message;

  await updateScheduledPostOnFailure(scheduled_post_id, errorDetail);
  await ownedDbTable('scheduled_posts')
    .update({
      error_code: platformError.code,
      error_message: errorDetail,
    })
    .eq('id', scheduled_post_id);

  emitCreatorEvent({
    event: CREATOR_EVENTS.ATTACHMENT_PUBLISH_FAILURE,
    severity: 'critical',
    scheduledPostId: scheduled_post_id,
    campaignId: scheduledPost.campaign_id,
    creatorFormat: String(scheduledPost.content_type ?? ''),
    metadata: { error_code: platformError.code, error_message: errorDetail, platform: scheduledPost.platform },
  });
  void recordPublishFailure({
    scheduledPostId: scheduled_post_id,
    errorCode: platformError.code,
    errorMessage: errorDetail,
    attemptCount: 1,
  });
  recordAuditEntry({
    action: 'publish_failed',
    actorUserId: user_id,
    actorKind: 'worker',
    source: 'worker',
    scheduledPostId: scheduled_post_id,
    campaignId: scheduledPost.campaign_id,
    metadata: { error_code: platformError.code, error_message: errorDetail },
  });

  return {
    status: 'FAILED',
    message: errorDetail,
    timestamp,
  };
}
