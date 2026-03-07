/**
 * Global platform icon registry.
 * Uses react-icons (no image URLs) so icons never break.
 */

import {
  FaLinkedin,
  FaFacebook,
  FaInstagram,
  FaYoutube,
  FaPinterest,
  FaReddit,
  FaShareAlt,
} from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';
import { SiTiktok, SiThreads } from 'react-icons/si';
import type { IconType } from 'react-icons';

export const PLATFORM_ICONS: Record<string, IconType> = {
  linkedin: FaLinkedin,
  facebook: FaFacebook,
  twitter: FaXTwitter,
  x: FaXTwitter,
  instagram: FaInstagram,
  youtube: FaYoutube,
  tiktok: SiTiktok,
  pinterest: FaPinterest,
  reddit: FaReddit,
  threads: SiThreads,
};

export const FALLBACK_ICON = FaShareAlt;

const ALIASES: Record<string, string> = {
  li: 'linkedin',
  linkedin: 'linkedin',
  fb: 'facebook',
  facebook: 'facebook',
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  yt: 'youtube',
  youtube: 'youtube',
  x: 'twitter',
  twitter: 'twitter',
  tt: 'tiktok',
  tiktok: 'tiktok',
  pinterest: 'pinterest',
  reddit: 'reddit',
  threads: 'threads',
};

/**
 * Normalize platform input to canonical key (handles LinkedIn, LI, fb, X, etc.).
 */
export function normalizePlatform(platform?: string): string {
  const key = (platform || '').toLowerCase().trim();
  return ALIASES[key] ?? key;
}

/**
 * Returns the icon component for a platform. Uses FALLBACK_ICON when not found.
 */
export function getPlatformIcon(platform: string): IconType {
  const key = normalizePlatform(platform);
  return PLATFORM_ICONS[key] ?? FALLBACK_ICON;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitter: 'X',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  threads: 'Threads',
};

/**
 * Human-readable label for display next to icon (e.g. "X" for twitter/x).
 */
export function getPlatformLabel(platform: string): string {
  const key = normalizePlatform(platform);
  return PLATFORM_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');
}
