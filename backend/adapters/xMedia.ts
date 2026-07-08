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
 * so there is no multipart/form-data dependency. Best-effort by contract: the
 * caller falls back to a text-only tweet if this yields no media_ids.
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
  const res = await axios.post(UPLOAD_URL, body, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 60000,
  });
  return res.data;
}

async function uploadSimple(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  const data = await postForm(token, {
    media_data: buffer.toString('base64'),
    media_category: meta.category,
  });
  return String(data.media_id_string);
}

async function uploadChunked(buffer: Buffer, meta: MediaMeta, token: XToken): Promise<string> {
  // INIT
  const init = await postForm(token, {
    command: 'INIT',
    total_bytes: String(buffer.length),
    media_type: meta.mimeType,
    media_category: meta.category,
  });
  const mediaId = String(init.media_id_string);

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
