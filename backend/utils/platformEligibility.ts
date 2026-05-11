/**
 * Platform Eligibility and Priority
 *
 * Derives available platforms from company profile (social_links).
 * Defines content-type affinity and platform priority for BOLT distribution.
 */

import type { CompanyProfile } from '../services/companyProfileService';
import { supabase } from '../db/supabaseClient';
import { PLATFORM_CAPABILITY_REGISTRY } from '../../lib/shared/social/platformCapabilities';
import { normalizeContentCapability } from '../../lib/shared/social/contentCapability';

const PLATFORM_URL_KEYS: Record<string, keyof CompanyProfile> = {
  linkedin: 'linkedin_url',
  facebook: 'facebook_url',
  instagram: 'instagram_url',
  youtube: 'youtube_url',
  x: 'x_url',
  twitter: 'x_url',
  tiktok: 'tiktok_url',
  reddit: 'reddit_url',
  pinterest: 'pinterest_url',
  whatsapp: 'whatsapp_url',
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
  'pinterest',
  'whatsapp',
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
 * Content-type → platform affinity (which platforms suit which content).
 *
 * DERIVED (Round-2 Phase 1). This used to be a hand-maintained matrix that
 * disagreed with the canonical capability registry (e.g. it listed Instagram
 * under `post`, which is text-only). It is now computed at module load from
 * `PLATFORM_CAPABILITY_REGISTRY` via `normalizeContentCapability`, so the
 * registry is the single source of truth and this constant cannot drift.
 *
 * Consumers (boltPipelineService ranking, companyPlatformService content-type
 * enumeration) keep their existing call sites; they just now see registry-
 * correct values.
 */
const KNOWN_CONTENT_TYPES = [
  'post', 'tweet', 'feed_post', 'article', 'blog', 'newsletter',
  'short_story', 'white_paper', 'video', 'reel', 'short', 'story',
  'carousel', 'poll', 'thread', 'idea_pin',
] as const;

function buildContentPlatformAffinity(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const contentType of KNOWN_CONTENT_TYPES) {
    const capability = normalizeContentCapability({ contentType });
    if (!capability) continue;
    const platforms: string[] = [];
    for (const [key, cfg] of Object.entries(PLATFORM_CAPABILITY_REGISTRY)) {
      if (cfg.supportedContent.includes(capability)) platforms.push(key);
    }
    out[contentType] = sortPlatformsByPriority(platforms);
  }
  return out;
}

export const CONTENT_PLATFORM_AFFINITY: Record<string, string[]> = buildContentPlatformAffinity();

/**
 * Max platforms per content piece for multi-platform posting.
 */
export const MAX_PLATFORMS_PER_CONTENT = 3;

/**
 * "Connected at company admin level" platforms for a company.
 *
 * Source of truth is `social_accounts` (active OAuth-backed rows) — the same
 * signal the admin UI uses for the Connected badge. Falls back to profile URL
 * fields via `getAvailablePlatformsFromProfile` when no OAuth rows exist, so
 * pre-OAuth setups (just URLs) still produce a non-empty platform list.
 *
 * Both the BOLT picker endpoint and the BOLT pipeline should use this helper so
 * they agree on which platforms count as available for a campaign.
 */
export async function getConnectedPlatformsForCompany(
  companyId: string,
  profile?: CompanyProfile | null
): Promise<string[]> {
  if (!companyId) return [];

  try {
    const { data } = await supabase
      .from('social_accounts')
      .select('platform')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%');

    const seen = new Set<string>();
    const connected: string[] = [];
    for (const row of data ?? []) {
      const norm = String((row as { platform?: string }).platform ?? '')
        .trim()
        .toLowerCase()
        .replace(/^twitter$/i, 'x');
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      connected.push(norm);
    }
    if (connected.length > 0) return sortPlatformsByPriority(connected);
  } catch { /* fall through to profile-URL source */ }

  return profile ? getAvailablePlatformsFromProfile(profile) : [];
}

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
