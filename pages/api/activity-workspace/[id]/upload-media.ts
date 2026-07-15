import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/activity-workspace/[id]/upload-media
 *
 * Records a user-supplied media URL on an attachment-required row
 * (video / reel / short / podcast) and transitions the per-row lifecycle:
 *
 *     awaiting_media_upload | upload_failed
 *        → media_uploaded   (validation passed)
 *        → ready_for_schedule (auto, validation marked the row eligible)
 *
 * Validation failures transition the row to `upload_failed` so the user
 * can retry without losing the persisted guidance package.
 *
 * Body:
 *   {
 *     media_url: string,
 *     mime_type?: string,
 *     size_bytes?: number,
 *     source: 'user_upload' | 'external_link'
 *   }
 *
 * Rejection cases:
 *   - missing media_url / source
 *   - row not found (404)
 *   - row content_type is NOT attachment-required (409) — autonomous rows
 *     cannot accept uploads through this endpoint
 *   - validation failed (200 with valid:false in the response body; the
 *     row is moved to upload_failed but the API call itself succeeded)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  normalizeCreatorFormat,
  isAttachmentRequiredFormat,
  CREATOR_LIFECYCLE_STATES,
} from '@/lib/shared/creatorGovernanceRegistry';
import {
  applyTransition,
  readLifecycleState,
  readLifecycleRevision,
  CreatorLifecycleTransitionError,
  CreatorConcurrencyConflictError,
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import { validateMediaUpload } from '@/backend/services/mediaUploadValidationService';
import { autoScheduleReadyCreatorRowById } from '@/backend/services/creator/creatorRowScheduler';

type UploadMediaBody = {
  media_url?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  source?: unknown;
  /** Optimistic-concurrency token (row's lifecycle revision at fetch time). */
  expected_revision?: unknown;
};

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  const body = (req.body || {}) as UploadMediaBody;
  const mediaUrl = typeof body.media_url === 'string' ? body.media_url.trim() : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim() : undefined;
  const sizeBytes = typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes) ? body.size_bytes : undefined;
  const sourceRaw = typeof body.source === 'string' ? body.source.trim() : '';
  const source = (sourceRaw === 'user_upload' || sourceRaw === 'external_link') ? sourceRaw : null;
  // Optimistic-concurrency token (optional). Caller passes whatever the
  // row's revision was at fetch time. We compare to the row's CURRENT
  // revision below; mismatch → 409 CONCURRENT_UPLOAD_CONFLICT.
  const expectedRevision = typeof body.expected_revision === 'number' && Number.isFinite(body.expected_revision)
    ? body.expected_revision
    : null;

  if (!mediaUrl) {
    return res.status(400).json({ error: 'media_url is required.' });
  }
  if (!source) {
    return res.status(400).json({ error: 'source must be "user_upload" or "external_link".' });
  }

  // ── Load row + assert it's attachment-required ─────────────────────────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform')
    .eq('id', id)
    .maybeSingle();
  if (rowError) {
    console.warn('[upload-media] daily_content_plans lookup failed', { id, error: rowError.message });
    return res.status(500).json({ error: 'Failed to load row.' });
  }
  if (!rowData) {
    return res.status(404).json({ error: `Row not found: ${id}` });
  }
  const row = rowData as {
    id: string;
    campaign_id: string;
    content_type: string;
    content: unknown;
    content_status: string | null;
    platform: string | null;
  };
  const contentType = normalizeCreatorFormat(row.content_type || '');
  if (!isAttachmentRequiredFormat(contentType)) {
    return res.status(409).json({
      error: `Upload is only valid for attachment-required formats (video, reel, short, podcast). Got "${contentType}".`,
      code: 'UPLOAD_NOT_VALID_FOR_FORMAT',
    });
  }

  // ── Auth via campaign company ──────────────────────────────────────────
  let companyId: string | null = null;
  try {
    const { data: campaignRow } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch {
    /* fall through */
  }
  if (!companyId) {
    return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // ── Validate the media URL ─────────────────────────────────────────────
  const validation = await validateMediaUpload({
    mediaUrl,
    contentType,
    mimeType,
    sizeBytes,
  });

  const currentContent = safeObject(row.content);
  const currentState = readLifecycleState(currentContent);

  // ── Concurrency check ─────────────────────────────────────────────────
  // If the caller asserted a revision, reject when the row has advanced
  // since they fetched it. We don't transition any state here — the row
  // remains exactly as the conflicting writer left it.
  if (expectedRevision !== null) {
    const actualRevision = readLifecycleRevision(currentContent);
    if (expectedRevision !== actualRevision) {
      return res.status(409).json({
        error: `Row revision changed since fetch: expected ${expectedRevision}, actual ${actualRevision}.`,
        code: 'CONCURRENT_UPLOAD_CONFLICT',
        expected_revision: expectedRevision,
        actual_revision: actualRevision,
      });
    }
  }

  if (validation.valid === false) {
    // Move to upload_failed (or stay there); preserve the user-supplied URL
    // so the workspace can re-render with the bad value and the validation
    // errors next to it.
    const validationErrors: string[] = Array.isArray(validation.errors) ? validation.errors : [];
    const failurePatch: Record<string, unknown> = {
      uploaded_media_url: mediaUrl,
      upload_source: source,
      uploaded_mime_type: mimeType ?? null,
      uploaded_size_bytes: sizeBytes ?? null,
      upload_validated_at: validation.validated_at,
      upload_validation: validation,
      upload_error: validationErrors.join(' | '),
    };
    let transition;
    try {
      transition = applyTransition(currentContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
        contentPatch: failurePatch,
        reason: 'media_upload_validation_failed',
      });
    } catch (error) {
      if (error instanceof CreatorLifecycleTransitionError) {
        return res.status(409).json({
          error: error.message,
          code: error.code,
          from: error.from,
          to: error.to,
        });
      }
      throw error;
    }
    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify(transition.content),
        content_status: transition.contentStatus,
        failure_reason: validationErrors.join(' | '),
        failure_type: 'transient',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return res.status(200).json({
      success: false,
      validation,
      from: transition.from,
      to: transition.to,
      message: 'Media upload validation failed.',
    });
  }

  // ── Validation passed → media_uploaded → ready_for_schedule ────────────
  const uploadPatch: Record<string, unknown> = {
    uploaded_media_url: mediaUrl,
    upload_source: source,
    uploaded_mime_type: validation.details.detected_mime ?? mimeType ?? null,
    uploaded_size_bytes: validation.details.detected_size_bytes ?? sizeBytes ?? null,
    upload_validated_at: validation.validated_at,
    upload_validation: validation,
    upload_error: null,
  };

  // Two-step transition: → media_uploaded → ready_for_schedule.
  // The intermediate state is captured in the lifecycle history so audits
  // can trace exactly when validation completed.
  let toUploaded;
  try {
    toUploaded = applyTransition(currentContent, CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED, {
      contentPatch: uploadPatch,
      reason: 'media_upload_validated',
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        from: error.from,
        to: error.to,
      });
    }
    throw error;
  }
  const toReady = applyTransition(toUploaded.content, CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE, {
    reason: 'auto_transition_after_validation',
  });

  const { error: readyWriteError } = await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify(toReady.content),
      content_status: toReady.contentStatus,
      failure_reason: null,
      failure_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (readyWriteError) {
    return res.status(500).json({ error: `Failed to record upload: ${readyWriteError.message}` });
  }

  // Post-upload auto-schedule: now that the row is ready_for_schedule,
  // schedule THIS row immediately (insert scheduled_posts + enqueue + flip to
  // 'scheduled') without rerunning the BOLT pipeline. Best-effort and
  // idempotent — on skip/error the row stays ready_for_schedule.
  const scheduleResult = await autoScheduleReadyCreatorRowById(id);

  return res.status(200).json({
    success: true,
    validation,
    from: currentState,
    to: scheduleResult.status === 'scheduled' || scheduleResult.status === 'already_scheduled'
      ? CREATOR_LIFECYCLE_STATES.SCHEDULED
      : toReady.to,
    intermediate: toUploaded.to,
    daily_plan_id: id,
    content_type: contentType,
    uploaded_media_url: mediaUrl,
    scheduled: scheduleResult.status === 'scheduled' || scheduleResult.status === 'already_scheduled',
    scheduled_post_id: scheduleResult.scheduledPostId,
    schedule_status: scheduleResult.status,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/upload-media' });
