/**
 * POST /api/activity-workspace/[id]/upload-media-finalize
 *
 * Finalize step for TUS-based resumable uploads. The client streams the
 * file directly to Supabase Storage via `tus-js-client` (over the
 * Supabase TUS endpoint, `/storage/v1/upload/resumable`). Once TUS
 * reports success, the client POSTs to this endpoint with the resulting
 * storage object path; the server then performs the EXACT same validate
 * + FSM transition + FK + scheduled_post handoff that
 * `upload-media-direct.ts` does post-storage.
 *
 * This deliberately avoids duplicating the upload pipeline logic. The
 * storage write itself is delegated to TUS; the post-write contract is
 * shared.
 *
 * Body (JSON):
 *   {
 *     storage_path: string;          // path within media-uploads bucket
 *     mime_type: string;
 *     size_bytes: number;
 *     source?: 'user_upload' | 'direct_upload' | 'tus_upload';
 *     expected_revision?: number;
 *     tus_upload_url?: string;       // persisted for resume-detection audit
 *     upload_session_id?: string;
 *   }
 *
 * Rejection paths: identical to `upload-media-direct.ts` — same MIME
 * spoof / category / concurrency / lifecycle / FSM gates. The MIME
 * sniff still runs server-side (we download the first chunk from the
 * uploaded object).
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
  LIFECYCLE_STATES,
} from '@/lib/shared/creatorLifecycleStateMachine';
import {
  validateMediaUpload,
  resolveExpectedCategory,
  sniffMimeFromBytes,
  compareSniffedToClientMime,
} from '@/backend/services/mediaUploadValidationService';

const UPLOAD_BUCKET = 'media-uploads';
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

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

async function deleteStorageObject(objectPath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([objectPath]);
    if (error) {
      console.warn('[upload-media-finalize] orphan cleanup failed', { objectPath, error: error.message });
    }
  } catch (error) {
    console.warn('[upload-media-finalize] orphan cleanup threw', { objectPath, message: (error as Error)?.message });
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

/**
 * Fetch the first N bytes of an uploaded object for server-side MIME
 * sniffing. Uses an HTTP `Range: bytes=0-(N-1)` request so a 2 GB upload
 * does NOT trigger a full download just to read the magic bytes.
 *
 * Fallback order:
 *   1. Range request against the bucket's public URL — 206 Partial Content.
 *   2. Range request that the server quietly honors with 200 (some CDNs
 *      drop the Range header but still return only the requested bytes
 *      when they can; we slice the response defensively).
 *   3. Full `download()` via supabase-js — last resort.
 *
 * If a 416 / unsupported-range response comes back, we transparently
 * fall through to `download()` so MIME sniffing still runs on legacy
 * storage backends.
 *
 * Returns null on any unrecoverable failure; the caller treats that as
 * "could not sniff" — same as the prior behavior.
 */
async function fetchFirstBytes(objectPath: string, byteCount: number): Promise<Buffer | null> {
  // ── Try range fetch against the public URL first ──────────────────────
  try {
    const { data: urlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(objectPath);
    const publicUrl = urlData?.publicUrl;
    if (publicUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(publicUrl, {
        method: 'GET',
        headers: {
          range: `bytes=0-${byteCount - 1}`,
          accept: '*/*',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.status === 206 || resp.status === 200) {
        const arr = await resp.arrayBuffer();
        const buf = Buffer.from(arr);
        // Defensive slice: even if the server ignored the Range header
        // we only consume `byteCount` bytes for sniffing.
        return buf.slice(0, byteCount);
      }
      // 416 / 403 / 404 → fall through to full download
    }
  } catch (e) {
    console.warn('[upload-media-finalize] range fetch failed; falling back to download', {
      objectPath, message: (e as Error)?.message,
    });
  }

  // ── Fallback: full download (legacy path; rarely hot) ─────────────────
  try {
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(objectPath);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer).slice(0, byteCount);
  } catch (e) {
    console.warn('[upload-media-finalize] first-bytes fetch failed entirely', {
      objectPath, message: (e as Error)?.message,
    });
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
  if (sizeBytes > MAX_FILE_BYTES) {
    await deleteStorageObject(storagePath);
    return res.status(413).json({ error: `Uploaded file exceeds ${MAX_FILE_BYTES} bytes.` });
  }
  const mimeBase = mimeRaw.split(';')[0].trim().toLowerCase();

  // ── Load row + assert attachment-required ─────────────────────────────
  const { data: rowData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('id, campaign_id, content_type, content, content_status, platform')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return res.status(500).json({ error: 'Failed to load row.' });
  if (!rowData) {
    // Object exists in storage but row is gone — clean it up.
    await deleteStorageObject(storagePath);
    return res.status(404).json({ error: `Row not found: ${id}` });
  }
  const row = rowData as { id: string; campaign_id: string; content_type: string; content: unknown };
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

  // ── Resolve company + auth ────────────────────────────────────────────
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
    await deleteStorageObject(storagePath);
    return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) {
    await deleteStorageObject(storagePath);
    return;
  }

  // ── MIME category check + server-side sniff against first bytes ───────
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
  const firstBytes = await fetchFirstBytes(storagePath, 32);
  if (firstBytes) {
    const sniffed = sniffMimeFromBytes(firstBytes);
    const sniffResult = compareSniffedToClientMime({ sniffed, claimed: mimeBase });
    if (!sniffResult.ok) {
      const failure = sniffResult as { ok: false; sniffed: string; claimed: string; reason: string };
      await deleteStorageObject(storagePath);
      return res.status(415).json({
        error: failure.reason,
        code: 'UPLOAD_MIME_SPOOF',
        claimed_mime: failure.claimed,
        sniffed_mime: failure.sniffed,
      });
    }
  }

  // ── Resolve the public URL + validate ─────────────────────────────────
  const { data: publicUrlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlData?.publicUrl || '';
  if (!publicUrl) {
    await deleteStorageObject(storagePath);
    return res.status(500).json({ error: 'Failed to resolve public URL.' });
  }

  const validation = await validateMediaUpload({
    mediaUrl: publicUrl,
    contentType,
    mimeType: mimeBase,
    sizeBytes,
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
    uploaded_mime_type: mimeBase,
    uploaded_size_bytes: sizeBytes,
    upload_validated_at: validation.validated_at,
    upload_validation: validation,
    upload_storage_bucket: UPLOAD_BUCKET,
    upload_storage_object_path: storagePath,
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
    await deleteStorageObject(storagePath);
    return res.status(500).json({ error: `Failed to record upload: ${writeError.message}` });
  }

  // Best-effort replacement: drop the prior storage object now that the
  // new URL is recorded.
  const priorObjectPath = extractStorageObjectPath(priorUploadedUrl);
  if (priorObjectPath && priorObjectPath !== storagePath) {
    void deleteStorageObject(priorObjectPath);
  }

  return res.status(200).json({
    success: true,
    validation,
    from: currentState,
    intermediate: toUploaded.to,
    to: toReady.to,
    daily_plan_id: id,
    content_type: contentType,
    uploaded_media_url: publicUrl,
    upload_source: source,
    uploaded_mime_type: mimeBase,
    uploaded_size_bytes: sizeBytes,
    storage: { bucket: UPLOAD_BUCKET, object_path: storagePath },
  });
}
