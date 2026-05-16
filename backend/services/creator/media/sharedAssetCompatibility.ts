/**
 * Shared Creator Media — Phase-6 compatibility engine (PURE).
 * ──────────────────────────────────────────────────────────────────────────
 * Decides whether a media asset MAY be attached to a platform variant.
 * Derives EVERY answer from the Step-13 CreatorAssetRegistry — no
 * scattered conditionals, no DB, no scheduler.
 *
 * Scope: MEDIA assets only. This never touches caption/hashtag/CTA/
 * metadata generation — platform-native TEXT is produced exactly as
 * Steps 6/12 do and is out of this module's concern.
 */

import {
  getCreatorAsset,
  isPlatformSupported,
  isTextLikeAsset,
  normalizeAssetPlatformKey,
} from '../intelligence/canonical';

export type CompatibilityPolicy = 'registry' | 'strict' | 'lenient';

export type IncompatibilityReason =
  | 'unknown_asset'
  | 'text_like_asset'
  | 'platform_unsupported'
  | null;

export interface CompatibilityResult {
  compatible: boolean;
  reason: IncompatibilityReason;
  canonical_asset_family: string | null;
}

/**
 * Pure compatibility check. `registry` (default) = the canonical
 * platform_support is authoritative. `strict` = registry AND the asset
 * must be a first-class adapter family (image/carousel/video). `lenient`
 * = registry OR image-family fallback (an image can ride almost
 * anywhere). Text-like assets are NEVER media-compatible.
 */
export function isPlatformAssetCompatible(
  platform: unknown,
  assetType: unknown,
  policy: CompatibilityPolicy = 'registry',
): CompatibilityResult {
  const def = getCreatorAsset(assetType);
  if (!def) {
    return { compatible: false, reason: 'unknown_asset', canonical_asset_family: null };
  }
  if (isTextLikeAsset(def.canonical_key)) {
    return { compatible: false, reason: 'text_like_asset', canonical_asset_family: def.canonical_asset_family };
  }
  const supported = isPlatformSupported(def.canonical_key, platform);

  let compatible = supported;
  if (!supported && policy === 'lenient') {
    // An image-family asset is broadly reusable as a static attachment.
    compatible = def.canonical_asset_family === 'image';
  }
  if (supported && policy === 'strict') {
    compatible = ['image', 'carousel', 'video'].includes(def.canonical_asset_family);
  }

  return {
    compatible,
    reason: compatible ? null : 'platform_unsupported',
    canonical_asset_family: def.canonical_asset_family,
  };
}

/** Filter target platforms down to the compatible set (normalized). */
export function getCompatiblePlatforms(
  assetType: unknown,
  platforms: ReadonlyArray<unknown>,
  policy: CompatibilityPolicy = 'registry',
): string[] {
  const out: string[] = [];
  for (const p of platforms) {
    const key = normalizeAssetPlatformKey(p);
    if (isPlatformAssetCompatible(key, assetType, policy).compatible) out.push(key);
  }
  // de-dupe, deterministic order
  return Array.from(new Set(out)).sort();
}
