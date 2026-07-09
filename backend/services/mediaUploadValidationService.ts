/**
 * Media Upload Validation Service
 *
 * Reusable URL + MIME + media-category validator used by the upload API
 * (and future storage-upload / publish-validation flows). Performs:
 *
 *   1. URL format check (must parse + be http/https or a valid platform link)
 *   2. URL liveness check via HEAD (with a GET fallback for hosts that
 *      reject HEAD with 4xx/5xx). Caller can opt out via `skipLiveness`.
 *   3. MIME compatibility check vs the row's `content_type` (video, reel,
 *      short, podcast — and image-family in case a future autonomous
 *      replacement-upload flow reuses this).
 *   4. Size sanity (basic upper bound; soft warning if unknown).
 *
 * Returns a structured validation object that can be persisted on the row.
 * Never throws — failures come back as `{ valid: false, errors: [...] }`.
 *
 * Categories:
 *   - video formats (video / reel / short) accept `video/*` plus a curated
 *     set of "platform link" hosts (YouTube, Vimeo, TikTok, etc.) whose
 *     HEAD response is HTML, not video MIME.
 *   - audio formats (podcast) accept `audio/*` plus podcast platform hosts.
 *   - image formats (only relevant if a future upload-replacement flow
 *     calls this) accept `image/*`.
 */

export type MediaUploadCategory = 'video' | 'audio' | 'image';

export type MediaUploadValidationInput = {
  mediaUrl: string;
  contentType: string;
  mimeType?: string;
  sizeBytes?: number;
  /** If true, skip the HEAD/GET liveness probe — useful in unit tests. */
  skipLiveness?: boolean;
};

export type MediaUploadValidationDetails = {
  url_format_ok: boolean;
  url_liveness_ok: boolean | null; // null when skipLiveness
  mime_compatible: boolean;
  size_sanity_ok: boolean;
  expected_category: MediaUploadCategory | null;
  detected_mime: string | null;
  detected_size_bytes: number | null;
  platform_link_host: string | null;
  http_status: number | null;
};

export type MediaUploadValidation =
  | {
      valid: true;
      validated_at: string;
      details: MediaUploadValidationDetails;
    }
  | {
      valid: false;
      validated_at: string;
      errors: string[];
      details: MediaUploadValidationDetails;
    };

const MAX_BYTES_DEFAULT = 2 * 1024 * 1024 * 1024; // 2 GB hard cap
const PLATFORM_VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'player.vimeo.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'facebook.com', 'fb.watch', 'www.facebook.com',
  'twitter.com', 'x.com',
  'linkedin.com', 'www.linkedin.com',
  'loom.com', 'www.loom.com',
  'wistia.com', 'fast.wistia.com', 'fast.wistia.net',
]);

const PLATFORM_AUDIO_HOSTS = new Set([
  'open.spotify.com', 'spotify.com',
  'podcasts.apple.com', 'itunes.apple.com',
  'anchor.fm', 'overcast.fm', 'castbox.fm', 'pca.st',
  'soundcloud.com', 'www.soundcloud.com',
  'buzzsprout.com', 'simplecast.com', 'libsyn.com', 'transistor.fm',
  'redcircle.com', 'spreaker.com',
]);

const VIDEO_FORMATS = new Set(['video', 'reel', 'short']);
const AUDIO_FORMATS = new Set(['podcast']);
const IMAGE_FORMATS = new Set(['image', 'banner', 'infographic', 'story']);

export function resolveExpectedCategory(contentType: string): MediaUploadCategory | null {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (VIDEO_FORMATS.has(normalized)) return 'video';
  if (AUDIO_FORMATS.has(normalized)) return 'audio';
  if (IMAGE_FORMATS.has(normalized)) return 'image';
  return null;
}

/**
 * Server-side magic-byte MIME sniffer. Returns the SNIFFED MIME type for
 * common video / audio / image containers, or `null` when no signature
 * matches. Used to reject spoofed uploads where the multipart envelope
 * claims one MIME but the bytes are something else.
 *
 * Signatures (RFC + container documentation):
 *   - video/mp4 / video/quicktime: ISO base-media — `ftyp` box at offset 4
 *   - video/webm: EBML — `1A 45 DF A3` at offset 0
 *   - audio/webm: same EBML signature (caller must disambiguate via container hints)
 *   - audio/mpeg: ID3 header (`49 44 33`) OR MPEG frame sync (`FF FB/FA/F3/F2`)
 *   - audio/wav: RIFF ... WAVE
 *   - audio/ogg: `OggS`
 *   - audio/mp4 (m4a): same `ftyp` family; M4A profile within ftyp box
 *   - image/png: `89 50 4E 47`
 *   - image/jpeg: `FF D8`
 *   - image/gif: `GIF87a` / `GIF89a`
 *   - image/webp: RIFF ... WEBP
 */
export function sniffMimeFromBytes(buffer: Buffer | Uint8Array): string | null {
  if (!buffer || buffer.length < 4) return null;
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  // GIF87a / GIF89a
  if (b.length >= 6 && b.slice(0, 6).toString('latin1') === 'GIF87a') return 'image/gif';
  if (b.length >= 6 && b.slice(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  // RIFF container — could be WAV or WEBP
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF') {
    const sub = b.slice(8, 12).toString('latin1');
    if (sub === 'WAVE') return 'audio/wav';
    if (sub === 'WEBP') return 'image/webp';
    if (sub === 'AVI ') return 'video/x-msvideo';
  }
  // OGG
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  // EBML — webm container (video or audio depending on track)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  // ID3 tag → MP3
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  // FLAC native signature: 'fLaC'
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
  // AIFF: 'FORM' + 'AIFF' (similar to RIFF but big-endian)
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'FORM' && b.slice(8, 12).toString('latin1') === 'AIFF') {
    return 'audio/aiff';
  }
  // MPEG audio frame sync
  if (b[0] === 0xff && (b[1] === 0xfb || b[1] === 0xfa || b[1] === 0xf3 || b[1] === 0xf2)) return 'audio/mpeg';
  // AAC ADTS frame sync: `0xFFF*` with profile bits in byte[2]
  if (b[0] === 0xff && (b[1] & 0xf0) === 0xf0 && (b[1] & 0x06) === 0x00 && (b[1] & 0x01) === 0x01) {
    // AAC ADTS sync uses pattern FFF1 (MPEG-4) or FFF9 (MPEG-2)
    return 'audio/aac';
  }
  // ISO base media: 'ftyp' box at offset 4
  if (b.length >= 12 && b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    // HEIC / HEIF image family
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' ||
        brand === 'heim' || brand === 'heis' || brand === 'hevc' || brand === 'hevx') {
      return 'image/heic';
    }
    // AVIF (AV1 still images)
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    // M4A audio variants
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ' || brand === 'aac ') {
      return 'audio/mp4';
    }
    // QuickTime
    if (brand === 'qt  ') return 'video/quicktime';
    // AV1 / CMAF brands (treat as MP4 container — category-level video/mp4)
    if (brand === 'av01' || brand === 'cmf2' || brand === 'cmfc' || brand === 'cmfl' || brand === 'cmfs') {
      return 'video/mp4';
    }
    // 3GPP video
    if (brand === '3gp4' || brand === '3gp5' || brand === '3gp6' || brand === '3g2a' || brand === '3g2b') {
      return 'video/3gpp';
    }
    // Default: treat as video/mp4 for isom / mp4* / avc1 / dash / iso2 / iso6 brands.
    return 'video/mp4';
  }
  return null;
}

/**
 * Compare a SNIFFED MIME to a CLIENT-CLAIMED MIME. Returns:
 *   { ok: true, sniffed }                 — sniffed and client agree (or sniff unsupported)
 *   { ok: false, sniffed, claimed }       — client lied about the binary
 *
 * "Agreement" means the category (video / audio / image) matches. We
 * deliberately don't require exact format equivalence (e.g. `video/mp4`
 * vs `video/quicktime`) because client browsers and uploaders disagree on
 * which MIME to label a `.mov` with.
 */
export function compareSniffedToClientMime(input: {
  sniffed: string | null;
  claimed: string | undefined | null;
}): { ok: true; sniffed: string | null; claimed: string | null } | { ok: false; sniffed: string; claimed: string; reason: string } {
  const claimed = String(input.claimed || '').trim().toLowerCase().split(';')[0].trim();
  const sniffed = input.sniffed ? input.sniffed.toLowerCase() : null;
  if (!sniffed) {
    return { ok: true, sniffed: null, claimed: claimed || null };
  }
  if (!claimed) {
    return { ok: true, sniffed, claimed: null };
  }
  const cat = (mime: string) => mime.split('/')[0];
  if (cat(sniffed) === cat(claimed)) {
    return { ok: true, sniffed, claimed };
  }
  return {
    ok: false,
    sniffed,
    claimed,
    reason: `Client claimed MIME "${claimed}" but file bytes look like "${sniffed}".`,
  };
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function hostMatchesPlatform(host: string, set: Set<string>): boolean {
  const normalized = host.toLowerCase();
  if (set.has(normalized)) return true;
  // Bare-domain match for CDN-style subdomains (e.g. `cdn.somewhere.com`)
  // is intentionally NOT done — we only trust an explicit allow list to
  // avoid false positives.
  return false;
}

function isMimeInCategory(mime: string, category: MediaUploadCategory): boolean {
  const normalized = String(mime || '').trim().toLowerCase().split(';')[0].trim();
  if (!normalized) return false;
  if (category === 'video') return normalized.startsWith('video/');
  if (category === 'audio') return normalized.startsWith('audio/');
  if (category === 'image') return normalized.startsWith('image/');
  return false;
}

async function probeLiveness(url: URL): Promise<{ status: number | null; mime: string | null; sizeBytes: number | null }> {
  const tryFetch = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
    try {
      // HARDEN-005: the URL under validation is user/generated media — probe
      // via the SSRF-safe fetcher (blocked internal URLs throw → null below).
      const { safeFetch } = await import('../../lib/security/safeFetch');
      const resp = await safeFetch(url.toString(), {
        method,
        headers: {
          'user-agent': 'OmnivyraMediaValidator/1.0',
          'accept': '*/*',
        },
      }, { timeoutMs: 5000 });
      return resp;
    } catch {
      return null;
    }
  };

  let resp = await tryFetch('HEAD');
  if (!resp || !resp.ok) {
    // Some CDNs reject HEAD with 4xx/5xx. Fall back to GET (we don't
    // consume the body — Response.body is left dangling and the AbortController
    // already capped the wall-clock time).
    resp = await tryFetch('GET');
  }
  if (!resp) return { status: null, mime: null, sizeBytes: null };
  const contentType = resp.headers.get('content-type');
  const contentLength = resp.headers.get('content-length');
  const sizeBytes = contentLength ? Number(contentLength) : null;
  // Best-effort abort of any in-flight GET body.
  if (resp.body && typeof (resp.body as any).cancel === 'function') {
    try { await (resp.body as any).cancel(); } catch { /* ignore */ }
  }
  return {
    status: resp.status,
    mime: contentType ? contentType.split(';')[0].trim() : null,
    sizeBytes: Number.isFinite(sizeBytes ?? NaN) ? sizeBytes : null,
  };
}

export async function validateMediaUpload(input: MediaUploadValidationInput): Promise<MediaUploadValidation> {
  const errors: string[] = [];
  const details: MediaUploadValidationDetails = {
    url_format_ok: false,
    url_liveness_ok: input.skipLiveness ? null : false,
    mime_compatible: false,
    size_sanity_ok: false,
    expected_category: resolveExpectedCategory(input.contentType),
    detected_mime: input.mimeType ? String(input.mimeType).trim().toLowerCase().split(';')[0].trim() : null,
    detected_size_bytes: typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes) ? input.sizeBytes : null,
    platform_link_host: null,
    http_status: null,
  };

  const validatedAt = new Date().toISOString();

  // ── Category resolution ────────────────────────────────────────────────
  if (!details.expected_category) {
    errors.push(`Unsupported content_type for media upload: "${input.contentType}".`);
  }

  // ── URL format ─────────────────────────────────────────────────────────
  const trimmed = String(input.mediaUrl ?? '').trim();
  if (!trimmed) {
    errors.push('media_url is required.');
    return { valid: false, validated_at: validatedAt, errors, details };
  }
  const url = parseUrl(trimmed);
  if (!url) {
    errors.push('media_url must be a valid http(s) URL.');
    return { valid: false, validated_at: validatedAt, errors, details };
  }
  details.url_format_ok = true;

  // ── Platform link detection ────────────────────────────────────────────
  if (details.expected_category === 'video' && hostMatchesPlatform(url.host, PLATFORM_VIDEO_HOSTS)) {
    details.platform_link_host = url.host.toLowerCase();
  } else if (details.expected_category === 'audio' && hostMatchesPlatform(url.host, PLATFORM_AUDIO_HOSTS)) {
    details.platform_link_host = url.host.toLowerCase();
  }

  // ── Liveness probe ─────────────────────────────────────────────────────
  if (!input.skipLiveness) {
    const probe = await probeLiveness(url);
    details.http_status = probe.status;
    if (probe.mime && !details.detected_mime) details.detected_mime = probe.mime;
    if (probe.sizeBytes != null && details.detected_size_bytes == null) {
      details.detected_size_bytes = probe.sizeBytes;
    }
    const liveness = probe.status != null && probe.status >= 200 && probe.status < 400;
    details.url_liveness_ok = liveness;
    if (!liveness) {
      errors.push(`media_url is not reachable (HTTP ${probe.status ?? 'no response'}).`);
    }
  } else {
    details.url_liveness_ok = null;
  }

  // ── MIME compatibility ─────────────────────────────────────────────────
  if (details.expected_category) {
    if (details.platform_link_host) {
      // Platform hosts serve HTML, not media MIME. Accept the link as
      // category-compatible — the actual media-type check happens
      // server-side at publish time (and the user can paste a non-video
      // YouTube URL, which is a separate kind of mistake we won't catch
      // here).
      details.mime_compatible = true;
    } else if (details.detected_mime) {
      details.mime_compatible = isMimeInCategory(details.detected_mime, details.expected_category);
      if (!details.mime_compatible) {
        errors.push(
          `Uploaded MIME "${details.detected_mime}" is not compatible with expected category "${details.expected_category}" for content_type "${input.contentType}".`,
        );
      }
    } else {
      // No MIME detected and not a known platform host — treat as a
      // soft failure. The server cannot prove the URL points at the
      // expected media category.
      errors.push(
        `Could not detect media MIME type for "${input.mediaUrl}". Provide an explicit "mime_type" or use a recognized platform link.`,
      );
    }
  }

  // ── Size sanity ────────────────────────────────────────────────────────
  if (details.detected_size_bytes != null) {
    details.size_sanity_ok = details.detected_size_bytes > 0 && details.detected_size_bytes <= MAX_BYTES_DEFAULT;
    if (!details.size_sanity_ok) {
      errors.push(
        details.detected_size_bytes <= 0
          ? 'Detected media size is zero or negative.'
          : `Detected media size ${details.detected_size_bytes} bytes exceeds the ${MAX_BYTES_DEFAULT}-byte limit.`,
      );
    }
  } else {
    // Size unknown is OK for platform links and HEAD-blocking CDNs.
    details.size_sanity_ok = true;
  }

  if (errors.length > 0) {
    return { valid: false, validated_at: validatedAt, errors, details };
  }
  return { valid: true, validated_at: validatedAt, details };
}
