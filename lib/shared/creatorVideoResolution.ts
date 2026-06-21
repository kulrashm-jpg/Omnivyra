/**
 * PHASE CREATOR-VIDEO-PUBLISHING-CONSISTENCY — single resolution authority.
 *
 * `resolveVideoForPlatform()` is the ONE place that answers:
 *   "Which video URL is used for platform X?"
 *
 * Consumed by the creator attachment scheduler (scheduleCreatorAttachmentPost),
 * which is the sole publishing path for uploaded creator video media.
 *
 * Resolution order (fail-closed; never fail open):
 *   1. (platform, format) mapping — when a target format is supplied and a
 *      matching platform_video_mappings row exists (e.g. YouTube + Long Video).
 *   2. platform mapping — platform_videos[platform], else the first mapping for
 *      that platform (the per-platform primary).
 *   3. shared video — the same-video / asset url.
 *   4. validated upload — the lifecycle-finalized uploaded_media_url.
 *
 * Backward compatibility (unchanged): 'same'/legacy assets and 'different'
 * assets without platform_video_mappings behave exactly as before. The added
 * `format` is optional — omitting it reproduces the prior platform-only result.
 */

import { canonicalVideoFormat } from './videoFormatCanonical';

export interface CreatorVideoMappingEntry {
  platformId: string;
  videoFormat: string;
  videoUrl: string;
}

export interface CreatorVideoAsset {
  url?: string | null;
  video_mode?: 'same' | 'different' | string | null;
  platform_videos?: Record<string, string> | null;
  /** Richer per-row mappings (platform + format + url). Drives format-aware resolution. */
  platform_video_mappings?: CreatorVideoMappingEntry[] | null;
}

export interface ResolveVideoForPlatformInput {
  /** The row's creator asset (from content.asset_payload.override_asset / creator_asset). */
  creatorAsset?: CreatorVideoAsset | null;
  /** Destination platform key (e.g. 'linkedin', 'instagram', 'youtube', 'tiktok'). */
  platform: string;
  /**
   * Optional target video format (e.g. 'Short', 'Long Video', 'Reel'). When
   * supplied, the (platform, format) mapping is resolved first so YouTube Short
   * and YouTube Long Video resolve to distinct assets. Omitting it preserves
   * the prior platform-only behaviour.
   */
  format?: string | null;
  /**
   * The validated, lifecycle-finalized media URL for the row. Authoritative for
   * 'same'/legacy rows (it is what the upload-validation lifecycle produced).
   */
  uploadedMediaUrl?: string | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function ci(value: unknown): string {
  return clean(value).toLowerCase();
}
/** Canonical platform key (twitter → x) so lookups match stored mapping keys. */
function normKey(platform: string): string {
  const k = ci(platform);
  return k === 'twitter' ? 'x' : k;
}

/**
 * Resolve the video URL to publish for a given destination platform (and,
 * optionally, video format). Never throws and never returns undefined —
 * returns '' when nothing resolves so callers can decide how to handle a
 * genuinely media-less row.
 */
export function resolveVideoForPlatform(input: ResolveVideoForPlatformInput): string {
  const { creatorAsset, platform } = input;
  const uploaded = clean(input.uploadedMediaUrl);
  const assetUrl = clean(creatorAsset?.url);

  if (!creatorAsset) return uploaded || assetUrl;

  const mode = creatorAsset.video_mode === 'different' ? 'different' : 'same';

  if (mode === 'different') {
    const key = normKey(platform);
    const rawKey = ci(platform);
    const mappings = Array.isArray(creatorAsset.platform_video_mappings)
      ? creatorAsset.platform_video_mappings
      : [];

    // 1. (platform, format) mapping — only when a format is requested.
    //    Compared on CANONICAL format codes (single authority) so display
    //    labels ('Long Video') and creator codes ('video') reconcile — never a
    //    direct label comparison.
    const wantFormat = canonicalVideoFormat(input.format);
    if (wantFormat) {
      const exact = mappings.find(
        (m) => normKey(m?.platformId) === key && canonicalVideoFormat(m?.videoFormat) === wantFormat && clean(m?.videoUrl),
      );
      if (exact) return clean(exact.videoUrl);
    }

    // 2. platform mapping — platform_videos, else the first mapping for the platform.
    const map = creatorAsset.platform_videos && typeof creatorAsset.platform_videos === 'object'
      ? creatorAsset.platform_videos
      : {};
    const platformUrl =
      clean(map[key]) ||
      clean(map[rawKey]) ||
      clean(map[platform]) ||
      clean(mappings.find((m) => normKey(m?.platformId) === key && clean(m?.videoUrl))?.videoUrl);
    if (platformUrl) return platformUrl;

    // 3. shared video → 4. validated upload (never fail open).
    return assetUrl || uploaded;
  }

  // 'same' / legacy → the validated finalized upload is authoritative.
  return uploaded || assetUrl;
}

/**
 * Extract the creator video asset from a daily-plan row's parsed content JSON.
 * The creator-asset save path stores it at `asset_payload.override_asset`; some
 * rows carry it at top-level `creator_asset`. Returns null when absent.
 */
export function readCreatorVideoAsset(content: Record<string, unknown> | null | undefined): CreatorVideoAsset | null {
  if (!content || typeof content !== 'object') return null;
  const assetPayload = (content as Record<string, unknown>).asset_payload;
  const override = assetPayload && typeof assetPayload === 'object' && !Array.isArray(assetPayload)
    ? (assetPayload as Record<string, unknown>).override_asset
    : null;
  const candidate = (override && typeof override === 'object' ? override : null)
    ?? ((content as Record<string, unknown>).creator_asset);
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as CreatorVideoAsset)
    : null;
}
