/**
 * Platform video-format capability registry (PLATFORM-SPECIFIC VIDEO MAPPING).
 *
 * The single source of truth for "which video formats does platform X support".
 * Consumed by the Video Asset UI, save validation, and any scheduler/publish
 * validation — formats are NEVER hardcoded inside the UI. Governance is
 * fail-closed: a (platform, format) pair not listed here is invalid.
 */

import { canonicalVideoFormat } from './videoFormatCanonical';

/** Canonical platform key normalisation (twitter → x). */
export function normalizeVideoPlatform(platform: string): string {
  const k = String(platform || '').trim().toLowerCase();
  return k === 'twitter' ? 'x' : k;
}

/** platform → ordered list of supported video format labels. */
export const PLATFORM_VIDEO_FORMATS: Record<string, string[]> = {
  instagram: ['Reel'],
  facebook: ['Reel', 'Video'],
  youtube: ['Short', 'Long Video'],
  tiktok: ['Short Video'],
  linkedin: ['Video'],
  pinterest: ['Video Pin'],
  x: ['Video'],
  threads: ['Video'],
};

/** Supported video formats for a platform (empty array = no video support). */
export function getVideoFormatsForPlatform(platform: string): string[] {
  return PLATFORM_VIDEO_FORMATS[normalizeVideoPlatform(platform)] ?? [];
}

/** Whether a platform supports any video format at all. */
export function platformSupportsVideo(platform: string): boolean {
  return getVideoFormatsForPlatform(platform).length > 0;
}

/**
 * Fail-closed validity check for a (platform, format) pair. Compared on
 * CANONICAL format codes (single authority) so labels and creator codes
 * reconcile; verdicts for the registry's own labels are unchanged.
 */
export function isValidPlatformVideoFormat(platform: string, format: string): boolean {
  const want = canonicalVideoFormat(format);
  if (!want) return false; // fail-closed — unknown format
  return getVideoFormatsForPlatform(platform).some((f) => canonicalVideoFormat(f) === want);
}

/** All platforms that support video, in display order — for the guidance panel. */
export function listVideoCapablePlatforms(): string[] {
  return Object.keys(PLATFORM_VIDEO_FORMATS).filter((p) => p !== 'threads');
}
