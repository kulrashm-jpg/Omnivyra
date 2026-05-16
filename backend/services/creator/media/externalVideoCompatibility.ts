/**
 * External Video Compatibility — human-production video only (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * Phase-2 video-aware compatibility. Derives platform support from the
 * Step-13 canonical registry (video family = reel/short/video) and
 * layers duration + aspect constraints. Fail-closed: unknown asset /
 * non-video asset / unsupported platform / over-limit duration /
 * incompatible aspect ⇒ NOT compatible. NO AI rendering, no queues.
 *
 * It does NOT modify the image `isPlatformAssetCompatible` path — image
 * flow is untouched. This is an additive video layer.
 */

import {
  getCreatorAsset,
  isPlatformSupported,
  isTextLikeAsset,
  normalizeAssetPlatformKey,
} from '../intelligence/canonical';

export interface ExternalVideoMeta {
  duration_seconds?: number | null;
  aspect_ratio?: string | null;
}

export type VideoIncompatibilityReason =
  | 'unknown_asset'
  | 'not_video_asset'
  | 'text_like_asset'
  | 'platform_unsupported'
  | 'duration_exceeds_platform'
  | 'aspect_incompatible'
  | null;

export interface VideoCompatibilityResult {
  compatible: boolean;
  reason: VideoIncompatibilityReason;
  canonical_asset_family: string | null;
}

/** Per-platform hard duration ceilings (seconds) for short-form video.
 *  Absent ⇒ no enforced ceiling (lenient on duration only). */
const MAX_DURATION: Record<string, number> = {
  instagram: 90,    // Reels
  facebook: 90,     // Reels
  youtube: 60,      // Shorts
  tiktok: 600,
  linkedin: 600,
};
/** Allowed aspect ratios per platform (when meta provides one). */
const ALLOWED_ASPECT: Record<string, string[]> = {
  instagram: ['9:16', '4:5', '1:1'],
  facebook: ['9:16', '1:1', '16:9'],
  youtube: ['9:16', '16:9'],
  tiktok: ['9:16'],
  linkedin: ['16:9', '1:1', '9:16'],
};

/**
 * Pure, fail-closed video compatibility. `creator_video` and the
 * reel/short aliases all normalize through the canonical registry to
 * the `video` family.
 */
export function isPlatformVideoCompatible(
  platform: unknown,
  assetType: unknown,
  meta: ExternalVideoMeta = {},
): VideoCompatibilityResult {
  const def = getCreatorAsset(assetType === 'creator_video' ? 'video' : assetType);
  if (!def) {
    return { compatible: false, reason: 'unknown_asset', canonical_asset_family: null };
  }
  if (isTextLikeAsset(def.canonical_key)) {
    return { compatible: false, reason: 'text_like_asset', canonical_asset_family: def.canonical_asset_family };
  }
  if (def.canonical_asset_family !== 'video') {
    return { compatible: false, reason: 'not_video_asset', canonical_asset_family: def.canonical_asset_family };
  }
  const pkey = normalizeAssetPlatformKey(platform);
  if (!isPlatformSupported(def.canonical_key, pkey)) {
    return { compatible: false, reason: 'platform_unsupported', canonical_asset_family: 'video' };
  }
  // Duration (only when provided — fail-closed on KNOWN over-limit).
  const dur = typeof meta.duration_seconds === 'number' ? meta.duration_seconds : null;
  const max = MAX_DURATION[pkey];
  if (dur != null && max != null && dur > max) {
    return { compatible: false, reason: 'duration_exceeds_platform', canonical_asset_family: 'video' };
  }
  // Aspect (only when provided — lenient if absent/unknown platform).
  const aspect = typeof meta.aspect_ratio === 'string' ? meta.aspect_ratio.trim() : '';
  const allowed = ALLOWED_ASPECT[pkey];
  if (aspect && allowed && !allowed.includes(aspect)) {
    return { compatible: false, reason: 'aspect_incompatible', canonical_asset_family: 'video' };
  }
  return { compatible: true, reason: null, canonical_asset_family: 'video' };
}

/** Filter target platforms to the video-compatible set (normalized). */
export function getVideoCompatiblePlatforms(
  assetType: unknown,
  platforms: ReadonlyArray<unknown>,
  meta: ExternalVideoMeta = {},
): string[] {
  const out: string[] = [];
  for (const p of platforms) {
    const key = normalizeAssetPlatformKey(p);
    if (isPlatformVideoCompatible(key, assetType, meta).compatible) out.push(key);
  }
  return Array.from(new Set(out)).sort();
}
