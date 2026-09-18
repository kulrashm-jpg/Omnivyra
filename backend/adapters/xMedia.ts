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
 * GIF per tweet (images and video cannot be mixed). A media set that breaks
 * those rules is REFUSED, never quietly trimmed down to something that fits.
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
 * X composition rules, evaluated against the REQUESTED media set before a
 * single byte is uploaded.
 *
 * X publishes up to 4 images, OR exactly one video, OR exactly one GIF — never
 * a mixture, never more. Those rules used to be enforced by silently discarding
 * whatever did not fit: a video+image post uploaded only the image (the
 * `resolveMediaMeta(url).chunked` → `continue` branch), and a six-image post
 * uploaded the first four (`urls.slice(0, MAX_IMAGES)`). Both then returned a
 * non-empty id list, so xAdapter's `mediaIds.length > 0` honesty check passed
 * and the post shipped carrying materially different media than was approved.
 *
 * Reporting the violation instead lets xAdapter refuse with the existing
 * MEDIA_WOULD_BE_STRIPPED code, NOT retryable — retrying cannot make X accept
 * a combination it does not support.
 */
export type XMediaPlan =
  | { ok: true; kind: 'none'; urls: string[] }
  | { ok: true; kind: 'single'; urls: string[] }
  | { ok: true; kind: 'images'; urls: string[] }
  | { ok: false; reason: string };

export function planXMediaComposition(mediaUrls: string[] | undefined): XMediaPlan {
  const urls = (mediaUrls || []).filter((u) => typeof u === 'string' && u.trim());
  if (urls.length === 0) return { ok: true, kind: 'none', urls: [] };

  const metas = urls.map((u) => resolveMediaMeta(u, ''));
  const chunkedCount = metas.filter((m) => m.chunked).length;

  if (chunkedCount > 0) {
    if (urls.length > 1) {
      return {
        ok: false,
        reason:
          `X publishes up to ${MAX_IMAGES} images, OR exactly one video, OR exactly one GIF — it cannot mix ` +
          `them and cannot carry more than one video/GIF. This post has ${urls.length} media items, ` +
          `${chunkedCount} of which are video/GIF.`,
      };
    }
    return { ok: true, kind: 'single', urls };
  }

  if (urls.length > MAX_IMAGES) {
    return {
      ok: false,
      reason: `X allows at most ${MAX_IMAGES} images per post, and this post has ${urls.length}.`,
    };
  }
  return { ok: true, kind: 'images', urls };
}

/**
 * Upload the post's media to X and return the resulting media_ids in order.
 *
 * ALL-OR-NOTHING (P3-A). Every requested item is uploaded, or this rejects.
 * Image uploads used to be "individually best-effort" — a failed upload was
 * caught, logged with console.warn and skipped — which contradicted this
 * module's own CALLER CONTRACT above and the doctrine every other adapter in
 * this repo now follows. A three-image post whose second upload failed returned
 * two ids, xAdapter saw `mediaIds.length > 0`, and the tweet went out with two
 * images and was recorded as a success. Nothing downstream could tell that a
 * third of the approved creative had been dropped.
 *
 * A per-item upload failure is usually transient (missing scope, rate limit,
 * network), so it propagates as a throw and xAdapter maps it to the RETRYABLE
 * MEDIA_WOULD_BE_STRIPPED failure. A composition violation is not transient and
 * is caught by planXMediaComposition before any upload runs.
 *
 * Every id in the returned array is one X actually issued — see requireMediaId.
 */
export async function uploadXMedia(mediaUrls: string[] | undefined, token: XToken): Promise<string[]> {
  const plan = planXMediaComposition(mediaUrls);
  if (plan.ok === false) {
    throw new Error(plan.reason);
  }
  if (plan.kind === 'none') return [];

  // A video or GIF is a single-media tweet.
  if (plan.kind === 'single') {
    return [await uploadOne(plan.urls[0], token)];
  }

  // Up to 4 images. Deliberately no try/catch: a failure must reach the caller
  // so the post fails truthfully instead of publishing a partial media set.
  const ids: string[] = [];
  for (const url of plan.urls) {
    ids.push(await uploadOne(url, token));
  }
  return ids;
}
