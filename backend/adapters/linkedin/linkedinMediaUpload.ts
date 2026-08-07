/**
 * LinkedIn media upload pipeline.
 *
 * Backs the LinkedIn adapter's media branch (image / single-part video).
 * Behind `LINKEDIN_MEDIA_UPLOAD_ENABLED` env (default off in the adapter) so
 * activation is operator-driven after a non-prod LinkedIn account validation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * API SHAPES (LinkedIn versioned REST API)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   IMAGE init:
 *     POST  /rest/images?action=initializeUpload
 *     headers: Authorization, LinkedIn-Version, X-Restli-Protocol-Version: 2.0.0
 *     body:    { initializeUploadRequest: { owner: '<author-urn>' } }
 *     returns: { value: { uploadUrl: string, image: '<urn:li:image:...>' } }
 *
 *   IMAGE upload:
 *     PUT   <uploadUrl>
 *     headers: Authorization (Bearer)
 *     body:    raw image binary
 *
 *   VIDEO init (single-part, small file):
 *     POST  /rest/videos?action=initializeUpload
 *     body:    { initializeUploadRequest: { owner, fileSizeBytes, uploadCaptions: false, uploadThumbnail: false } }
 *     returns: { value: { video: '<urn:li:video:...>', uploadInstructions: [{ uploadUrl, firstByte, lastByte }] } }
 *
 *   VIDEO upload (single-part):
 *     PUT   <uploadUrl>
 *     headers: Authorization (Bearer)
 *     body:    raw video binary
 *
 *   VIDEO finalize (single-part):
 *     POST  /rest/videos?action=finalizeUpload
 *     body:    { finalizeUploadRequest: { video: '<urn>', uploadToken: '', uploadedPartIds: ['<etag>'] } }
 *
 *   VIDEO status poll:
 *     GET   /rest/videos/<urn>
 *     returns: { status: 'PROCESSING' | 'AVAILABLE' | 'PROCESSING_FAILED', ... }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RETRY SAFETY
 * ─────────────────────────────────────────────────────────────────────────────
 * - Per-attachment URN cache keyed by source URL is read/written via
 *   `scheduled_posts.creator_attachment_metadata.provider_asset_urns.linkedin`
 *   (existing JSONB column; no schema change). On retry/replay, a cached URN
 *   is reused — no duplicate upload to LinkedIn.
 * - The cache is best-effort. If the cached URN is stale (asset expired on
 *   LinkedIn side, which is rare within the publish window), the Posts API
 *   call will 422 and the operator can clear the cache and retry.
 * - Adapter idempotency: scheduled_posts.platform_post_id still guards
 *   re-publish at the orchestrator/queue layer; this module only handles the
 *   upload sub-step.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN GAPS (called out as remaining LinkedIn limitations in the report)
 * ─────────────────────────────────────────────────────────────────────────────
 * - Single-part video upload only. Chunked / multi-part upload for large
 *   videos (>~200MB or LinkedIn's part-size threshold) requires a separate
 *   pass — left as TODO with explicit error code.
 * - No alt-text wiring yet (uses `null`). The CanonicalAttachment shape
 *   carries `title` which could be projected; left for v2.
 * - Single-image only in Posts API content field. Multi-image carousel
 *   requires `content.multiImage.images[]` shape; left for v2.
 * - No async processing-status polling backoff (uses fixed interval).
 *
 * UNTESTED AGAINST REAL LINKEDIN API at code-ship time. Operator MUST
 * validate against a non-prod LinkedIn account before flipping
 * `ADAPTER_CAN_PUBLISH_MEDIA[linkedin]=true` in publishReadinessValidator.ts.
 */

import { supabase } from '../../db/supabaseClient';

export const LINKEDIN_API_VERSION = '202507';

export type LinkedInMediaKind = 'image' | 'video';

export interface LinkedInUploadAuth {
  accessToken: string;
  authorUrn: string;            // 'urn:li:person:<id>'
}

export interface LinkedInUploadResult {
  assetUrn: string;             // 'urn:li:image:...' or 'urn:li:video:...'
  kind: LinkedInMediaKind;
  fromCache: boolean;
}

export type LinkedInUploadFailure = {
  code:
    | 'LINKEDIN_MEDIA_FETCH_FAILED'
    | 'LINKEDIN_MEDIA_REGISTER_FAILED'
    | 'LINKEDIN_MEDIA_PUT_FAILED'
    | 'LINKEDIN_VIDEO_FINALIZE_FAILED'
    | 'LINKEDIN_VIDEO_PROCESSING_FAILED'
    | 'LINKEDIN_MEDIA_KIND_UNSUPPORTED'
    | 'LINKEDIN_MEDIA_TOO_LARGE'
    | 'LINKEDIN_MEDIA_CACHE_WRITE_FAILED';
  message: string;
  retryable: boolean;
  status?: number;
};

export type LinkedInUploadOutcome =
  | { ok: true; result: LinkedInUploadResult }
  | { ok: false; error: LinkedInUploadFailure };

const LINKEDIN_BASE = 'https://api.linkedin.com/rest';

/**
 * WS1-E6-T004 — brokered outbound for the LinkedIn media pipeline.
 *
 * These calls cannot use safeFetch (they stream binaries and follow LinkedIn's
 * own upload URLs), but they are still publish-path provider calls. This is a
 * thin adapter over the SAME per-host breaker registry safeFetch uses — same
 * key format, no second breaker implementation.
 */
const brokeredFetch = async (url: string, init: RequestInit) => {
  const { outboundBreakerFor } = await import('../../../lib/security/safeFetch');
  // Every caller in this module passes either the LINKEDIN_BASE constant or an
  // uploadUrl returned by the LinkedIn API — the same justification already
  // reviewed at the uploadUrl call site below, which this helper centralizes.
  // ssrf-ok: LINKEDIN_BASE constant or LinkedIn-API-issued uploadUrl, never user input
  return outboundBreakerFor(new URL(url).hostname).call(() => fetch(url, init));
};

/** Single-part video size ceiling. LinkedIn's documented threshold for
 *  switching to multi-part upload is roughly 200 MB; we cap lower to stay
 *  safely on the single-part path until chunked upload is implemented. */
const SINGLE_PART_VIDEO_MAX_BYTES = 150 * 1024 * 1024;

// Polling cadence for video processing status.
const VIDEO_POLL_INTERVAL_MS = 3_000;
const VIDEO_POLL_TIMEOUT_MS = 90_000;

/** Infer the media kind from a media_types[] entry or URL. */
export function inferLinkedInMediaKind(mimeOrUrl: string | undefined | null): LinkedInMediaKind | null {
  const s = String(mimeOrUrl ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('image/') || /\.(png|jpe?g|gif|webp)(?:[?#]|$)/.test(s)) return 'image';
  if (s.startsWith('video/') || /\.(mp4|mov|webm|m4v)(?:[?#]|$)/.test(s)) return 'video';
  return null;
}

/**
 * Get or upload a single LinkedIn asset for the given source URL. Reuses a
 * cached asset URN from `scheduled_posts.creator_attachment_metadata`
 * .provider_asset_urns.linkedin when present. Otherwise: download source →
 * registerUpload → PUT binary → (video only) finalize + poll until READY →
 * write URN back to the cache.
 */
export async function getOrUploadLinkedInAsset(input: {
  scheduledPostId: string;
  sourceUrl: string;
  mimeType?: string | null;
  auth: LinkedInUploadAuth;
}): Promise<LinkedInUploadOutcome> {
  const kind = inferLinkedInMediaKind(input.mimeType || input.sourceUrl);
  if (!kind) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_KIND_UNSUPPORTED',
        message: `Cannot infer LinkedIn media kind from "${input.mimeType ?? input.sourceUrl}". Provide explicit MIME type.`,
        retryable: false,
      },
    };
  }

  // 1. Cache lookup
  const cached = await readUrnCache(input.scheduledPostId, input.sourceUrl);
  if (cached) {
    return { ok: true, result: { assetUrn: cached, kind, fromCache: true } };
  }

  // 2. Fetch the source binary. (For Supabase-storage URLs this is a direct
  //    GET; for arbitrary HTTPS, the network reachability is operator's
  //    responsibility.)
  let binary: ArrayBuffer;
  let fetchedContentType: string | null;
  try {
    // HARDEN-005: sourceUrl is user-controlled media — SSRF-safe download
    // (validated host, DNS-pinned, size-capped). A blocked internal URL throws
    // and is handled by the catch below as a fetch failure.
    const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
    const r = await safeFetch(input.sourceUrl, { method: 'GET' });
    if (!r.ok) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_FETCH_FAILED',
          message: `Failed to fetch source media (${r.status}) from ${redactUrl(input.sourceUrl)}`,
          retryable: r.status >= 500,
          status: r.status,
        },
      };
    }
    const buf = await readCapped(r);
    // Copy into a standalone ArrayBuffer (buf may be a view over a pooled/shared buffer).
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    binary = ab;
    fetchedContentType = r.headers.get('content-type');
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_FETCH_FAILED',
        message: `Network error fetching source media: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }

  const byteLength = binary.byteLength;
  if (kind === 'video' && byteLength > SINGLE_PART_VIDEO_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_TOO_LARGE',
        message: `Video size ${byteLength} bytes exceeds single-part upload cap (${SINGLE_PART_VIDEO_MAX_BYTES}). Chunked upload not implemented yet.`,
        retryable: false,
      },
    };
  }

  // 3. Register the upload
  const init = kind === 'image'
    ? await registerImageUpload(input.auth)
    : await registerVideoUpload(input.auth, byteLength);
  if (init.ok === false) return { ok: false, error: init.error };
  const { assetUrn, uploadUrl } = init.value;

  // 4. PUT the binary
  const putResult = await putBinaryToLinkedIn({
    uploadUrl,
    accessToken: input.auth.accessToken,
    binary,
    contentType: fetchedContentType || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
  });
  if (putResult.ok === false) return { ok: false, error: putResult.error };

  // 5. Video-only: finalize + poll until READY
  if (kind === 'video') {
    const finalize = await finalizeVideoUpload({
      auth: input.auth,
      assetUrn,
      uploadedPartIds: [putResult.etag].filter(Boolean) as string[],
    });
    if (finalize.ok === false) return { ok: false, error: finalize.error };
    const poll = await pollVideoUntilReady({ auth: input.auth, assetUrn });
    if (poll.ok === false) return { ok: false, error: poll.error };
  }

  // 6. Write the URN back to the cache
  const cacheWrite = await writeUrnCache(input.scheduledPostId, input.sourceUrl, assetUrn);
  if (cacheWrite.ok === false) {
    // Don't fail the whole upload over a cache write — the asset is uploaded
    // and the post can proceed. Subsequent retries will just re-upload.
    console.warn('[linkedin.media] URN cache write failed (non-fatal):', cacheWrite.error.message);
  }

  return { ok: true, result: { assetUrn, kind, fromCache: false } };
}

// ───────────────────────────────────────────────────────────────────────
// API helpers
// ───────────────────────────────────────────────────────────────────────

async function registerImageUpload(
  auth: LinkedInUploadAuth,
): Promise<{ ok: true; value: { assetUrn: string; uploadUrl: string } } | { ok: false; error: LinkedInUploadFailure }> {
  try {
    const r = await brokeredFetch(`${LINKEDIN_BASE}/images?action=initializeUpload`, {
      method: 'POST',
      headers: linkedInHeaders(auth.accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner: auth.authorUrn } }),
    });
    const text = await r.text();
    if (!r.ok) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
          message: `Image initializeUpload failed (${r.status}): ${text.slice(0, 300)}`,
          retryable: r.status >= 500 || r.status === 429,
          status: r.status,
        },
      };
    }
    const body = JSON.parse(text);
    const uploadUrl = body?.value?.uploadUrl;
    const assetUrn = body?.value?.image;
    if (!uploadUrl || !assetUrn) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
          message: `Image initializeUpload response missing uploadUrl or image URN`,
          retryable: false,
        },
      };
    }
    return { ok: true, value: { assetUrn, uploadUrl } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
        message: `Image initializeUpload network error: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }
}

async function registerVideoUpload(
  auth: LinkedInUploadAuth,
  fileSizeBytes: number,
): Promise<{ ok: true; value: { assetUrn: string; uploadUrl: string } } | { ok: false; error: LinkedInUploadFailure }> {
  try {
    const r = await brokeredFetch(`${LINKEDIN_BASE}/videos?action=initializeUpload`, {
      method: 'POST',
      headers: linkedInHeaders(auth.accessToken),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: auth.authorUrn,
          fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
          message: `Video initializeUpload failed (${r.status}): ${text.slice(0, 300)}`,
          retryable: r.status >= 500 || r.status === 429,
          status: r.status,
        },
      };
    }
    const body = JSON.parse(text);
    const assetUrn = body?.value?.video;
    // Single-part: take the first uploadInstruction's URL. Multi-part case
    // is deferred (see SINGLE_PART_VIDEO_MAX_BYTES gate above).
    const uploadUrl = body?.value?.uploadInstructions?.[0]?.uploadUrl;
    if (!uploadUrl || !assetUrn) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
          message: `Video initializeUpload response missing uploadUrl or video URN`,
          retryable: false,
        },
      };
    }
    return { ok: true, value: { assetUrn, uploadUrl } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_REGISTER_FAILED',
        message: `Video initializeUpload network error: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }
}

async function putBinaryToLinkedIn(input: {
  uploadUrl: string;
  accessToken: string;
  binary: ArrayBuffer;
  contentType: string;
}): Promise<{ ok: true; etag: string | null } | { ok: false; error: LinkedInUploadFailure }> {
  try {
    // ssrf-ok: uploadUrl is returned by the LinkedIn API (trusted platform response), not user input
    const r = await brokeredFetch(input.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': input.contentType,
      },
      body: input.binary,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_PUT_FAILED',
          message: `Binary PUT failed (${r.status}): ${text.slice(0, 300)}`,
          retryable: r.status >= 500 || r.status === 429,
          status: r.status,
        },
      };
    }
    return { ok: true, etag: r.headers.get('etag') };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_PUT_FAILED',
        message: `Binary PUT network error: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }
}

async function finalizeVideoUpload(input: {
  auth: LinkedInUploadAuth;
  assetUrn: string;
  uploadedPartIds: string[];
}): Promise<{ ok: true } | { ok: false; error: LinkedInUploadFailure }> {
  try {
    const r = await brokeredFetch(`${LINKEDIN_BASE}/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: linkedInHeaders(input.auth.accessToken),
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: input.assetUrn,
          uploadToken: '',
          uploadedPartIds: input.uploadedPartIds,
        },
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_VIDEO_FINALIZE_FAILED',
          message: `Video finalizeUpload failed (${r.status}): ${text.slice(0, 300)}`,
          retryable: r.status >= 500,
          status: r.status,
        },
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_VIDEO_FINALIZE_FAILED',
        message: `Video finalizeUpload network error: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }
}

async function pollVideoUntilReady(input: {
  auth: LinkedInUploadAuth;
  assetUrn: string;
}): Promise<{ ok: true } | { ok: false; error: LinkedInUploadFailure }> {
  const started = Date.now();
  // URN-encoded path: encode the entire URN since it contains colons.
  const urnPath = encodeURIComponent(input.assetUrn);
  while (Date.now() - started < VIDEO_POLL_TIMEOUT_MS) {
    try {
      const r = await brokeredFetch(`${LINKEDIN_BASE}/videos/${urnPath}`, {
        method: 'GET',
        headers: linkedInHeaders(input.auth.accessToken),
      });
      const text = await r.text();
      if (r.ok) {
        const body = JSON.parse(text);
        const status: string = body?.status ?? '';
        if (status === 'AVAILABLE') return { ok: true };
        if (status === 'PROCESSING_FAILED') {
          return {
            ok: false,
            error: {
              code: 'LINKEDIN_VIDEO_PROCESSING_FAILED',
              message: `LinkedIn rejected the uploaded video (${status}). Re-upload with a supported codec/format.`,
              retryable: false,
            },
          };
        }
        // PROCESSING / queued — wait.
      }
    } catch {
      // network blip — keep trying within timeout
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    error: {
      code: 'LINKEDIN_VIDEO_PROCESSING_FAILED',
      message: `Video did not become AVAILABLE within ${VIDEO_POLL_TIMEOUT_MS / 1000}s. Retry will re-poll.`,
      retryable: true,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// URN cache (creator_attachment_metadata JSONB sub-key)
// ───────────────────────────────────────────────────────────────────────

async function readUrnCache(scheduledPostId: string, sourceUrl: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('creator_attachment_metadata')
      .eq('id', scheduledPostId)
      .maybeSingle();
    if (error || !data) return null;
    const metadata = (data as { creator_attachment_metadata?: unknown }).creator_attachment_metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    const providerCache = (metadata as Record<string, any>).provider_asset_urns;
    if (!providerCache || typeof providerCache !== 'object') return null;
    const linkedinCache = providerCache.linkedin;
    if (!linkedinCache || typeof linkedinCache !== 'object') return null;
    const urn = linkedinCache[sourceUrl];
    return typeof urn === 'string' && urn.length > 0 ? urn : null;
  } catch {
    return null;
  }
}

async function writeUrnCache(
  scheduledPostId: string,
  sourceUrl: string,
  assetUrn: string,
): Promise<{ ok: true } | { ok: false; error: LinkedInUploadFailure }> {
  try {
    const { data: row } = await supabase
      .from('scheduled_posts')
      .select('creator_attachment_metadata')
      .eq('id', scheduledPostId)
      .maybeSingle();
    const existing = (row as { creator_attachment_metadata?: unknown } | null)?.creator_attachment_metadata;
    const metadata: Record<string, any> = (existing && typeof existing === 'object') ? { ...(existing as object) } : {};
    const providerCache: Record<string, any> = metadata.provider_asset_urns && typeof metadata.provider_asset_urns === 'object'
      ? { ...metadata.provider_asset_urns }
      : {};
    const linkedinCache: Record<string, any> = providerCache.linkedin && typeof providerCache.linkedin === 'object'
      ? { ...providerCache.linkedin }
      : {};
    linkedinCache[sourceUrl] = assetUrn;
    providerCache.linkedin = linkedinCache;
    metadata.provider_asset_urns = providerCache;
    const { error } = await supabase
      .from('scheduled_posts')
      .update({ creator_attachment_metadata: metadata, updated_at: new Date().toISOString() })
      .eq('id', scheduledPostId);
    if (error) {
      return {
        ok: false,
        error: {
          code: 'LINKEDIN_MEDIA_CACHE_WRITE_FAILED',
          message: `URN cache update failed: ${error.message}`,
          retryable: true,
        },
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LINKEDIN_MEDIA_CACHE_WRITE_FAILED',
        message: `URN cache write threw: ${(err as Error).message}`,
        retryable: true,
      },
    };
  }
}

// ───────────────────────────────────────────────────────────────────────
// Tiny utilities
// ───────────────────────────────────────────────────────────────────────

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactUrl(url: string): string {
  // Hide query strings (may contain signed URL params).
  const q = url.indexOf('?');
  return q > 0 ? `${url.slice(0, q)}?<query>` : url;
}
