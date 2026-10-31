import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/activity-workspace/[id]/upload-media-finalize
 *
 * Finalize step for TUS-based resumable uploads.
 *
 * MEDIA-H3: the browser no longer writes to the public bucket. It uploads,
 * under a server-issued signed upload token (`upload-media-authorize`), to a
 * server-minted key in the PRIVATE `media-quarantine` bucket. This route
 * re-authorizes the caller, validates the STORED object (stored size, stored
 * content type, magic bytes; images are decoded and re-encoded through
 * safeImageDecode), and only then MOVES it to the delivery bucket
 * (`media-uploads`, same key). Invalid objects are deleted from quarantine
 * and never become public. The row records the delivery reference the server
 * derived, never a client-supplied URL. A duplicate finalize of an already
 * promoted session is idempotent; a session that was replaced is refused.
 * A promotion failure leaves the object private for a retry.
 *
 * This deliberately avoids duplicating the upload pipeline logic. The
 * storage write itself is delegated to TUS; the post-write contract is
 * shared.
 *
 * Body (JSON):
 *   {
 *     storage_path: string;          // key within the media-quarantine bucket (server-minted)
 *     mime_type: string;
 *     size_bytes: number;
 *     source?: 'user_upload' | 'direct_upload' | 'tus_upload';
 *     expected_revision?: number;
 *     tus_upload_url?: string;       // persisted for resume-detection audit
 *     upload_session_id?: string;
 *   }
 *
 * Rejection paths: category / stored-type / signature / size / concurrency /
 * lifecycle / FSM gates. Unknown bytes are refused (strict signature check).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
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
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import {
  validateMediaUpload,
  resolveExpectedCategory,
} from '@/backend/services/mediaUploadValidationService';
import { autoScheduleReadyCreatorRowById } from '@/backend/services/creator/creatorRowScheduler';
import { isActivityObjectPath } from '@/backend/services/activityWorkspace/activityObjectPath';
import {
  DELIVERY_BUCKET,
  MAX_QUARANTINE_BYTES,
  validateQuarantinedMedia,
  promoteQuarantinedMedia,
  discardQuarantinedObject,
  removeDeliveryObject,
  readConsumedObjectPaths,
  appendConsumedObjectPath,
} from '@/backend/services/activityWorkspace/quarantinedMediaUpload';

/** Delivery bucket (public). Only the server writes here, after validation. */
const UPLOAD_BUCKET = DELIVERY_BUCKET;
const MAX_FILE_BYTES = MAX_QUARANTINE_BYTES;
const PROMOTED_STATES = new Set<string>([
  CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED,
  CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE,
  CREATOR_LIFECYCLE_STATES.SCHEDULED,
]);

type FinalizeBody = {
  storage_path?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  source?: unknown;
  expected_revision?: unknown;
  tus_upload_url?: unknown;
  upload_session_id?: unknown;
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

/** Rejections before promotion delete the caller's QUARANTINED object only. */
const deleteStorageObject = discardQuarantinedObject;

/** Replacement of a prior DELIVERED object of this activity. */
async function deletePriorDeliveredObject(objectPath: string): Promise<void> {
  await removeDeliveryObject(objectPath);
}

/**
 * J1 H3-2 - does the committed row reference `objectPath` as its delivered
 * object? true also when the row cannot be read (fail safe: keep the object).
 */
async function committedRowReferencesObject(id: string, objectPath: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('content')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return true;
    const content = safeObject((data as { content?: unknown }).content);
    return content.upload_storage_bucket === UPLOAD_BUCKET && content.upload_storage_object_path === objectPath;
  } catch {
    return true;
  }
}

function extractStorageObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    const idx = url.pathname.indexOf(`/${UPLOAD_BUCKET}/`);
    if (idx === -1) return null;
    return url.pathname.slice(idx + UPLOAD_BUCKET.length + 2);
  } catch {
    return null;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  // 3AH-91 (S-1) — authenticate BEFORE anything else. The storage object is
  // named by the caller, so no read, delete or download may happen until the
  // caller is known and authorized for the activity that owns it.
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user?.id) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const body = (req.body || {}) as FinalizeBody;
  const storagePath = typeof body.storage_path === 'string' ? body.storage_path.trim() : '';
  const mimeRaw = typeof body.mime_type === 'string' ? body.mime_type.trim() : '';
  const sizeBytes = typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes) ? body.size_bytes : 0;
  const sourceRaw = typeof body.source === 'string' ? body.source.trim() : '';
  const source = (sourceRaw === 'user_upload' || sourceRaw === 'direct_upload' || sourceRaw === 'tus_upload')
    ? sourceRaw
    : 'tus_upload';
  const tusUploadUrl = typeof body.tus_upload_url === 'string' ? body.tus_upload_url.trim() : '';
  const uploadSessionId = typeof body.upload_session_id === 'string' ? body.upload_session_id.trim() : '';
  const expectedRevision = typeof body.expected_revision === 'number' && Number.isFinite(body.expected_revision)
    ? body.expected_revision
    : null;

  if (!storagePath) return res.status(400).json({ error: 'storage_path is required.' });
  if (!mimeRaw) return res.status(400).json({ error: 'mime_type is required.' });
  if (!sizeBytes || sizeBytes <= 0) return res.status(400).json({ error: 'size_bytes must be > 0.' });
  const mimeBase = mimeRaw.split(';')[0].trim().toLowerCase();

  // ── Load the activity (trusted server state) ──────────────────────────
  // Nothing below may touch storage until the activity is proven to belong to
  // a company the caller is an active member of. An activity that cannot be
  // loaded or authorized leaves the object alone: the caller has not shown it
  // is theirs to delete.
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return res.status(500).json({ error: 'Failed to load row.' });
  if (!rowData) return res.status(404).json({ error: `Row not found: ${id}` });
  const row = rowData as { id: string; campaign_id: string; content_type: string; content: unknown };

  // ── Resolve company + authorize ───────────────────────────────────────
  let companyId: string | null = null;
  try {
    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', row.campaign_id)
      .maybeSingle();
    if (campaignError) throw campaignError;
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch {
    return res.status(503).json({ error: 'Campaign company lookup failed. Please retry.', code: 'COMPANY_LOOKUP_FAILED' });
  }
  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId, campaignId: row.campaign_id });
  if (!access) return;

  // The caller-named object must belong to THIS authorized activity.
  if (!isActivityObjectPath(storagePath, id, companyId)) {
    return res.status(400).json({ error: 'storage_path is not an upload of this activity.', code: 'UPLOAD_PATH_OUT_OF_SCOPE' });
  }

  // ── Authorized: size + attachment-required gates (orphan cleanup allowed) ─
  if (sizeBytes > MAX_FILE_BYTES) {
    await deleteStorageObject(storagePath);
    return res.status(413).json({ error: `Uploaded file exceeds ${MAX_FILE_BYTES} bytes.` });
  }
  const contentType = normalizeCreatorFormat(row.content_type || '');
  if (!isAttachmentRequiredFormat(contentType)) {
    await deleteStorageObject(storagePath);
    return res.status(409).json({
      error: `Finalize is only valid for attachment-required formats. Got "${contentType}".`,
      code: 'UPLOAD_NOT_VALID_FOR_FORMAT',
    });
  }
  const expectedCategory = resolveExpectedCategory(contentType);
  if (!expectedCategory) {
    await deleteStorageObject(storagePath);
    return res.status(409).json({ error: `No upload category for content_type "${contentType}".`, code: 'UPLOAD_NOT_VALID_FOR_FORMAT' });
  }

  // ── Declared MIME category check (the stored object is checked below) ─
  const matchesCategory =
    (expectedCategory === 'video' && mimeBase.startsWith('video/')) ||
    (expectedCategory === 'audio' && mimeBase.startsWith('audio/')) ||
    (expectedCategory === 'image' && mimeBase.startsWith('image/'));
  if (!matchesCategory) {
    await deleteStorageObject(storagePath);
    return res.status(415).json({
      error: `Uploaded MIME "${mimeBase}" does not match expected category "${expectedCategory}" for "${contentType}".`,
      code: 'UPLOAD_MIME_MISMATCH',
    });
  }
  // ── Duplicate / replayed finalize (idempotent, never re-promoted) ──────
  const currentContentEarly = safeObject(row.content);
  const alreadyPromotedHere = currentContentEarly.upload_quarantine_promoted === true
    && currentContentEarly.upload_storage_bucket === UPLOAD_BUCKET
    && currentContentEarly.upload_storage_object_path === storagePath
    && PROMOTED_STATES.has(readLifecycleState(currentContentEarly));
  if (alreadyPromotedHere) {
    // A re-upload with a still-valid token to the consumed key stays private and is dropped.
    await deleteStorageObject(storagePath);
    return res.status(200).json({
      success: true,
      idempotent_replay: true,
      from: readLifecycleState(currentContentEarly),
      to: readLifecycleState(currentContentEarly),
      daily_plan_id: id,
      content_type: contentType,
      uploaded_media_url: currentContentEarly.uploaded_media_url ?? null,
      upload_source: currentContentEarly.upload_source ?? source,
      uploaded_mime_type: currentContentEarly.uploaded_mime_type ?? null,
      uploaded_size_bytes: currentContentEarly.uploaded_size_bytes ?? null,
      storage: { bucket: UPLOAD_BUCKET, object_path: storagePath },
    });
  }
  if (readConsumedObjectPaths(currentContentEarly).includes(storagePath)) {
    await deleteStorageObject(storagePath);
    return res.status(409).json({
      error: 'This upload session was already finalized and replaced. Start a new upload.',
      code: 'UPLOAD_SESSION_CONSUMED',
    });
  }

  // ── Validate the STORED object in quarantine (bytes + stored metadata) ─
  const checked = await validateQuarantinedMedia({
    objectPath: storagePath,
    declaredMime: mimeBase,
    expectedCategory,
    companyId,
  });
  if (checked.ok === false) {
    const failure = checked;
    if (failure.discard) await deleteStorageObject(storagePath);
    return res.status(failure.status).json({ error: failure.reason, code: failure.code });
  }
  const validatedMime = checked.mime;
  const validatedSize = checked.sizeBytes;

  // ── Delivery reference (derived by the server; not yet public) ────────
  const { data: publicUrlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlData?.publicUrl || '';
  if (!publicUrl) {
    await deleteStorageObject(storagePath);
    return res.status(500).json({ error: 'Failed to resolve public URL.' });
  }

  const validation = await validateMediaUpload({
    mediaUrl: publicUrl,
    contentType,
    mimeType: validatedMime,
    sizeBytes: validatedSize,
    skipLiveness: true,
  });

  const currentContent = safeObject(row.content);
  const currentState = readLifecycleState(currentContent);

  if (expectedRevision !== null) {
    const actualRevision = readLifecycleRevision(currentContent);
    if (expectedRevision !== actualRevision) {
      await deleteStorageObject(storagePath);
      return res.status(409).json({
        error: `Row revision changed since fetch: expected ${expectedRevision}, actual ${actualRevision}.`,
        code: 'CONCURRENT_UPLOAD_CONFLICT',
        expected_revision: expectedRevision,
        actual_revision: actualRevision,
      });
    }
  }

  if (!validation.valid) {
    await deleteStorageObject(storagePath);
    const failureValidation = validation as { valid: false; validated_at: string; errors: string[]; details: unknown };
    const errs = Array.isArray(failureValidation.errors) ? failureValidation.errors : ['Validation failed'];
    const failurePatch: Record<string, unknown> = {
      upload_validated_at: validation.validated_at,
      upload_validation: validation,
      upload_error: errs.join(' | '),
      upload_attempted_object_path: storagePath,
      tus_upload_url: tusUploadUrl || null,
      upload_session_id: uploadSessionId || null,
    };
    let transition;
    try {
      transition = applyTransition(currentContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
        contentPatch: failurePatch,
        reason: 'tus_finalize_validation_failed',
      });
    } catch (error) {
      if (error instanceof CreatorLifecycleTransitionError) {
        return res.status(409).json({ error: error.message, code: error.code, from: error.from, to: error.to });
      }
      throw error;
    }
    await ownedDbTable('daily_content_plans')
      .update({
        content: JSON.stringify(transition.content),
        content_status: transition.contentStatus,
        failure_reason: errs.join(' | '),
        failure_type: 'transient',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return res.status(200).json({
      success: false,
      validation,
      from: currentState,
      to: transition.to,
      message: 'Finalize validation failed.',
    });
  }

  // ── Validation passed → media_uploaded → ready_for_schedule ───────────
  const priorUploadedUrl = typeof currentContent.uploaded_media_url === 'string'
    ? (currentContent.uploaded_media_url as string)
    : null;

  const uploadPatch: Record<string, unknown> = {
    uploaded_media_url: publicUrl,
    upload_source: source,
    uploaded_mime_type: validatedMime,
    uploaded_size_bytes: validatedSize,
    upload_validated_at: validation.validated_at,
    upload_validation: validation,
    upload_storage_bucket: UPLOAD_BUCKET,
    upload_storage_object_path: storagePath,
    // MEDIA-H3: this delivery object exists only because the server validated
    // and promoted it; the key is consumed and can never be promoted again.
    upload_quarantine_promoted: true,
    upload_consumed_object_paths: appendConsumedObjectPath(currentContent, storagePath),
    upload_error: null,
    upload_attempted_object_path: null,
    tus_upload_url: tusUploadUrl || null,
    upload_session_id: uploadSessionId || null,
  };
  let toUploaded;
  try {
    toUploaded = applyTransition(currentContent, CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED, {
      contentPatch: uploadPatch,
      reason: 'tus_finalize_validated',
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      await deleteStorageObject(storagePath);
      return res.status(409).json({ error: error.message, code: error.code, from: error.from, to: error.to });
    }
    await deleteStorageObject(storagePath);
    throw error;
  }
  const toReady = applyTransition(toUploaded.content, CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE, {
    reason: 'auto_transition_after_tus_finalize',
  });

  // ── Promote: quarantine → delivery (same key). Failure keeps it private. ─
  const promotion = await promoteQuarantinedMedia({ objectPath: storagePath, validated: checked, companyId });
  if (promotion.ok === false && promotion.conflict === true) {
    // J1 H3-1: an object already sits at the delivery key and it is not the
    // object validated above (logged as a security event by the service).
    // Nothing is recorded or scheduled; the foreign object is left untouched.
    return res.status(409).json({
      error: 'The upload could not be published: the delivery location holds a different object.',
      code: 'UPLOAD_DELIVERY_CONFLICT',
      retryable: false,
    });
  }
  if (promotion.ok === false) {
    console.warn('[upload-media-finalize] promotion failed; object stays quarantined', {
      daily_plan_id: id, objectPath: storagePath, reason: promotion.reason,
    });
    return res.status(503).json({
      error: 'The upload was validated but could not be published. Please retry finalize.',
      code: 'UPLOAD_PROMOTION_FAILED',
      retryable: true,
    });
  }

  const { error: writeError } = await ownedDbTable('daily_content_plans')
    .update({
      content: JSON.stringify(toReady.content),
      content_status: toReady.contentStatus,
      failure_reason: null,
      failure_type: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (writeError) {
    // Roll the promoted object back out of the public bucket — but only if THIS
    // request promoted it. An alreadyPromoted object belongs to a concurrent
    // finalize whose row write may have succeeded; deleting it would leave that
    // row with a dangling public reference.
    //
    // J1 H3-2: even when THIS request promoted it, a concurrent finalize of the
    // same session (alreadyPromoted=true there) may have committed a row that
    // points at it. Re-read the row and delete only when no committed row
    // references the key. If the re-read fails, keep the object (an orphan is
    // recoverable; a dangling public reference on a committed row is not).
    if (!promotion.alreadyPromoted && !(await committedRowReferencesObject(id, storagePath))) {
      await removeDeliveryObject(storagePath);
    }
    return res.status(500).json({ error: `Failed to record upload: ${writeError.message}` });
  }

  // Post-upload auto-schedule: schedule THIS row now (insert scheduled_posts +
  // enqueue + flip to 'scheduled') without rerunning the BOLT pipeline.
  // Best-effort + idempotent — on skip/error the row stays ready_for_schedule.
  const scheduleResult = await autoScheduleReadyCreatorRowById(id);
  const didSchedule = scheduleResult.status === 'scheduled' || scheduleResult.status === 'already_scheduled';

  // Best-effort replacement: drop the prior storage object now that the
  // new URL is recorded.
  // Only ever an object of this activity (a URL recorded before 3AH-91 could
  // name an arbitrary object in the bucket).
  const priorObjectPath = extractStorageObjectPath(priorUploadedUrl);
  if (priorObjectPath && priorObjectPath !== storagePath && isActivityObjectPath(priorObjectPath, id, companyId)) {
    void deletePriorDeliveredObject(priorObjectPath);
  }

  return res.status(200).json({
    success: true,
    validation,
    from: currentState,
    intermediate: toUploaded.to,
    to: didSchedule ? CREATOR_LIFECYCLE_STATES.SCHEDULED : toReady.to,
    daily_plan_id: id,
    content_type: contentType,
    uploaded_media_url: publicUrl,
    upload_source: source,
    uploaded_mime_type: validatedMime,
    uploaded_size_bytes: validatedSize,
    scheduled: didSchedule,
    scheduled_post_id: scheduleResult.scheduledPostId,
    schedule_status: scheduleResult.status,
    storage: { bucket: UPLOAD_BUCKET, object_path: storagePath },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/upload-media-finalize' });
