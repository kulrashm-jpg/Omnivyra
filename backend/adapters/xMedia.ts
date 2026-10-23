/**
 * X (Twitter) media upload — X API **v2**.
 *
 * MIGRATION (API-B): this module previously uploaded through the v1.1 endpoint
 * `https://upload.twitter.com/1.1/media/upload.json` using the command-style
 * protocol (`command=INIT|APPEND|FINALIZE|STATUS`, base64 `media_data` in an
 * x-www-form-urlencoded body). X **sunset the v1.1 media upload endpoints on
 * 2025-06-09**, so every call that path made returned a provider error. The
 * supported contract is the v2 media surface on `api.x.com`:
 *
 *   simple  (images / GIFs)  POST /2/media/upload
 *                            multipart/form-data: `media`, `media_category`
 *   chunked (video, large)   POST /2/media/upload/initialize
 *                            application/json: `media_type`, `total_bytes`, `media_category`
 *                            POST /2/media/upload/{id}/append
 *                            multipart/form-data: `segment_index`, `media`
 *                            POST /2/media/upload/{id}/finalize      (no body)
 *                            GET  /2/media/upload?command=STATUS&media_id={id}
 *
 * The v2 chunked quickstart is explicit that the old protocol must NOT be
 * reused against the new host: "Do not send `command=INIT`, `command=APPEND`,
 * or `command=FINALIZE` to `POST /2/media/upload`. Those command-style
 * parameters were the previous upload protocol."
 *
 * Sources (contract verified 2026-09-16):
 *  - https://docs.x.com/x-api/media/introduction
 *  - https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *  - https://docs.x.com/x-api/media/upload-media               (POST /2/media/upload)
 *  - https://docs.x.com/x-api/media/media-upload-initialize    (POST /2/media/upload/initialize)
 *  - https://docs.x.com/x-api/media/append-media-upload        (POST /2/media/upload/{id}/append)
 *  - https://docs.x.com/x-api/media/finalize-media-upload      (POST /2/media/upload/{id}/finalize)
 *  - https://docs.x.com/x-api/media/get-media-upload-status    (GET  /2/media/upload?command=STATUS)
 *
 * RESPONSE SHAPE CHANGED: v1.1 returned a top-level `media_id_string`; every
 * v2 media endpoint wraps its payload as `{ data: { id, media_key,
 * processing_info, … } }`. `data.id` is the media id handed to POST /2/tweets
 * as `media.media_ids`.
 *
 * AUTH IS UNCHANGED: the same OAuth 2.0 user-context Bearer token used by the
 * tweet-create call. v2 media requires the `media.write` scope (the reference
 * pages list `OAuth2UserToken` + `media.write` on every endpoint above).
 *
 * X composition rules enforced here: up to 4 images, OR exactly 1 video, OR 1
 * GIF per Post — "A Post may include up to 4 photos, 1 animated GIF, or 1
 * video" (media introduction). Images and video cannot be mixed. A media set
 * that breaks those rules is REFUSED, never quietly trimmed down to something
 * that fits.
 *
 * CALLER CONTRACT (P3-A): this is NOT best-effort. Returning zero media_ids, or
 * throwing, both make xAdapter REFUSE to publish — a post that asked for media
 * is never shipped as text. Nothing here may therefore invent or pass through a
 * media_id it did not actually receive from X (see extractMediaId).
 */
import axios from 'axios';

/** v2 media surface. All four operations hang off this fixed host + path. */
const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';

const MAX_IMAGES = 4;
/**
 * APPEND segment cap: "Keep each segment at or below 5 MB"
 * (docs.x.com/x-api/media/quickstart/media-upload-chunked). v2 APPEND carries
 * RAW bytes in a multipart part (not base64), so 4 MB is a true 4 MB with
 * headroom under the cap.
 */
const CHUNK_SIZE = 4 * 1024 * 1024;
/** `segment_index` is documented as an integer 0–999 (append reference). */
const MAX_SEGMENTS = 1000;
const MAX_STATUS_POLLS = 20;

/**
 * Size ceilings from the media introduction: "Images: 5 MB max (JPG, PNG, GIF,
 * WEBP)" / "Animated GIFs: 15 MB max". Checked before the request so an
 * oversize asset produces an actionable message instead of an opaque 413.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_GIF_BYTES = 15 * 1024 * 1024;

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

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Multipart parts need a filename; X infers nothing from it but rejects a bare value. */
function filenameFor(meta: MediaMeta, segment?: number): string {
  const ext = EXTENSION_BY_MIME[meta.mimeType] || (meta.category === 'tweet_video' ? 'mp4' : 'bin');
  return segment === undefined ? `media.${ext}` : `chunk${segment}.${ext}`;
}

function mediaPart(bytes: Buffer, meta: MediaMeta): Blob {
  return new Blob([new Uint8Array(bytes)], { type: meta.mimeType });
}

/** Enforce the documented per-category ceiling before spending an upload. */
function assertWithinSizeLimit(byteLength: number, meta: MediaMeta): void {
  if (meta.category === 'tweet_image' && byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `X image exceeds the 5MB v2 upload limit (${byteLength} bytes); X will reject it with 413.`,
    );
  }
  if (meta.category === 'tweet_gif' && byteLength > MAX_GIF_BYTES) {
    throw new Error(
      `X animated GIF exceeds the 15MB v2 upload limit (${byteLength} bytes); X will reject it with 413.`,
    );
  }
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

function authHeader(token: XToken): Record<string, string> {
  return { Authorization: `Bearer ${token.access_token}` };
}

/** POST an application/json body to a fixed v2 media endpoint. */
async function postJson(path: string, token: XToken, body: Record<string, unknown>): Promise<any> {
  // ssrf-ok: MEDIA_UPLOAD_URL is a fixed api.x.com media-upload host constant
  const res = await axios.post(`${MEDIA_UPLOAD_URL}${path}`, body, {
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    timeout: 60000,
  });
  return res.data;
}

/**
 * POST a multipart/form-data body. The Content-Type header is deliberately NOT
 * set — axios derives it from the FormData so the multipart boundary matches.
 */
async function postMultipart(path: string, token: XToken, form: FormData): Promise<any> {
  // ssrf-ok: MEDIA_UPLOAD_URL is a fixed api.x.com media-upload host constant
  const res = await axios.post(`${MEDIA_UPLOAD_URL}${path}`, form, {
    headers: authHeader(token),
    timeout: 60000,
  });
  return res.data;
}

/** POST with no body (FINALIZE takes none). */
async function postEmpty(path: string, token: XToken): Promise<any> {
  // ssrf-ok: MEDIA_UPLOAD_URL is a fixed api.x.com media-upload host constant
  const res = await axios.post(`${MEDIA_UPLOAD_URL}${path}`, undefined, {
    headers: authHeader(token),
    timeout: 60000,
  });
  return res.data;
}

/**
 * Every v2 media response nests its payload under `data`; the id is `data.id`.
 *
 * A 200 whose body carries no id (a throttled or partially-degraded response)
 * must never become the literal string "undefined": that would pass xAdapter's
 * `mediaIds.length > 0` honesty check and either create a tweet with
 * media_ids: ["undefined"] (a non-retryable 400) or APPEND a whole file against
 * a nonexistent id. Throwing routes it into the caller's retryable
 * MEDIA_WOULD_BE_STRIPPED failure instead.
 */
function extractMediaId(payload: any, step: string): string {
  const id = payload?.data?.id;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`X media ${step} returned no media id`);
  }
  return id;
}

function processingInfo(payload: any): any {
  return payload?.data?.processing_info;
}

/**
 * Poll GET /2/media/upload?command=STATUS until the asset finishes transcoding.
 * `processing_info.state` moves pending → in_progress → succeeded | failed
 * (status reference). A response without `processing_info` is already usable.
 */
async function awaitProcessing(initialInfo: any, mediaId: string, token: XToken): Promise<void> {
  let info = initialInfo;
  let polls = 0;
  while (info && (info.state === 'pending' || info.state === 'in_progress') && polls < MAX_STATUS_POLLS) {
    const waitSecs = Math.max(1, Number(info.check_after_secs) || 2);
    await new Promise((resolve) => setTimeout(resolve, waitSecs * 1000));
    // ssrf-ok: MEDIA_UPLOAD_URL is a fixed api.x.com media-upload host constant
    const status = await axios
      .get(MEDIA_UPLOAD_URL, {
        params: { command: 'STATUS', media_id: mediaId },
        headers: authHeader(token),
        timeout: 30000,
      })
      .then((r) => r.data);
    info = processingInfo(status);
    polls++;
  }

  if (info && info.state === 'failed') {
    throw new Error(`X media processing failed: ${info.error?.message || 'unknown error'}`);
  }
  if (info && info.state !== 'succeeded') {
    throw new Error('X media processing timed out');
  }
}

/** POST /2/media/upload — one multipart request, images (and small GIFs). */
async function uploadSimple(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  assertWithinSizeLimit(buffer.length, meta);
  const form = new FormData();
  form.append('media', mediaPart(buffer, meta), filenameFor(meta));
  form.append('media_category', meta.category);

  const data = await postMultipart('', token, form);
  const mediaId = extractMediaId(data, 'upload');
  // Simple uploads can still report processing (the response schema carries
  // `data.processing_info`), so honour it rather than assuming it is absent.
  await awaitProcessing(processingInfo(data), mediaId, token);
  return mediaId;
}

/** initialize → append(chunks) → finalize → STATUS poll. Video and GIF. */
async function uploadChunked(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  assertWithinSizeLimit(buffer.length, meta);

  const segments = Math.max(1, Math.ceil(buffer.length / CHUNK_SIZE));
  if (segments > MAX_SEGMENTS) {
    throw new Error(
      `X media is too large to chunk: ${segments} segments exceeds the documented segment_index maximum of ${MAX_SEGMENTS}.`,
    );
  }

  // INITIALIZE — JSON body, not the v1.1 `command=INIT` form field.
  const init = await postJson('/initialize', token, {
    media_type: meta.mimeType,
    total_bytes: buffer.length,
    media_category: meta.category,
  });
  const mediaId = extractMediaId(init, 'initialize');
  const idPath = encodeURIComponent(mediaId);

  // APPEND — one multipart request per raw-byte segment.
  for (let segment = 0; segment < segments; segment++) {
    const offset = segment * CHUNK_SIZE;
    const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
    const form = new FormData();
    form.append('segment_index', String(segment));
    form.append('media', mediaPart(chunk, meta), filenameFor(meta, segment));
    await postMultipart(`/${idPath}/append`, token, form);
  }

  // FINALIZE — no body; may kick off async transcoding (processing_info).
  const finalize = await postEmpty(`/${idPath}/finalize`, token);
  await awaitProcessing(processingInfo(finalize), mediaId, token);
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
 * Every id in the returned array is one X actually issued — see extractMediaId.
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
