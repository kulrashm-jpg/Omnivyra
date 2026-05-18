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

/**
 * Publish a scheduled post immediately using the canonical path (platformAdapter).
 * Behaves like a queue job executed synchronously: idempotency, same success/failure updates.
 */
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

  if (scheduledPost.platform_post_id) {
    return {
      status: 'PUBLISHED',
      external_post_id: scheduledPost.platform_post_id,
      post_url: scheduledPost.post_url,
      published_at: scheduledPost.published_at,
      timestamp,
    };
  }

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
