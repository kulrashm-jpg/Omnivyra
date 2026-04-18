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
  'whatsapp',
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
  whatsapp: 'WhatsApp Business',
  blog: 'Blog',
};

/** Normalize a platform string to its canonical lowercase form. */
const PLATFORM_ALIASES: Record<string, string> = {
  li: 'linkedin', fb: 'facebook', ig: 'instagram', tw: 'twitter',
  x: 'twitter', meta: 'facebook', 'twitter/x': 'twitter',
};

export function normalizePlatform(platform: string | null | undefined): string {
  const key = String(platform ?? '').trim().toLowerCase();
  return PLATFORM_ALIASES[key] ?? key;
}

/** UI option shape: label + canonical value. */
export const PLATFORM_OPTIONS = CANONICAL_PLATFORMS.map((value) => ({
  label: PLATFORM_LABELS[value],
  value,
}));
