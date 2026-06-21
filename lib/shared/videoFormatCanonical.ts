/**
 * Canonical video-format vocabulary — the SINGLE authority that reconciles the
 * two vocabularies in the system:
 *
 *   • UI / mapping display labels: 'Reel', 'Video', 'Short', 'Long Video',
 *     'Short Video', 'Video Pin'  (platform_video_mappings[].videoFormat)
 *   • Creator runtime codes:       'video', 'short', 'reel'
 *     (daily-plan row content_type → normalizeCreatorFormat)
 *
 * `canonicalVideoFormat()` maps BOTH sides to one canonical code so every
 * comparison (validation, capability checks, resolution, scheduler propagation)
 * happens on canonical values — never on raw labels.
 *
 *   Long Video  → video
 *   Video       → video
 *   Short Video → short
 *   Short       → short
 *   Reel        → reel
 *   Video Pin   → video_pin
 *
 * Case-insensitive, trim-safe, separator-agnostic (space/underscore/hyphen),
 * and fail-closed: an unknown value canonicalizes to '' so it matches nothing.
 */

export type CanonicalVideoFormat = 'video' | 'short' | 'reel' | 'video_pin' | '';

export function canonicalVideoFormat(value: unknown): CanonicalVideoFormat {
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  switch (v) {
    case 'long video':
    case 'video':
      return 'video';
    case 'short video':
    case 'short':
      return 'short';
    case 'reel':
    case 'reels':
      return 'reel';
    case 'video pin':
    case 'pin':
      return 'video_pin';
    default:
      return ''; // fail-closed — unknown formats match nothing
  }
}

/** True when both values canonicalize to the same non-empty code. */
export function sameCanonicalVideoFormat(a: unknown, b: unknown): boolean {
  const ca = canonicalVideoFormat(a);
  return ca !== '' && ca === canonicalVideoFormat(b);
}
