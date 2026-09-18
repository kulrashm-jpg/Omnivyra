/**
 * X (Twitter) media upload.
 *
 * The v2 tweet-create endpoint only accepts already-uploaded `media_ids`, so
 * images/videos must be uploaded first via the media/upload endpoint. This uses
 * the same OAuth 2.0 user-context Bearer token as the tweet-create call (the
 * connected app needs the `media.write` scope for these calls to succeed).
 *
 * Flow:
 *  - images  → single-shot upload (base64 `media_data`)
 *  - video / animated GIF → chunked INIT → APPEND(chunks) → FINALIZE → poll STATUS
 *
 * Everything is sent as application/x-www-form-urlencoded with base64 payloads,
 * so there is no multipart/form-data dependency.
 *
 * CALLER CONTRACT (P3-A): this is NOT best-effort any more. Returning zero
 * media_ids, or throwing, both make xAdapter REFUSE to publish — a post that
 * asked for media is never shipped as text. Nothing here may therefore invent
 * or pass through a media_id it did not actually receive from X.
 *
 * X composition rules enforced here: up to 4 images, OR exactly 1 video, OR 1
 * GIF per tweet (images and video cannot be mixed).
 */
import axios from 'axios';

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const MAX_IMAGES = 4;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — under X's 5MB APPEND cap, with headroom for base64
const MAX_STATUS_POLLS = 20;

interface XToken {
  access_token: string;
}

type MediaCategory = 'tweet_image' | 'tweet_video' | 'tweet_gif';

interface MediaMeta {
  mimeType: string;
  category: MediaCategory;
  chunked: boolean; // video + gif go through the chunked flow
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
}

function isGifUrl(url: string): boolean {
  return /\.gif(\?|#|$)/i.test(url);
}

function resolveMediaMeta(url: string, contentType: string): MediaMeta {
  const ct = (contentType || '').toLowerCase();
  if (isGifUrl(url) || ct === 'image/gif') {
    return { mimeType: 'image/gif', category: 'tweet_gif', chunked: true };
  }
  if (isVideoUrl(url) || ct.startsWith('video/')) {
    return { mimeType: ct.startsWith('video/') ? ct : 'video/mp4', category: 'tweet_video', chunked: true };
  }
  const mimeType = ct.startsWith('image/') ? ct : 'image/jpeg';
  return { mimeType, category: 'tweet_image', chunked: false };
}

async function fetchBytes(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  // HARDEN-005: media URL is user-controlled (scheduled_posts.media_urls) —
  // block internal targets before downloading. Keeps the axios download
  // mechanics/size caps unchanged for legitimate public media.
  const { assertUrlSafe } = await import('../../lib/security/safeFetch');
  await assertUrlSafe(url);
  // ssrf-ok: url pre-validated by assertUrlSafe above (user media)
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 512 * 1024 * 1024,
    maxBodyLength: 512 * 1024 * 1024,
  });
  return {
    buffer: Buffer.from(res.data),
    contentType: String(res.headers['content-type'] || '').split(';')[0].trim(),
  };
}

async function postForm(token: XToken, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  // ssrf-ok: UPLOAD_URL is a fixed X media-upload host constant
  const res = await axios.post(UPLOAD_URL, body, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 60000,
  });
  return res.data;
}

/**
 * Read X's `media_id_string` out of an upload response, or throw.
 *
 * `String(data.media_id_string)` was used directly at both call sites. When X
 * answers 200 with a body that has no `media_id_string` — a throttled or
 * partially-degraded upload response — that produces the literal string
 * "undefined", which is truthy and non-empty. The consequences were real:
 *
 *   - single-shot: "undefined" was returned as a media_id, so the caller's
 *     `mediaIds.length > 0` honesty check passed and the tweet-create call was
 *     made with media_ids: ["undefined"]. X rejects that with a 400, which the
 *     adapter classifies as TWITTER_VALIDATION_ERROR, retryable: false — so a
 *     transient upload glitch permanently killed the post, and the reported
 *     cause was "invalid tweet content" rather than a media upload failure.
 *   - chunked: "undefined" was then sent as the media_id for every APPEND and
 *     FINALIZE, uploading the whole file against a nonexistent id.
 *
 * Failing here instead routes both cases into the caller's existing retryable
 * MEDIA_WOULD_BE_STRIPPED failure, which is the truthful classification.
 */
function requireMediaId(data: any, step: string): string {
  const id = data?.media_id_string;
  if (typeof id !== 'string' || id.trim().length === 0) {
    // `media_id` (the numeric form) is lossy in JS and X documents the string
    // form as the one to use, so an absent string id is a hard failure.
    throw new Error(`X media upload (${step}) returned no media_id_string`);
  }
  return id;
}

async function uploadSimple(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  const data = await postForm(token, {
    media_data: buffer.toString('base64'),
    media_category: meta.category,
  });
  return requireMediaId(data, 'single-shot');
}

async function uploadChunked(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  // INIT
  const init = await postForm(token, {
    command: 'INIT',
    total_bytes: String(buffer.length),
    media_type: meta.mimeType,
    media_category: meta.category,
  });
  const mediaId = requireMediaId(init, 'INIT');

  // APPEND — one base64 segment per chunk.
  let segment = 0;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
    await postForm(token, {
      command: 'APPEND',
      media_id: mediaId,
      segment_index: String(segment),
      media_data: chunk.toString('base64'),
    });
    segment++;
  }

  // FINALIZE — may kick off async transcoding (processing_info).
  const finalize = await postForm(token, { command: 'FINALIZE', media_id: mediaId });

  // Poll STATUS until the transcode succeeds (or fails/times out).
  let info = finalize.processing_info;
  let polls = 0;
  while (info && (info.state === 'pending' || info.state === 'in_progress') && polls < MAX_STATUS_POLLS) {
    const waitSecs = Math.max(1, Number(info.check_after_secs) || 2);
    await new Promise((resolve) => setTimeout(resolve, waitSecs * 1000));
    const status = await axios
      .get(UPLOAD_URL, {
        params: { command: 'STATUS', media_id: mediaId },
        headers: { Authorization: `Bearer ${token.access_token}` },
        timeout: 30000,
      })
      .then((r) => r.data);
    info = status.processing_info;
    polls++;
  }

  if (info && info.state === 'failed') {
    throw new Error(`X media processing failed: ${info.error?.message || 'unknown error'}`);
  }
  if (info && info.state !== 'succeeded') {
    throw new Error('X media processing timed out');
  }
  return mediaId;
}

async function uploadOne(url: string, token: XToken): Promise<string> {
  const { buffer, contentType } = await fetchBytes(url);
  const meta = resolveMediaMeta(url, contentType);
  return meta.chunked ? uploadChunked(buffer, meta, token) : uploadSimple(buffer, meta, token);
}

/**
 * Upload the post's media to X and return the resulting media_ids in order.
 * Enforces X's composition rules (≤4 images, OR 1 video, OR 1 GIF). Image
 * uploads are individually best-effort (a single failure is skipped, not fatal);
 * a video/GIF failure rejects so the caller can decide. Returns [] for no media.
 *
 * Every id in the returned array is one X actually issued — see requireMediaId.
 */
export async function uploadXMedia(mediaUrls: string[] | undefined, token: XToken): Promise<string[]> {
  const urls = (mediaUrls || []).filter((u) => typeof u === 'string' && u.trim());
  if (urls.length === 0) return [];

  // A video or GIF is a single-media tweet; it wins and images are ignored.
  const firstMeta = resolveMediaMeta(urls[0], '');
  if (firstMeta.chunked) {
    return [await uploadOne(urls[0], token)];
  }

  // Otherwise up to 4 images. Skip anything that turns out to be a video/GIF
  // (X can't mix images with video) and tolerate individual image failures.
  const ids: string[] = [];
  for (const url of urls.slice(0, MAX_IMAGES)) {
    if (resolveMediaMeta(url, '').chunked) continue;
    try {
      ids.push(await uploadOne(url, token));
    } catch (error) {
      console.warn('[x-media] image upload failed (skipping):', (error as Error)?.message);
    }
  }
  return ids;
}
