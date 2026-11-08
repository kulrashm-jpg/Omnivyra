/**
 * Creator media uploads are OFF unless explicitly enabled (PC5-4, 2026-11-08).
 *
 * The delivery bucket (`media-uploads`) and the MEDIA-H3 storage policies must
 * be provisioned deliberately before any user bytes are accepted. Until then
 * every creator upload route refuses with a non-retryable 503, so the UI shows
 * "unavailable" instead of a "please retry" failure that can never succeed,
 * and no route creates a bucket on its own.
 *
 * Enable with CREATOR_MEDIA_UPLOADS_ENABLED=true (server-only; never a
 * NEXT_PUBLIC_ variable) only after the bucket and policies exist.
 */

import type { NextApiResponse } from 'next';

export const CREATOR_MEDIA_UPLOADS_UNAVAILABLE = 'UPLOADS_UNAVAILABLE';
export const CREATOR_MEDIA_UPLOAD_BUCKET_NOT_PROVISIONED = 'UPLOAD_BUCKET_NOT_PROVISIONED';

const UNAVAILABLE_MESSAGE = 'Media file uploads are currently unavailable. Nothing was uploaded.';

export function creatorMediaUploadsEnabled(): boolean {
  return process.env.CREATOR_MEDIA_UPLOADS_ENABLED === 'true';
}

/** Sends the 503 and returns true when uploads are disabled; the caller must return. */
export function refuseIfCreatorMediaUploadsDisabled(res: NextApiResponse): boolean {
  if (creatorMediaUploadsEnabled()) return false;
  res.status(503).json({ error: UNAVAILABLE_MESSAGE, code: CREATOR_MEDIA_UPLOADS_UNAVAILABLE, retryable: false });
  return true;
}

export function refuseUploadBucketNotProvisioned(res: NextApiResponse): void {
  res.status(503).json({ error: UNAVAILABLE_MESSAGE, code: CREATOR_MEDIA_UPLOAD_BUCKET_NOT_PROVISIONED, retryable: false });
}
