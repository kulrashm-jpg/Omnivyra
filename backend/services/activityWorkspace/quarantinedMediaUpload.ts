/**
 * MEDIA-H3 — quarantine → validate → promote for browser (resumable/TUS) uploads.
 *
 * THE DEFECT (gate23 adversarial audit, H-3): the browser streamed bytes with
 * the publishable key straight into the PUBLIC `media-uploads` bucket. The
 * object was world-readable the moment TUS completed — before (and without)
 * any server validation — and Next's `/_next/image` would hand those bytes to
 * libvips whatever their declared type.
 *
 * THE DESIGN
 *   1. `POST /api/activity-workspace/[id]/upload-media-authorize` (authenticated,
 *      tenant-authorized) mints a server-chosen object key
 *      `<companyId>/<activityId>/<subdir>/<128-bit stem>.<ext>` and a Supabase
 *      signed upload token for exactly that key in the PRIVATE
 *      `media-quarantine` bucket (`upsert: false`). The browser cannot pick the
 *      bucket or the key, and cannot overwrite an existing object.
 *   2. The browser uploads with TUS to `/storage/v1/upload/resumable/sign`
 *      using `x-signature: <token>`. No storage policy grants anon or
 *      authenticated writes to either bucket (migration 20270111000000).
 *   3. `POST .../upload-media-finalize` re-authorizes, then validates the
 *      STORED bytes and the STORED metadata (size, content type) — never the
 *      client's claim — and only then MOVES the object into the delivery bucket
 *      (`media-uploads`). An invalid object is deleted from quarantine; it is
 *      never public.
 *
 * The delivery key equals the quarantine key, so a duplicate finalize can be
 * recognised, and promotion is a single server-side move (no byte copy through
 * the app for multi-GB videos).
 */
import { supabase } from '../../db/supabaseClient';
import { unguessableObjectStem } from '../../../lib/security/objectNames';
import { nonImageBytesMatchDeclaredType } from '../../../lib/security/mediaByteSignature';
import {
  SAFE_IMAGE_DEFAULT_MAX_BYTES,
  isImageRejectedError,
  reportImageFailure,
  sniffSafeImageMime,
  transformUntrustedImage,
  type SharpFactory,
} from '../../../lib/security/safeImageDecode';
import type { MediaUploadCategory } from '../mediaUploadValidationService';

export const QUARANTINE_BUCKET = 'media-quarantine';
export const DELIVERY_BUCKET = 'media-uploads';
export const MAX_QUARANTINE_BYTES = 2 * 1024 * 1024 * 1024;
/** Bytes read from the head of a stored object for the signature check. */
export const HEAD_BYTES = 32;
/** A full download is only ever used as a fallback for objects this small. */
const FULL_DOWNLOAD_FALLBACK_MAX_BYTES = SAFE_IMAGE_DEFAULT_MAX_BYTES;

/** Content types a quarantined object may carry. Mirrors the bucket allowlist in the migration. */
export const QUARANTINE_ALLOWED_MIME_TYPES: readonly string[] = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
];

export function normalizeMime(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().split(';')[0].trim();
}

export function mimeCategory(mime: string): MediaUploadCategory | null {
  const top = normalizeMime(mime).split('/')[0];
  return top === 'video' || top === 'audio' || top === 'image' ? top : null;
}

/** Server-minted quarantine key. Never derived from a client-supplied path. */
export function mintQuarantineObjectPath(input: { companyId: string; activityId: string; mime: string }): {
  objectPath: string;
  stem: string;
} {
  const mime = normalizeMime(input.mime);
  const subdir = mimeCategory(mime) ?? 'misc';
  const ext = mime.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'bin';
  const stem = unguessableObjectStem();
  return { objectPath: `${input.companyId}/${input.activityId}/${subdir}/${stem}.${ext}`, stem };
}

export type QuarantineValidationFailure = {
  ok: false;
  status: number;
  code: string;
  reason: string;
  /** Delete the quarantined object (the bytes are bad). False = transient: keep it so finalize can be retried. */
  discard: boolean;
};

export type QuarantineValidationSuccess = {
  ok: true;
  category: MediaUploadCategory;
  mime: string;
  sizeBytes: number;
  /** Present for images: the re-encoded bytes that replace the upload. */
  normalized?: Buffer;
};

export type QuarantineValidationResult = QuarantineValidationSuccess | QuarantineValidationFailure;

const fail = (status: number, code: string, reason: string, discard: boolean): QuarantineValidationFailure => ({
  ok: false, status, code, reason, discard,
});

type StoredInfo = { ok: true; size: number; contentType: string } | { ok: false; missing: boolean; message: string };

function looksMissing(message: string): boolean {
  return /not.?found|does not exist|no such|404/i.test(message);
}

/** Stored size + content type from storage metadata. */
export async function inspectQuarantinedObject(objectPath: string): Promise<StoredInfo> {
  try {
    const { data, error } = await supabase.storage.from(QUARANTINE_BUCKET).info(objectPath);
    if (error || !data) {
      const message = error?.message ?? 'no metadata';
      return { ok: false, missing: looksMissing(message), message };
    }
    const d = data as { size?: unknown; contentType?: unknown; metadata?: Record<string, unknown> | null };
    const size = Number(d.size ?? d.metadata?.size ?? NaN);
    const contentType = normalizeMime(d.contentType ?? d.metadata?.mimetype ?? '');
    if (!Number.isFinite(size)) return { ok: false, missing: false, message: 'stored size unavailable' };
    return { ok: true, size, contentType };
  } catch (error) {
    return { ok: false, missing: false, message: (error as Error)?.message ?? 'info failed' };
  }
}

/**
 * First `byteCount` bytes of a quarantined object: a Range request on a
 * 60-second signed URL (the bucket is private, so there is no public URL).
 * Falls back to a full download only for small objects.
 */
export async function readQuarantinedHead(objectPath: string, byteCount: number, storedSize: number): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage.from(QUARANTINE_BUCKET).createSignedUrl(objectPath, 60);
    const signedUrl = data?.signedUrl;
    if (!error && signedUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        // ssrf-ok: signedUrl is minted by our own Supabase client for a server-derived key
        const resp = await fetch(signedUrl, {
          method: 'GET',
          headers: { range: `bytes=0-${byteCount - 1}`, accept: '*/*' },
          signal: controller.signal,
        });
        if (resp.status === 206 || resp.status === 200) {
          return Buffer.from(await resp.arrayBuffer()).subarray(0, byteCount);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (e) {
    console.warn('[media-quarantine] range read failed', { objectPath, message: (e as Error)?.message });
  }
  if (storedSize > FULL_DOWNLOAD_FALLBACK_MAX_BYTES) return null;
  const full = await downloadQuarantined(objectPath);
  return full ? full.subarray(0, byteCount) : null;
}

async function downloadQuarantined(objectPath: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage.from(QUARANTINE_BUCKET).download(objectPath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Validate the STORED object. Every rejection of the bytes themselves sets
 * `discard: true`; storage read failures are transient and keep the object.
 */
export async function validateQuarantinedMedia(input: {
  objectPath: string;
  declaredMime: string;
  expectedCategory: MediaUploadCategory;
  companyId?: string | null;
  sharp?: SharpFactory;
}): Promise<QuarantineValidationResult> {
  const declared = normalizeMime(input.declaredMime);
  if (mimeCategory(declared) !== input.expectedCategory) {
    return fail(415, 'UPLOAD_MIME_MISMATCH', `Declared type "${declared}" is not a ${input.expectedCategory} type.`, true);
  }

  const info = await inspectQuarantinedObject(input.objectPath);
  if (info.ok === false) {
    if (info.missing) return fail(404, 'UPLOAD_OBJECT_NOT_FOUND', 'No uploaded object was found for this upload session.', false);
    return fail(503, 'UPLOAD_INSPECT_FAILED', 'The uploaded object could not be inspected. Please retry.', false);
  }
  if (info.size <= 0) return fail(400, 'UPLOAD_EMPTY', 'The uploaded file is empty.', true);
  if (info.size > MAX_QUARANTINE_BYTES) {
    return fail(413, 'UPLOAD_TOO_LARGE', `Uploaded file exceeds ${MAX_QUARANTINE_BYTES} bytes.`, true);
  }
  // The stored Content-Type is what the delivery bucket will serve after the move.
  if (info.contentType !== declared || !QUARANTINE_ALLOWED_MIME_TYPES.includes(info.contentType)) {
    return fail(415, 'UPLOAD_STORED_TYPE_MISMATCH', 'The stored content type is not the declared, allowed type.', true);
  }

  if (input.expectedCategory === 'image') {
    if (info.size > SAFE_IMAGE_DEFAULT_MAX_BYTES) {
      return fail(413, 'UPLOAD_TOO_LARGE', 'The image file is too large.', true);
    }
    const bytes = await downloadQuarantined(input.objectPath);
    if (!bytes) return fail(503, 'UPLOAD_INSPECT_FAILED', 'The uploaded object could not be read. Please retry.', false);
    const sniffed = sniffSafeImageMime(bytes);
    if (!sniffed || sniffed !== declared) {
      return fail(415, 'UPLOAD_MIME_SPOOF', 'The file content does not match the declared image type.', true);
    }
    try {
      // Re-encode: the delivered object is the decoder's output, not the upload.
      const normalized = await transformUntrustedImage(bytes, (image) => image.toFormat(sniffed.split('/')[1] as Parameters<typeof image.toFormat>[0]).toBuffer(), {
        ...(input.sharp ? { sharp: input.sharp } : {}),
      });
      return { ok: true, category: 'image', mime: sniffed, sizeBytes: normalized.length, normalized };
    } catch (error) {
      reportImageFailure(error, { callSite: 'activity.upload_finalize', companyId: input.companyId ?? null });
      if (isImageRejectedError(error)) return fail(415, 'UPLOAD_IMAGE_REJECTED', error.userMessage, true);
      return fail(503, 'UPLOAD_VALIDATION_ERROR', 'The image could not be validated. Please retry.', false);
    }
  }

  const head = await readQuarantinedHead(input.objectPath, HEAD_BYTES, info.size);
  if (!head) return fail(503, 'UPLOAD_INSPECT_FAILED', 'The uploaded object could not be read. Please retry.', false);
  if (!nonImageBytesMatchDeclaredType(head, declared)) {
    return fail(415, 'UPLOAD_MIME_SPOOF', `File bytes do not match the declared type "${declared}".`, true);
  }
  return { ok: true, category: input.expectedCategory, mime: declared, sizeBytes: info.size };
}

export type PromotionResult =
  | { ok: true; deliveryPath: string; alreadyPromoted: boolean }
  | { ok: false; reason: string };

async function deliveryObjectExists(objectPath: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(DELIVERY_BUCKET).info(objectPath);
    return !error && !!data;
  } catch {
    return false;
  }
}

/**
 * Move a VALIDATED object to the delivery bucket under the same key. Never
 * overwrites (`move` and `upload(upsert:false)` refuse an existing key). On
 * failure the quarantined object is left in place (private) for a retry.
 */
export async function promoteQuarantinedMedia(input: {
  objectPath: string;
  validated: QuarantineValidationSuccess;
}): Promise<PromotionResult> {
  const { objectPath, validated } = input;
  try {
    let errorMessage: string | null = null;
    if (validated.normalized) {
      const { error } = await supabase.storage.from(DELIVERY_BUCKET).upload(objectPath, validated.normalized, {
        contentType: validated.mime, upsert: false, cacheControl: '3600',
      });
      errorMessage = error?.message ?? null;
      if (!errorMessage) await discardQuarantinedObject(objectPath);
    } else {
      const { error } = await supabase.storage.from(QUARANTINE_BUCKET).move(objectPath, objectPath, {
        destinationBucket: DELIVERY_BUCKET,
      });
      errorMessage = error?.message ?? null;
    }
    if (!errorMessage) return { ok: true, deliveryPath: objectPath, alreadyPromoted: false };
    // A concurrent finalize of the same session already promoted it.
    if (/exist|duplicate|409/i.test(errorMessage) && await deliveryObjectExists(objectPath)) {
      await discardQuarantinedObject(objectPath);
      return { ok: true, deliveryPath: objectPath, alreadyPromoted: true };
    }
    return { ok: false, reason: errorMessage };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.message ?? 'promotion failed' };
  }
}

/** Best-effort delete of a quarantined object (never touches the delivery bucket). */
export async function discardQuarantinedObject(objectPath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(QUARANTINE_BUCKET).remove([objectPath]);
    if (error) console.warn('[media-quarantine] discard failed', { objectPath, error: error.message });
  } catch (error) {
    console.warn('[media-quarantine] discard threw', { objectPath, message: (error as Error)?.message });
  }
}

/** Best-effort delete of a delivery object (rollback after a failed DB write). */
export async function removeDeliveryObject(objectPath: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from(DELIVERY_BUCKET).remove([objectPath]);
    if (error) console.warn('[media-quarantine] delivery rollback failed', { objectPath, error: error.message });
  } catch (error) {
    console.warn('[media-quarantine] delivery rollback threw', { objectPath, message: (error as Error)?.message });
  }
}

/** Keys of sessions this row already finalized (bounded). A consumed key is never promoted again. */
export const CONSUMED_SESSIONS_CAP = 50;
export function readConsumedObjectPaths(content: Record<string, unknown>): string[] {
  const raw = content.upload_consumed_object_paths;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}
export function appendConsumedObjectPath(content: Record<string, unknown>, objectPath: string): string[] {
  const prior = readConsumedObjectPaths(content).filter((p) => p !== objectPath);
  return [...prior, objectPath].slice(-CONSUMED_SESSIONS_CAP);
}
