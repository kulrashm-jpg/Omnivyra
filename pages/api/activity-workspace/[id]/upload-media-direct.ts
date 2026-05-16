/**
 * POST /api/activity-workspace/[id]/upload-media-direct
 *
 * Direct (multipart/form-data) media upload for attachment-required rows.
 * Streams a user-supplied file to Supabase Storage (`media-uploads` bucket),
 * registers the resulting public URL with the existing upload lifecycle:
 *
 *     awaiting_media_upload | upload_failed
 *       → media_uploaded (validation passed; upload_source='direct_upload')
 *       → ready_for_schedule
 *
 * Reuses the link-based upload endpoint's validation + FSM exactly — no
 * duplicate lifecycle logic and no governance redesign. The only added
 * surface is multipart parsing + the storage write itself.
 *
 * Cleanup safety:
 *   - validation failure (MIME / size / category mismatch) deletes the
 *     just-uploaded storage object so no orphans persist
 *   - re-upload over a row that already has `uploaded_media_url` deletes
 *     the prior object before recording the new URL
 *   - DB write failure rolls back the new storage object
 *
 * Body: multipart/form-data with field `file` (the asset) + optional
 *       `source` field (defaults to 'direct_upload').
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { ownedDbTable } from '@/backend/db/writeOwner';
import formidable from 'formidable';
import fs from 'fs';
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
import {
  validateMediaUpload,
  resolveExpectedCategory,
  sniffMimeFromBytes,
  compareSniffedToClientMime,
} from '@/backend/services/mediaUploadValidationService';
import {
  emitCreatorEvent,
  CREATOR_EVENTS,
  withTrace,
  newTraceId,
} from '@/backend/services/creatorOperationalTelemetryService';
import { recordAuditEntry } from '@/backend/services/creatorAuditTrailService';
import {
  checkUploadAttemptAllowed,
  recordUploadSpoofAttempt,
  recordUploadFailure,
} from '@/backend/services/creatorUploadAbuseGuardService';

// Disable Next.js body parser so formidable can stream the upload.
export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_BUCKET = 'media-uploads';
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (matches validator hard cap)

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

function fieldAsString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function deriveObjectPath(input: { companyId: string; dailyPlanId: string; mime: string }): string {
  const subdir = input.mime.startsWith('video/')
    ? 'video'
    : input.mime.startsWith('audio/')
      ? 'audio'
      : input.mime.startsWith('image/')
        ? 'image'
        : 'misc';
  const stem = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Use file extension from the MIME if we can guess one; otherwise just
  // use the MIME subtype as the suffix (e.g. `video/mp4` → `mp4`).
  const ext = input.mime.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'bin';
  return `${input.companyId}/${input.dailyPlanId}/${subdir}/${stem}.${ext}`;
}

async function ensureUploadBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = Array.isArray(buckets) && buckets.some((b) => b.name === UPLOAD_BUCKET);
    if (exists) return;
    await supabase.storage.createBucket(UPLOAD_BUCKET, {
      public: true,
      fileSizeLimit: MAX_FILE_BYTES,
      allowedMimeTypes: [
        'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
        'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/x-m4a',
        'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      ],
    });
  } catch (error) {
    // Bucket creation may fail on permissions; uploads will report the
    // underlying error if the bucket genuinely doesn't exist.
    console.warn('[upload-media-direct] ensureUploadBucket failed:', (error as Error)?.message);
  }
}

async function deleteStorageObject(objectPath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([objectPath]);
    if (error) {
      console.warn('[upload-media-direct] orphan cleanup failed:', { objectPath, error: error.message });
    }
  } catch (error) {
    console.warn('[upload-media-direct] orphan cleanup threw:', { objectPath, message: (error as Error)?.message });
  }
}

function extractStorageObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    // Supabase public URLs: /storage/v1/object/public/<bucket>/<path>
    const idx = url.pathname.indexOf(`/${UPLOAD_BUCKET}/`);
    if (idx === -1) return null;
    return url.pathname.slice(idx + UPLOAD_BUCKET.length + 2); // skip "/<bucket>/"
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  // ── Server-aware cancellation tracking ─────────────────────────────────
  // Flip a flag as soon as the client disconnects mid-flight. Every code
  // path that could write to storage or DB checks it and bails out with
  // structured logging instead of leaving orphans behind. We also track
  // the storage object path so we can roll it back if the connection
  // dropped AFTER the storage write completed.
  //
  // Note: `req.on` is part of Node's http.IncomingMessage. We guard the
  // hookup so non-Node test mocks (which only implement `method` /
  // `query` / `body`) don't crash before the handler can run.
  const cancelState = { aborted: false, reason: '', uploadedObjectPath: null as string | null };
  const onClientClose = () => {
    cancelState.aborted = true;
    cancelState.reason = 'client_disconnected';
    console.log('[upload-media-direct][cancelled]', {
      daily_plan_id: id,
      reason: 'client_disconnected',
      uploaded_object_path: cancelState.uploadedObjectPath,
    });
    // Best-effort orphan cleanup if the abort fired AFTER storage finished.
    if (cancelState.uploadedObjectPath) {
      void deleteStorageObject(cancelState.uploadedObjectPath);
    }
  };
  const supportsOn = typeof (req as unknown as { on?: unknown }).on === 'function';
  const supportsRemoveListener = typeof (req as unknown as { removeListener?: unknown }).removeListener === 'function';
  if (supportsOn) {
    (req as unknown as { on: (event: string, cb: () => void) => void }).on('close', onClientClose);
  }
  const detachClientCloseListener = () => {
    if (supportsRemoveListener) {
      (req as unknown as { removeListener: (event: string, cb: () => void) => void })
        .removeListener('close', onClientClose);
    }
  };

  // ── Load row + assert attachment-required ──────────────────────────────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform')
    .eq('id', id)
    .maybeSingle();
  if (rowError) {
    console.warn('[upload-media-direct] daily_content_plans lookup failed', { id, error: rowError.message });
    return res.status(500).json({ error: 'Failed to load row.' });
  }
  if (!rowData) return res.status(404).json({ error: `Row not found: ${id}` });
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
      error: `Direct upload is only valid for attachment-required formats (video, reel, short, podcast). Got "${contentType}".`,
      code: 'UPLOAD_NOT_VALID_FOR_FORMAT',
    });
  }
  const expectedCategory = resolveExpectedCategory(contentType);
  if (!expectedCategory) {
    return res.status(409).json({
      error: `No upload category resolved for content_type "${contentType}".`,
      code: 'UPLOAD_NOT_VALID_FOR_FORMAT',
    });
  }

  // ── Resolve company + auth ─────────────────────────────────────────────
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
  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // ── Abuse + rate-limit gate (FAIL OPEN on infra error) ─────────────────
  const rateDecision = await checkUploadAttemptAllowed({
    userId: access.userId,
    companyId,
    dailyPlanId: id,
  });
  if (!rateDecision.allowed) {
    const denial = rateDecision as { allowed: false; reason: string; kind?: string; retry_after_seconds?: number; details?: Record<string, unknown> };
    return res.status(429).json({
      error: 'Upload rate limit exceeded or abuse detected.',
      code: denial.reason.toUpperCase(),
      kind: denial.kind,
      retry_after_seconds: denial.retry_after_seconds,
      details: denial.details,
    });
  }

  emitCreatorEvent({
    event: CREATOR_EVENTS.UPLOAD_STARTED,
    actorUserId: access.userId,
    companyId,
    dailyPlanId: id,
    campaignId: row.campaign_id,
    creatorFormat: contentType,
    metadata: { source: 'direct_upload' },
  });

  // ── Parse multipart form ───────────────────────────────────────────────
  const form = formidable({
    maxFileSize: MAX_FILE_BYTES,
    keepExtensions: true,
  });
  let parsed: { fields: formidable.Fields; files: formidable.Files };
  try {
    parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : 'Invalid multipart payload.';
    return res.status(400).json({ error: message });
  }

  const sourceField = fieldAsString(parsed.fields.source);
  const source: 'user_upload' | 'direct_upload' = sourceField === 'user_upload' ? 'user_upload' : 'direct_upload';
  // Optional concurrency token (multipart field). Parsed up-front so we
  // can reject stale uploads BEFORE writing anything to storage.
  const expectedRevisionRaw = fieldAsString(parsed.fields.expected_revision);
  const expectedRevision = expectedRevisionRaw.length > 0 && /^\d+$/.test(expectedRevisionRaw)
    ? Number(expectedRevisionRaw)
    : null;

  const fileArray = Array.isArray(parsed.files.file)
    ? parsed.files.file
    : (parsed.files.file ? [parsed.files.file] : []);
  const uploaded = fileArray[0];
  if (!uploaded || !uploaded.filepath) {
    return res.status(400).json({ error: 'No file uploaded. Expected multipart field "file".' });
  }
  const fileMime = String(uploaded.mimetype || 'application/octet-stream');
  const fileSize = Number(uploaded.size ?? 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
    return res.status(400).json({ error: 'Uploaded file is empty.' });
  }
  if (fileSize > MAX_FILE_BYTES) {
    try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
    return res.status(413).json({ error: `Uploaded file exceeds ${MAX_FILE_BYTES} bytes.` });
  }

  // ── Pre-storage MIME / category check ──────────────────────────────────
  // This is the FIRST gate — reject obviously-wrong uploads before we
  // spend bandwidth pushing them to storage. The richer `validateMediaUpload`
  // runs AFTER storage to also confirm the resulting public URL is live.
  const mimeBase = fileMime.split(';')[0].trim().toLowerCase();
  const mimeMatchesCategory =
    (expectedCategory === 'video' && mimeBase.startsWith('video/')) ||
    (expectedCategory === 'audio' && mimeBase.startsWith('audio/')) ||
    (expectedCategory === 'image' && mimeBase.startsWith('image/'));
  if (!mimeMatchesCategory) {
    try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
    return res.status(415).json({
      error: `Uploaded MIME "${mimeBase}" does not match expected category "${expectedCategory}" for "${contentType}".`,
      code: 'UPLOAD_MIME_MISMATCH',
    });
  }

  // ── Concurrency check (BEFORE storage write) ──────────────────────────
  // If the caller asserted a revision, reject when the row has advanced
  // since they began the upload. Temp file is removed; no storage object
  // ever created.
  if (expectedRevision !== null) {
    const currentContentForCheck = safeObject(row.content);
    const actualRevision = readLifecycleRevision(currentContentForCheck);
    if (expectedRevision !== actualRevision) {
      try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
      return res.status(409).json({
        error: `Row revision changed since upload started: expected ${expectedRevision}, actual ${actualRevision}.`,
        code: 'CONCURRENT_UPLOAD_CONFLICT',
        expected_revision: expectedRevision,
        actual_revision: actualRevision,
      });
    }
  }

  // ── Stream file into Supabase Storage ──────────────────────────────────
  await ensureUploadBucket();
  const objectPath = deriveObjectPath({ companyId, dailyPlanId: id, mime: mimeBase });
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(uploaded.filepath);
  } catch (readError) {
    try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
    return res.status(500).json({ error: 'Failed to read uploaded file.' });
  }

  // ── Server-side MIME sniffing ──────────────────────────────────────────
  // Sniff the first chunk of bytes; reject if it contradicts the client's
  // multipart MIME claim. Runs after temp-file read but BEFORE we push
  // anything to storage, so a spoofed upload never leaves an orphan.
  const sniffedMime = sniffMimeFromBytes(fileBuffer.slice(0, 32));
  const sniffResult = compareSniffedToClientMime({ sniffed: sniffedMime, claimed: mimeBase });
  if (!sniffResult.ok) {
    const failure = sniffResult as { ok: false; sniffed: string; claimed: string; reason: string };
    void recordUploadSpoofAttempt({ userId: access.userId, companyId, dailyPlanId: id });
    emitCreatorEvent({
      event: CREATOR_EVENTS.UPLOAD_MIME_SPOOF,
      severity: 'warning',
      actorUserId: access.userId,
      companyId,
      dailyPlanId: id,
      campaignId: row.campaign_id,
      creatorFormat: contentType,
      metadata: { claimed: failure.claimed, sniffed: failure.sniffed, reason: failure.reason },
    });
    return res.status(415).json({
      error: failure.reason,
      code: 'UPLOAD_MIME_SPOOF',
      claimed_mime: failure.claimed,
      sniffed_mime: failure.sniffed,
    });
  }

  // Bail early if the client already disconnected before we even reach
  // the storage write — no orphan, no DB write.
  if (cancelState.aborted) {
    try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
    detachClientCloseListener();
    return; // headers already not flushed; nothing to send
  }

  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(objectPath, fileBuffer, { contentType: mimeBase, upsert: false, cacheControl: '3600' });
  // Always remove the temp file regardless of upload outcome.
  try { fs.unlinkSync(uploaded.filepath); } catch { /* ignore */ }
  if (uploadError) {
    detachClientCloseListener();
    return res.status(500).json({
      error: `Failed to upload to storage: ${uploadError.message}`,
      code: 'STORAGE_UPLOAD_FAILED',
    });
  }
  // Storage write succeeded — track the object path so the `req.on('close')`
  // handler can roll it back if the client disconnects between here and the
  // final DB write.
  cancelState.uploadedObjectPath = objectPath;
  // Stamp the resumable-session start timestamp on the row so the
  // storage janitor can detect stranded uploads. Best-effort; the column
  // is optional and missing in pre-migration environments.
  try {
    await ownedDbTable('daily_content_plans')
      .update({ resumable_session_started_at: new Date().toISOString() })
      .eq('id', id);
  } catch { /* pre-migration / column missing — non-fatal */ }

  // Check abort again RIGHT after the storage write: if the client
  // disconnected while bytes were going up, drop the just-written object
  // and exit. The `req.on('close')` handler will also fire the cleanup;
  // both calls are idempotent.
  if (cancelState.aborted) {
    await deleteStorageObject(objectPath);
    cancelState.uploadedObjectPath = null;
    detachClientCloseListener();
    return;
  }

  const { data: publicUrlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(objectPath);
  const publicUrl = publicUrlData?.publicUrl || '';
  if (!publicUrl) {
    await deleteStorageObject(objectPath);
    return res.status(500).json({ error: 'Failed to resolve public URL for uploaded object.' });
  }

  // ── Run the same validator the link-based upload uses ──────────────────
  // Liveness skipped because we just wrote the object and the Supabase
  // public URL is eventually consistent; the storage write itself is the
  // liveness proof. MIME + size + category checks still run.
  const validation = await validateMediaUpload({
    mediaUrl: publicUrl,
    contentType,
    mimeType: mimeBase,
    sizeBytes: fileSize,
    skipLiveness: true,
  });

  const currentContent = safeObject(row.content);
  const currentState = readLifecycleState(currentContent);
  const priorUploadedUrl = typeof currentContent.uploaded_media_url === 'string' ? currentContent.uploaded_media_url : null;
  const priorObjectPath = extractStorageObjectPath(priorUploadedUrl);

  if (!validation.valid) {
    // Orphan cleanup: delete the just-uploaded object so it doesn't linger.
    await deleteStorageObject(objectPath);
    const failureValidation = validation as { valid: false; validated_at: string; errors: string[]; details: unknown };
    const errs = Array.isArray(failureValidation.errors) ? failureValidation.errors : ['Validation failed'];
    void recordUploadFailure({ userId: access.userId, companyId });
    emitCreatorEvent({
      event: CREATOR_EVENTS.UPLOAD_VALIDATION_FAILED,
      severity: 'warning',
      actorUserId: access.userId,
      companyId,
      dailyPlanId: id,
      campaignId: row.campaign_id,
      creatorFormat: contentType,
      metadata: { errors: errs.slice(0, 5), source },
    });
    const failurePatch: Record<string, unknown> = {
      // Don't blow away the prior uploaded URL on failure — the user can
      // still retry, and the prior good URL (if any) stays addressable.
      upload_validated_at: validation.validated_at,
      upload_validation: validation,
      upload_error: errs.join(' | '),
      upload_attempted_object_path: objectPath,
    };
    let transition;
    try {
      transition = applyTransition(currentContent, LIFECYCLE_STATES.UPLOAD_FAILED, {
        contentPatch: failurePatch,
        reason: 'direct_upload_validation_failed',
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
      message: 'Direct upload validation failed.',
    });
  }

  // ── Validation passed: replace prior upload safely ─────────────────────
  // The previous object is deleted ONLY after the new transition is fully
  // recorded — if anything fails between here and the DB write we want the
  // old URL to remain addressable.
  const uploadPatch: Record<string, unknown> = {
    uploaded_media_url: publicUrl,
    upload_source: source,
    uploaded_mime_type: mimeBase,
    uploaded_size_bytes: fileSize,
    upload_validated_at: validation.validated_at,
    upload_validation: validation,
    upload_storage_bucket: UPLOAD_BUCKET,
    upload_storage_object_path: objectPath,
    upload_error: null,
    upload_attempted_object_path: null,
  };

  let toUploaded;
  try {
    toUploaded = applyTransition(currentContent, CREATOR_LIFECYCLE_STATES.MEDIA_UPLOADED, {
      contentPatch: uploadPatch,
      reason: 'direct_upload_validated',
    });
  } catch (error) {
    if (error instanceof CreatorLifecycleTransitionError) {
      // Roll back the new object — the FSM rejected the move, so the
      // new file shouldn't linger.
      await deleteStorageObject(objectPath);
      return res.status(409).json({
        error: error.message,
        code: error.code,
        from: error.from,
        to: error.to,
      });
    }
    await deleteStorageObject(objectPath);
    throw error;
  }
  const toReady = applyTransition(toUploaded.content, CREATOR_LIFECYCLE_STATES.READY_FOR_SCHEDULE, {
    reason: 'auto_transition_after_direct_upload',
  });

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
    // Roll back the newly-uploaded object so we don't leak an orphan after
    // a DB write failure.
    await deleteStorageObject(objectPath);
    return res.status(500).json({ error: `Failed to record upload: ${writeError.message}` });
  }

  // Best-effort: now that the new URL is persisted, drop the prior storage
  // object (re-upload replacement). Failures are logged but do not impact
  // the user-facing success path.
  if (priorObjectPath && priorObjectPath !== objectPath) {
    void deleteStorageObject(priorObjectPath);
  }

  // Cleanly remove the close listener so we don't leak listeners on the
  // socket once the response completes.
  detachClientCloseListener();

  emitCreatorEvent({
    event: CREATOR_EVENTS.UPLOAD_COMPLETED,
    actorUserId: access.userId,
    companyId,
    dailyPlanId: id,
    campaignId: row.campaign_id,
    creatorFormat: contentType,
    lifecycleState: toReady.to,
    metadata: { source, mime: mimeBase, size_bytes: fileSize, replaced_prior: !!priorObjectPath },
  });
  emitCreatorEvent({
    event: CREATOR_EVENTS.ATTACHMENT_READY_FOR_SCHEDULE,
    actorUserId: access.userId,
    companyId,
    dailyPlanId: id,
    campaignId: row.campaign_id,
    creatorFormat: contentType,
    lifecycleState: toReady.to,
  });
  recordAuditEntry({
    action: 'upload_completed',
    actorUserId: access.userId,
    actorKind: 'user',
    source: 'api',
    companyId,
    dailyPlanId: id,
    campaignId: row.campaign_id,
    previousState: { lifecycle_state: currentState },
    newState: { lifecycle_state: toReady.to, uploaded_media_url: publicUrl, mime: mimeBase, size_bytes: fileSize },
  });

  return res.status(200).json({
    success: true,
    validation,
    from: currentState,
    to: toReady.to,
    intermediate: toUploaded.to,
    daily_plan_id: id,
    content_type: contentType,
    uploaded_media_url: publicUrl,
    upload_source: source,
    uploaded_mime_type: mimeBase,
    uploaded_size_bytes: fileSize,
    storage: {
      bucket: UPLOAD_BUCKET,
      object_path: objectPath,
    },
  });
}
