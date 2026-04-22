/**
 * Platform emoji icon lookup.
 * Consolidates the 4 identical PLATFORM_ICONS emoji maps from engagement components.
 */
export const PLATFORM_EMOJI_ICONS: Record<string, string> = {
  linkedin: '💼',
  twitter: '𝕏',
  x: '𝕏',
  youtube: '▶️',
  reddit: '🤖',
  slack: '💬',
  facebook: '📘',
  instagram: '📷',
  tiktok: '🎵',
  pinterest: '📌',
  blog: '📝',
};

/** Get emoji icon for a platform. Falls back to 🌐. */
export function getPlatformEmoji(platform: string): string {
  return PLATFORM_EMOJI_ICONS[(platform || '').toLowerCase()] ?? '🌐';
}
