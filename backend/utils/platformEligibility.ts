/**
 * Platform Eligibility and Priority
 *
 * Derives available platforms from company profile (social_links).
 * Defines content-type affinity and platform priority for BOLT distribution.
 */

import type { CompanyProfile } from '../services/companyProfileService';

const PLATFORM_URL_KEYS: Record<string, keyof CompanyProfile> = {
  linkedin: 'linkedin_url',
  facebook: 'facebook_url',
  instagram: 'instagram_url',
  youtube: 'youtube_url',
  x: 'x_url',
  twitter: 'x_url',
  tiktok: 'tiktok_url',
  reddit: 'reddit_url',
};

/**
 * Extract available platforms from company profile.
 * A platform is available if the corresponding URL exists and is non-empty.
 */
export function getAvailablePlatformsFromProfile(profile: CompanyProfile | null | undefined): string[] {
  if (!profile) return [];

  const available: string[] = [];
  const seen = new Set<string>();

  for (const [platform, key] of Object.entries(PLATFORM_URL_KEYS)) {
    if (seen.has(platform)) continue;
    const url = profile[key];
    const hasUrl = typeof url === 'string' && url.trim().length > 0;
    if (hasUrl) {
      const canonical = platform === 'twitter' ? 'x' : platform;
      if (!seen.has(canonical)) {
        seen.add(canonical);
        available.push(canonical);
      }
    }
  }

  if (Array.isArray(profile.social_profiles) && profile.social_profiles.length > 0) {
    for (const sp of profile.social_profiles) {
      const p = String(sp?.platform ?? '').toLowerCase().replace(/^twitter$/i, 'x').trim();
      if (p && !seen.has(p)) {
        seen.add(p);
        available.push(p);
      }
    }
  }

  // Only return platforms configured for the company; never add unconfigured platforms.
  return available.length > 0 ? sortPlatformsByPriority(available) : [];
}

/**
 * Platform priority for distribution (primary → secondary).
 * LinkedIn: posts, articles. Instagram: stories. Facebook: secondary posts. YouTube: long-form video.
 */
const PLATFORM_PRIORITY_ORDER = [
  'linkedin',
  'instagram',
  'facebook',
  'youtube',
  'x',
  'tiktok',
  'reddit',
];

export function sortPlatformsByPriority(platforms: string[]): string[] {
  const normalized = platforms.map((p) => String(p).toLowerCase().replace(/^twitter$/i, 'x'));
  return [...normalized].sort((a, b) => {
    const ia = PLATFORM_PRIORITY_ORDER.indexOf(a);
    const ib = PLATFORM_PRIORITY_ORDER.indexOf(b);
    const ai = ia >= 0 ? ia : PLATFORM_PRIORITY_ORDER.length;
    const bi = ib >= 0 ? ib : PLATFORM_PRIORITY_ORDER.length;
    return ai - bi;
  });
}

/**
 * Content-type to platform affinity (which platforms suit which content).
 * Used for multi-platform posting eligibility.
 */
export const CONTENT_PLATFORM_AFFINITY: Record<string, string[]> = {
  post: ['linkedin', 'facebook', 'instagram', 'x'],
  article: ['linkedin', 'facebook'],
  blog: ['linkedin', 'facebook'],
  video: ['youtube', 'facebook', 'instagram', 'linkedin'],
  reel: ['instagram', 'facebook'],
  short: ['youtube', 'instagram', 'facebook', 'tiktok'],
  story: ['instagram', 'facebook'],
  carousel: ['instagram', 'linkedin', 'facebook'],
  poll: ['linkedin', 'facebook', 'instagram', 'x'],
};

/**
 * Max platforms per content piece for multi-platform posting.
 */
export const MAX_PLATFORMS_PER_CONTENT = 3;

/**
 * Filter platforms to only those available in the company profile.
 */
export function filterToAvailablePlatforms(
  platforms: string[],
  available: string[]
): string[] {
  const set = new Set(available.map((p) => p.toLowerCase().replace(/^twitter$/i, 'x')));
  return platforms.filter((p) => set.has(p.toLowerCase().replace(/^twitter$/i, 'x')));
}
