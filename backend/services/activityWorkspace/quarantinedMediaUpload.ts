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
 *      authenticated writes to either bucket (migration 20270111000004).
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
import { createHash } from 'node:crypto';
import { supabase } from '../../db/supabaseClient';
import { unguessableObjectStem } from '../../../lib/security/objectNames';
import { readBodyBounded } from '../../../lib/security/boundedBodyRead';
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

/** `<subdir>/<ext>` suffix that mintQuarantineObjectPath produces for `mime`. */
function mintedSuffixFor(mime: string): string {
  const m = normalizeMime(mime);
  return `${mimeCategory(m) ?? 'misc'}/${m.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'bin'}`;
}

/**
 * F-H3-2 - the allowlisted type a server-minted key was AUTHORIZED for, read
 * back from the `<subdir>/<stem>.<ext>` the key was minted with (authorize only
 * mints for QUARANTINE_ALLOWED_MIME_TYPES). null = not a key minted for an
 * allowed type. Finalize must refuse any declared type other than this one, so
 * the stored content type always agrees with the key's extension.
 */
export function authorizedMimeForObjectPath(objectPath: string): string | null {
  const parts = String(objectPath ?? '').split('/');
  if (parts.length < 2) return null;
  const file = parts[parts.length - 1];
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  const suffix = `${parts[parts.length - 2]}/${file.slice(dot + 1)}`.toLowerCase();
  return QUARANTINE_ALLOWED_MIME_TYPES.find((m) => mintedSuffixFor(m) === suffix) ?? null;
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
  /**
   * J1 H3-1 - fingerprint of what THIS validation approved, used to decide
   * whether an object already sitting at the delivery key is the validated one.
   *   images:     sha256 of the full re-encoded bytes (`normalized`)
   *   non-images: sha256 of the first HEAD_BYTES stored bytes that passed the
   *               signature check (multi-GB videos are never fully read here)
   */
  sha256?: string;
  headSha256?: string;
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
  const viaRange = await readHeadViaSignedRange(QUARANTINE_BUCKET, objectPath, byteCount);
  if (viaRange) return viaRange;
  if (storedSize > FULL_DOWNLOAD_FALLBACK_MAX_BYTES) return null;
  const full = await downloadQuarantined(objectPath);
  return full ? full.subarray(0, byteCount) : null;
}

/** Range read of the first `byteCount` bytes of `bucket/objectPath` through a 60 s signed URL; null on failure. */
async function readHeadViaSignedRange(bucket: string, objectPath: string, byteCount: number): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 60);
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
          // Bounded: a server that ignores Range (200 + full body) is cut off at byteCount.
          const head = await readBodyBounded(resp as never, byteCount, 'truncate');
          return head.ok ? head.bytes : null;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (e) {
    console.warn('[media-quarantine] range read failed', { bucket, objectPath, message: (e as Error)?.message });
  }
  return null;
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
      return { ok: true, category: 'image', mime: sniffed, sizeBytes: normalized.length, normalized, sha256: sha256Hex(normalized) };
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
  return { ok: true, category: input.expectedCategory, mime: declared, sizeBytes: info.size, headSha256: sha256Hex(head) };
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type PromotionResult =
  | { ok: true; deliveryPath: string; alreadyPromoted: boolean }
  /**
   * `conflict: true` = an object already sits at the delivery key and it is NOT
   * the object this request validated (J1 H3-1). Never record or schedule it.
   * `unproven: true` = a non-image object sits at the delivery key and this
   * request cannot prove it came from a server move of the validated object
   * (F-H3-1). Never adopt it on its own evidence; the caller may accept it only
   * on a committed row that records the key as promoted.
   */
  | { ok: false; reason: string; conflict?: boolean; unproven?: boolean };

type DeliveryInfo = { exists: true; size: number; contentType: string } | { exists: false } | { exists: null; message: string };

async function inspectDeliveryObject(objectPath: string): Promise<DeliveryInfo> {
  try {
    const { data, error } = await supabase.storage.from(DELIVERY_BUCKET).info(objectPath);
    if (error || !data) {
      const message = error?.message ?? 'no metadata';
      return looksMissing(message) ? { exists: false } : { exists: null, message };
    }
    const d = data as { size?: unknown; contentType?: unknown; metadata?: Record<string, unknown> | null };
    const size = Number(d.size ?? d.metadata?.size ?? NaN);
    const contentType = normalizeMime(d.contentType ?? d.metadata?.mimetype ?? '');
    if (!Number.isFinite(size)) return { exists: null, message: 'delivery size unavailable' };
    return { exists: true, size, contentType };
  } catch (error) {
    return { exists: null, message: (error as Error)?.message ?? 'info failed' };
  }
}

async function quarantineObjectStillPresent(objectPath: string): Promise<boolean | null> {
  const info = await inspectQuarantinedObject(objectPath);
  if (info.ok === false) return info.missing ? false : null;
  return true;
}

export type DeliveryMatch =
  | { verdict: 'match' }
  | { verdict: 'absent' }
  | { verdict: 'unproven'; reason: string }
  | { verdict: 'mismatch'; reason: string }
  | { verdict: 'unverifiable'; reason: string };

/**
 * J1 H3-1 - is the object ALREADY at the delivery key the object this request
 * validated? Existence alone proves nothing: until migration 20270111000004 is
 * applied (and if it is ever rolled back while this code stays), a client could
 * write arbitrary bytes straight into `media-uploads/<key>` before finalize.
 *
 *   all objects: stored size and stored content type equal the validated ones.
 *   images:      the delivered bytes are downloaded (bounded: the size equality
 *                above pins them to the re-encoded length) and their sha256 must
 *                equal the sha256 of THIS request's re-encoded output.
 *   non-images:  promotion is a server-side MOVE, which consumes the quarantine
 *                source. A delivery object that coexists with this session's
 *                quarantine source was therefore not produced by moving it, so
 *                it is a mismatch. The first HEAD_BYTES must also hash to what
 *                passed the signature check.
 *                F-H3-1 / J3-1: even then it is only `unproven`, never `match`.
 *                A consumed source + equal size/type/head does not prove a
 *                move: the source can disappear for other reasons (a concurrent
 *                discard, an operator) while a planted object with the same
 *                head and an arbitrary tail sits at the key. A full-content
 *                hash of a multi-GB video would need a full read, so this
 *                function never adopts a non-image; the finalize route accepts
 *                one only when a committed row records the key as promoted.
 */
export async function verifyExistingDeliveryObject(objectPath: string, validated: QuarantineValidationSuccess): Promise<DeliveryMatch> {
  const info = await inspectDeliveryObject(objectPath);
  if (info.exists === false) return { verdict: 'absent' };
  // strict:false does not narrow this union on its null literal; only the
  // unverifiable branch carries `message`, so narrow on that property instead.
  if ('message' in info) return { verdict: 'unverifiable', reason: `delivery metadata unavailable: ${info.message}` };
  if (info.size !== validated.sizeBytes) return { verdict: 'mismatch', reason: 'size_differs' };
  if (info.contentType !== normalizeMime(validated.mime)) return { verdict: 'mismatch', reason: 'content_type_differs' };

  if (validated.normalized) {
    const expected = validated.sha256 ?? sha256Hex(validated.normalized);
    let bytes: Buffer | null = null;
    try {
      const { data, error } = await supabase.storage.from(DELIVERY_BUCKET).download(objectPath);
      if (!error && data) bytes = Buffer.from(await data.arrayBuffer());
    } catch {
      bytes = null;
    }
    if (!bytes) return { verdict: 'unverifiable', reason: 'delivery bytes could not be read' };
    return sha256Hex(bytes) === expected ? { verdict: 'match' } : { verdict: 'mismatch', reason: 'sha256_differs' };
  }

  const sourcePresent = await quarantineObjectStillPresent(objectPath);
  if (sourcePresent === null) return { verdict: 'unverifiable', reason: 'quarantine state unavailable' };
  if (sourcePresent) return { verdict: 'mismatch', reason: 'quarantine_source_not_consumed' };
  if (!validated.headSha256) return { verdict: 'unverifiable', reason: 'no validated fingerprint' };
  const head = await readHeadViaSignedRange(DELIVERY_BUCKET, objectPath, HEAD_BYTES);
  if (!head) return { verdict: 'unverifiable', reason: 'delivery head could not be read' };
  return sha256Hex(head) === validated.headSha256
    ? { verdict: 'unproven', reason: 'non_image_delivery_object_not_provably_moved' }
    : { verdict: 'mismatch', reason: 'head_sha256_differs' };
}

/**
 * Move a VALIDATED object to the delivery bucket under the same key. Never
 * overwrites (`move` and `upload(upsert:false)` refuse an existing key). On
 * failure the quarantined object is left in place (private) for a retry.
 */
export async function promoteQuarantinedMedia(input: {
  objectPath: string;
  validated: QuarantineValidationSuccess;
  companyId?: string | null;
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
    // The write failed. An object already at the key MAY be a concurrent
    // finalize of the same session (the losing move of a race reports the
    // SOURCE as missing, not a conflict) - but only if it is the object THIS
    // request validated (J1 H3-1). Existence alone is not proof.
    const match = await verifyExistingDeliveryObject(objectPath, validated);
    if (match.verdict === 'match') {
      await discardQuarantinedObject(objectPath);
      return { ok: true, deliveryPath: objectPath, alreadyPromoted: true };
    }
    if (match.verdict === 'mismatch') {
      // Security event. The foreign delivery object is NOT deleted here: this
      // request did not write it, and a false mismatch (e.g. a re-encode that is
      // not byte-identical across processes) must never delete an object that a
      // committed row may reference. It is left for the operator and the
      // media-uploads revalidation report. The quarantined copy stays private.
      console.error('[security][media-h3] object at the delivery key is not the validated object; refusing promotion', {
        event: 'media_h3_delivery_conflict',
        objectPath,
        companyId: input.companyId ?? null,
        reason: match.reason,
        validatedSize: validated.sizeBytes,
        validatedMime: validated.mime,
      });
      return { ok: false, reason: `delivery object conflict: ${match.reason}`, conflict: true };
    }
    if (match.verdict === 'unproven') {
      // F-H3-1: not adopted, not deleted (it may be a concurrent winner's
      // object that a committed row references). Nothing to discard: the
      // quarantine source is already gone.
      return { ok: false, reason: `${errorMessage}; ${match.reason}`, unproven: true };
    }
    if (match.verdict === 'unverifiable') return { ok: false, reason: `${errorMessage}; ${match.reason}` };
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
