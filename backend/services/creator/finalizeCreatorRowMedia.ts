/**
 * finalizeCreatorRowMediaLifecycle — shared orchestration for driving an
 * attachment-required creator row from a resolved media URL through to a
 * scheduled post.
 *
 * It performs the SAME sequence the upload endpoint performs, by reusing the
 * EXISTING primitives (no parallel validator / FSM / scheduler):
 *
 *   validateMediaUpload                  (mediaUploadValidationService)
 *     → applyTransition MEDIA_UPLOADED   (creatorLifecycleStateMachine)
 *     → applyTransition READY_FOR_SCHEDULE
 *     → autoScheduleReadyCreatorRowById  (creatorRowScheduler)
 *
 * Used by the external-video URL path (shared-media.ts `finalize-video-publishing`)
 * so URL-attached videos become functionally equivalent to uploaded videos.
 *
 * NOTE: pages/api/.../upload-media.ts keeps its own inline equivalent; it is
 * intentionally NOT modified in this phase (the upload workflow must stay
 * byte-identical). Converging the two onto this helper is a future cleanup.
 *
 * Batch-friendly: never throws on an FSM transition that isn't legal for the
 * row's current state (e.g. a row already scheduled) — it returns a reason so
 * a caller iterating sibling rows can continue.
 */

import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  normalizeCreatorFormat,
  isAttachmentRequiredFormat,
  CREATOR_LIFECYCLE_STATES,
} from '@/lib/shared/creatorGovernanceRegistry';
import {
  applyTransition,
  readLifecycleState,
  CreatorLifecycleTransitionError,
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import { validateMediaUpload } from '@/backend/services/mediaUploadValidationService';
import { autoScheduleReadyCreatorRowById } from '@/backend/services/creator/creatorRowScheduler';

export interface FinalizeRowMediaInput {
  rowId: string;
  /** The row's content JSON (already merged with the resolved uploaded_media_url is fine). */
  content: Record<string, unknown>;
  contentType: string;
  mediaUrl: string;
  source?: 'external_link' | 'user_upload';
  mimeType?: string;
}

export interface FinalizeRowMediaResult {
  rowId: string;
  ok: boolean;
  from?: string | null;
  to?: string;
  scheduled: boolean;
  scheduledPostId?: string | null;
  scheduleStatus?: string;
  validationValid?: boolean;
  reason?: string;
}

export async function finalizeCreatorRowMediaLifecycle(
  input: FinalizeRowMediaInput,
): Promise<FinalizeRowMediaResult> {
  const rowId = input.rowId;
  const contentType = normalizeCreatorFormat(input.contentType || '');
  const mediaUrl = (input.mediaUrl || '').trim();
  const source = input.source ?? 'external_link';

  if (!isAttachmentRequiredFormat(contentType)) {
    return { rowId, ok: false, scheduled: false, reason: 'not_attachment_required' };
  }
  if (!mediaUrl) {
    return { rowId, ok: false, scheduled: false, reason: 'missing_media_url' };
  }

  const currentContent = input.content && typeof input.content === 'object' ? input.content : {};
  const currentState = readLifecycleState(currentContent);

  // ── Reuse the existing validation model ────────────────────────────────
  const validation = await validateMediaUpload({ mediaUrl, contentType, mimeType: input.mimeType });

  if (validation.valid === false) {
    const validationErrors: string[] = Array.isArray((validation as { errors?: unknown }).errors)
      ? ((validation as { errors: string[] }).errors)
      : [];
    const failurePatch: Record<string, unknown> = {
      uploaded_media_url: mediaUrl,
      upload_source: source,
      uploaded_mime_type: input.mimeType ?? null,
      upload_validated_at: validation.validated_at,
      upload_validation: validation,
      upload_error: validationErrors.join(' | '),
    };
    try {
      const failed = applyTransition(currentContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
        contentPatch: failurePatch,
        reason: 'media_upload_validation_failed',
      });
      await ownedDbTable('daily_content_plans')
        .update({
          content: JSON.stringify(failed.content),
          content_status: failed.contentStatus,
          failure_reason: validationErrors.join(' | '),
          failure_type: 'transient',
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
      return { rowId, ok: false, from: failed.from, to: failed.to, scheduled: false, validationValid: false, reason: 'validation_failed' };
    } catch (error) {
      if (error instanceof CreatorLifecycleTransitionError) {
        return { rowId, ok: false, scheduled: false, validationValid: false, reason: `transition_blocked:${error.from}->${error.to}` };
      }
      throw error;
    }
  }

  // ── Validation passed → media_uploaded → ready_for_schedule ────────────
  const details = (validation as { details?: { detected_mime?: string | null; detected_size_bytes?: number | null } }).details;
  const uploadPatch: Record<string, unknown> = {
    uploaded_media_url: mediaUrl,
    upload_source: source,
    uploaded_mime_type: details?.detected_mime ?? input.mimeType ?? null,
    uploaded_size_bytes: details?.detected_size_bytes ?? null,
    upload_validated_at: validation.validated_at,
    upload_validation: validation,
    upload_error: null,
  };

  let toUploaded;
  try {
    toUploaded = applyTransition(currentContent, CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED, {
      contentPatch: uploadPatch,
      reason: 'media_upload_validated',
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      // Row isn't at a state that allows → media_uploaded (e.g. already
      // scheduled). Best-effort, non-fatal for batch callers.
      return { rowId, ok: false, scheduled: false, validationValid: true, reason: `transition_blocked:${error.from}->${error.to}` };
    }
    throw error;
  }
  const toReady = applyTransition(toUploaded.content, CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE, {
    reason: 'auto_transition_after_validation',
  });

  const { error: writeError } = await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify(toReady.content),
      content_status: toReady.contentStatus,
      failure_reason: null,
      failure_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);
  if (writeError) {
    return { rowId, ok: false, scheduled: false, validationValid: true, reason: `write_failed:${writeError.message}` };
  }

  // ── Reuse the existing scheduler trigger (idempotent, per-row) ─────────
  const scheduleResult = await autoScheduleReadyCreatorRowById(rowId);
  const didSchedule = scheduleResult.status === 'scheduled' || scheduleResult.status === 'already_scheduled';

  return {
    rowId,
    ok: true,
    from: currentState ?? undefined,
    to: didSchedule ? CREATOR_LIFECYCLE_STATES.SCHEDULED : toReady.to,
    scheduled: didSchedule,
    scheduledPostId: scheduleResult.scheduledPostId ?? null,
    scheduleStatus: scheduleResult.status,
    validationValid: true,
  };
}
