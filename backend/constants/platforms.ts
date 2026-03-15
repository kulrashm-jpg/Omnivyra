/**
 * Canonical platform taxonomy.
 * UI and backend must import this constant to ensure consistency.
 * Aligned with platform_registry table (database/platform_registry.sql).
 */
export const CANONICAL_PLATFORMS = [
  'linkedin',
  'twitter',
  'youtube',
  'reddit',
  'facebook',
  'instagram',
  'tiktok',
  'blog',
] as const;

export type CanonicalPlatform = (typeof CANONICAL_PLATFORMS)[number];

/** Display labels for UI. Map canonical value → label. */
export const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  x: 'X',
  youtube: 'YouTube',
  reddit: 'Reddit',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  blog: 'Blog',
};

/** UI option shape: label + canonical value. */
export const PLATFORM_OPTIONS = CANONICAL_PLATFORMS.map((value) => ({
  label: PLATFORM_LABELS[value],
  value,
}));
