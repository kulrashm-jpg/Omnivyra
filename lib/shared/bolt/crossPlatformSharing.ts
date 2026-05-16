/**
 * BOLT Creator — Cross-Platform Sharing Eligibility
 * ──────────────────────────────────────────────────────────────────────────
 *
 * THIS IS NOT A CAPABILITY MATRIX.
 *
 * The platform × content capability registry lives in
 *   `lib/shared/social/platformCapabilities.ts`
 * and is the SOLE authority for "can platform X publish capability Y?"
 *
 * This module answers a different question entirely:
 *
 *   "Which CREATOR FORMATS can be replicated across 2+ platforms in a single
 *   campaign brief, vs. those that are platform-specific by nature?"
 *
 * Examples:
 *   - A Reel can run on Instagram + Facebook + TikTok from one brief        → eligible
 *   - A Story is generally platform-specific (24h, vertical, platform UX)   → eligible (legacy treatment)
 *   - Carousel, Short, Video                                                → eligible
 *   - Image, Podcast                                                        → NOT eligible (cross-platform
 *     replication of a static asset is just one upload; podcasts are
 *     distribution-channel-specific feeds)
 *
 * The BOLT Creator strategy form uses this to enable/disable the "Shared"
 * Content Sharing mode — it has nothing to do with whether the platform's
 * API can accept the content type. That decision routes through the
 * canonical registry.
 *
 * Round-7 Phase 2: extracted from three duplicated inline declarations
 * (useBoltCreator.tsx, BoltCreatorView.tsx, bolt-creator-strategy.tsx)
 * into this single source of truth. Adding a new creator format requires a
 * one-line change here.
 */

export type CrossPlatformShareableCreatorFormat =
  | 'video'
  | 'reel'
  | 'short'
  | 'carousel'
  | 'image'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

// Image-class assets (image / banner / infographic / pdf / slider) ARE
// cross-platform shareable: the same banner or infographic uploaded to
// LinkedIn + Instagram + Facebook from a single brief is the user's
// intent. The earlier exclusion ("one upload isn't really sharing")
// blocked the Shared mode whenever any image-class format was picked.
export const FORMATS_SUPPORTING_CROSS_PLATFORM: ReadonlySet<CrossPlatformShareableCreatorFormat> =
  new Set<CrossPlatformShareableCreatorFormat>([
    'video',
    'reel',
    'short',
    'carousel',
    'image',
    'banner',
    'infographic',
    'pdf',
    'slider',
  ]);

/**
 * Type guard — accepts any string and reports whether it identifies a
 * creator format eligible for cross-platform sharing. Use this from call
 * sites that hold weaker `string`-typed content formats (e.g. when the
 * format originates from external configuration).
 */
export function isCrossPlatformShareableFormat(
  format: string,
): format is CrossPlatformShareableCreatorFormat {
  return FORMATS_SUPPORTING_CROSS_PLATFORM.has(format as CrossPlatformShareableCreatorFormat);
}
