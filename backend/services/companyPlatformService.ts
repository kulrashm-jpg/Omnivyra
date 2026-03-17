/**
 * Backend company platform configuration service.
 * Returns platforms with content types for campaign planner PlatformContentMatrix.
 * Sources: (1) company profile social_links, (2) external API configs (social-platforms page).
 */

import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';
import {
  getAvailablePlatformsFromProfile,
  CONTENT_PLATFORM_AFFINITY,
  sortPlatformsByPriority,
} from '../utils/platformEligibility';
import { getSocialPostingConfigs } from './externalApiService';

export type PlatformConfigItem = {
  platform: string;
  content_types: string[];
};

export type CompanyPlatformConfigResult = {
  platforms: PlatformConfigItem[];
};

function toDisplayPlatform(p: string): string {
  const n = String(p).toLowerCase();
  if (n === 'x') return 'twitter';
  return n;
}

function getContentTypesForPlatform(platform: string): string[] {
  const p = platform.toLowerCase().replace(/^twitter$/i, 'x');
  const types = new Set<string>();
  for (const [ct, platforms] of Object.entries(CONTENT_PLATFORM_AFFINITY)) {
    const normalized = platforms.map((pl) => pl.toLowerCase().replace(/^twitter$/i, 'x'));
    if (normalized.includes(p)) types.add(ct);
  }
  const fallbacks: Record<string, string[]> = {
    linkedin:  ['post', 'article', 'blog', 'carousel', 'video', 'poll', 'newsletter'],
    youtube:   ['video', 'short'],
    twitter:   ['post', 'thread', 'poll'],
    x:         ['post', 'thread', 'poll'],
    instagram: ['post', 'reel', 'story', 'carousel'],
    facebook:  ['post', 'video', 'story', 'carousel', 'blog'],
    tiktok:    ['video', 'short'],
    reddit:    ['post', 'thread'],
    pinterest: ['post', 'idea_pin'],
    medium:    ['post', 'article', 'blog', 'newsletter'],
    devto:     ['post', 'article', 'blog'],
    blog:      ['post', 'article', 'blog'],
  };
  const fb = fallbacks[p] ?? ['post'];
  fb.forEach((t) => types.add(t));
  return Array.from(types).sort();
}

/** Extract platform key from external API config (category or name). */
function platformFromApiConfig(config: { category?: string | null; name?: string | null }): string | null {
  const cat = (config.category ?? '').toString().toLowerCase().trim();
  if (cat && /^(linkedin|facebook|instagram|youtube|x|twitter|tiktok|reddit|blog)$/.test(cat)) {
    return cat === 'twitter' ? 'x' : cat;
  }
  const name = (config.name ?? '').toString().toLowerCase();
  const match = name.match(/(linkedin|facebook|instagram|youtube|twitter|x|tiktok|reddit|blog)/i);
  if (match) {
    const p = match[1].toLowerCase();
    return p === 'twitter' ? 'x' : p;
  }
  return null;
}

/**
 * Get company platform configuration for planner.
 * Priority: (1) company profile social_links, (2) external API configs as fallback.
 * Content types per platform: user-configured prefs (platform_content_type_prefs) take precedence over defaults.
 * Returns empty platforms array when no platforms configured or on error.
 */
export async function getCompanyPlatformConfig(
  companyId: string
): Promise<CompanyPlatformConfigResult> {
  const seen = new Set<string>();
  const items: PlatformConfigItem[] = [];
  let userContentPrefs: Record<string, string[]> = {};

  // 0. Load user-configured content type prefs
  try {
    const { data } = await supabase
      .from('company_profiles')
      .select('platform_content_type_prefs')
      .eq('company_id', companyId)
      .maybeSingle();
    if (data?.platform_content_type_prefs && typeof data.platform_content_type_prefs === 'object') {
      userContentPrefs = data.platform_content_type_prefs as Record<string, string[]>;
    }
  } catch { /* non-fatal */ }

  const applyUserPrefs = (platform: string, defaults: string[]): string[] => {
    const canonical = platform.toLowerCase().replace(/^twitter$/i, 'x');
    const prefs = userContentPrefs[canonical] ?? userContentPrefs[platform.toLowerCase()];
    if (Array.isArray(prefs) && prefs.length > 0) return prefs;
    return defaults;
  };

  // 1. Company profile social links
  try {
    const profile = await getProfile(companyId);
    const profilePlatforms = getAvailablePlatformsFromProfile(profile);
    for (const p of profilePlatforms) {
      const canonical = p.toLowerCase().replace(/^twitter$/i, 'x');
      if (!seen.has(canonical)) {
        seen.add(canonical);
        items.push({
          platform: toDisplayPlatform(p),
          content_types: applyUserPrefs(p, getContentTypesForPlatform(p)),
        });
      }
    }
  } catch (err) {
    console.warn('[companyPlatformService] getProfile failed:', (err as Error)?.message);
  }

  // 2. External API configs (social-platforms page) as fallback when profile has none
  if (items.length === 0) {
    try {
      const configs = await getSocialPostingConfigs(companyId);
      for (const c of configs) {
        const p = platformFromApiConfig(c);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        const defaults = Array.isArray(c.supported_content_types) && c.supported_content_types.length > 0
          ? c.supported_content_types.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
          : getContentTypesForPlatform(p);
        items.push({
          platform: toDisplayPlatform(p),
          content_types: applyUserPrefs(p, defaults.length > 0 ? [...new Set(defaults)].sort() : getContentTypesForPlatform(p)),
        });
      }
    } catch (err) {
      console.warn('[companyPlatformService] getSocialPostingConfigs failed:', (err as Error)?.message);
    }
  }

  const canonicalKeys = items.map((i) => (i.platform === 'twitter' ? 'x' : i.platform.toLowerCase()));
  const sorted = sortPlatformsByPriority(canonicalKeys);
  return {
    platforms: sorted
      .map((p) => items.find((i) => (i.platform === 'twitter' ? 'x' : i.platform.toLowerCase()) === p))
      .filter((x): x is PlatformConfigItem => !!x),
  };
}

/** Community AI connector platform keys (have OAuth flows). */
const CONNECTOR_SUPPORTED = new Set(['linkedin', 'meta', 'facebook', 'instagram', 'whatsapp', 'twitter', 'reddit', 'x']);

const CONNECTOR_DISPLAY_NAMES: Record<string, string> = {
  linkedin:  'LinkedIn',
  meta:      'Meta (Facebook · Instagram · WhatsApp)',
  facebook:  'Facebook',
  instagram: 'Instagram',
  whatsapp:  'WhatsApp',
  twitter:   'Twitter',
  x:         'Twitter',
  reddit:    'Reddit',
};

/** G6.2/G6.3: Platforms enabled globally via .env (no per-company config). */
function getGloballyEnabledPlatforms(): { platform: string; displayName: string }[] {
  const env = process.env;
  const result: { platform: string; displayName: string }[] = [];

  if (env['LINKEDIN_CLIENT_ID']?.trim()) {
    result.push({ platform: 'linkedin', displayName: CONNECTOR_DISPLAY_NAMES.linkedin });
  }
  // Facebook App covers Facebook + Instagram + WhatsApp — show as one Meta entry
  if (env['FACEBOOK_CLIENT_ID']?.trim()) {
    result.push({ platform: 'meta', displayName: CONNECTOR_DISPLAY_NAMES.meta });
  }
  if (env['TWITTER_CLIENT_ID']?.trim()) {
    result.push({ platform: 'twitter', displayName: CONNECTOR_DISPLAY_NAMES.twitter });
  }
  if (env['REDDIT_CLIENT_ID']?.trim()) {
    result.push({ platform: 'reddit', displayName: CONNECTOR_DISPLAY_NAMES.reddit });
  }
  return result;
}

/**
 * Get platforms configured for the company that have Community AI connectors.
 * Merges: (0) G6.2/G6.3 global .env config, (1) company profile, (2) Social Platforms page.
 * New companies see enabled platforms from global config without prior setup.
 */
export async function getCompanyConfiguredPlatformsForConnectors(
  companyId: string
): Promise<{ platform: string; displayName: string }[]> {
  const seen = new Set<string>();
  const result: { platform: string; displayName: string }[] = [];

  // 0. G6.2/G6.3: Global OAuth config (.env) — new companies see these immediately
  for (const { platform, displayName } of getGloballyEnabledPlatforms()) {
    const canonical = (platform === 'twitter' ? 'x' : platform).toLowerCase();
    if (!CONNECTOR_SUPPORTED.has(canonical) || seen.has(canonical)) continue;
    seen.add(canonical);
    const connectorKey = canonical === 'x' ? 'twitter' : canonical;
    result.push({ platform: connectorKey, displayName });
  }

  // 1. Company profile social links
  try {
    const profile = await getProfile(companyId);
    const profilePlatforms = getAvailablePlatformsFromProfile(profile);
    for (const p of profilePlatforms) {
      const canonical = (p === 'twitter' ? 'x' : p).toLowerCase();
      if (!CONNECTOR_SUPPORTED.has(canonical) || seen.has(canonical)) continue;
      seen.add(canonical);
      const connectorKey = canonical === 'x' ? 'twitter' : canonical;
      result.push({ platform: connectorKey, displayName: CONNECTOR_DISPLAY_NAMES[connectorKey] ?? connectorKey });
    }
  } catch (err) {
    console.warn('[companyPlatformService] getProfile failed:', (err as Error)?.message);
  }

  // 2. Social Platforms page (external_api_sources) - company-scoped, merge
  try {
    const configs = await getSocialPostingConfigs(companyId);
    for (const c of configs) {
      const p = platformFromApiConfig(c);
      if (!p) continue;
      const canonical = (p === 'twitter' ? 'x' : p).toLowerCase();
      if (!CONNECTOR_SUPPORTED.has(canonical) || seen.has(canonical)) continue;
      seen.add(canonical);
      const connectorKey = canonical === 'x' ? 'twitter' : canonical;
      result.push({ platform: connectorKey, displayName: CONNECTOR_DISPLAY_NAMES[connectorKey] ?? connectorKey });
    }
  } catch (err) {
    console.warn('[companyPlatformService] getSocialPostingConfigs failed:', (err as Error)?.message);
  }

  // 3. Platform-scoped configs - merge so Connectors matches what Configured Platforms shows when admin uses scope=platform
  try {
    const platformConfigs = await getSocialPostingConfigs(null, { platformScope: true });
    for (const c of platformConfigs) {
      const p = platformFromApiConfig(c);
      if (!p) continue;
      const canonical = (p === 'twitter' ? 'x' : p).toLowerCase();
      if (!CONNECTOR_SUPPORTED.has(canonical) || seen.has(canonical)) continue;
      seen.add(canonical);
      const connectorKey = canonical === 'x' ? 'twitter' : canonical;
      result.push({ platform: connectorKey, displayName: CONNECTOR_DISPLAY_NAMES[connectorKey] ?? connectorKey });
    }
  } catch (err) {
    console.warn('[companyPlatformService] platform-scoped getSocialPostingConfigs failed:', (err as Error)?.message);
  }

  const order = ['linkedin', 'meta', 'twitter', 'reddit'];
  return result.sort((a, b) => {
    const ia = order.indexOf(a.platform);
    const ib = order.indexOf(b.platform);
    return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999);
  });
}
