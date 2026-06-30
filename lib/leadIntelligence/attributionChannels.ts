/**
 * Repository-owned channel classification (single source of truth).
 *
 * Pure, side-effect-free referrer/UTM → channel classifier. Relocated from
 * attributionDiagnosticsService so the Canonical Lead Intelligence Repository owns
 * channel semantics; the diagnostics service re-exports these for back-compat.
 * Semantics are UNCHANGED: organic_search / paid / direct / social / referral /
 * email / internal / unknown.
 */

export type ReferrerClass =
  | 'direct'
  | 'organic_search'
  | 'paid'
  | 'social'
  | 'email'
  | 'referral'
  | 'internal'
  | 'unknown';

export const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.', 'baidu.', 'ecosia.'];
export const SOCIAL_HOSTS = ['facebook.', 'instagram.', 't.co', 'twitter.', 'x.com', 'linkedin.', 'pinterest.', 'reddit.', 'youtube.', 'tiktok.'];

export function classifyReferrer(input: {
  referrer?: string | null;
  utmMedium?: string | null;
  utmSource?: string | null;
  selfHost?: string | null;
}): ReferrerClass {
  const medium = (input.utmMedium || '').toLowerCase();
  if (medium) {
    if (/cpc|ppc|paid|paidsearch|display|cpm/.test(medium)) return 'paid';
    if (/email|newsletter/.test(medium)) return 'email';
    if (/social|social-paid|paid-social/.test(medium)) return 'social';
    if (/organic/.test(medium)) return 'organic_search';
    if (/referral/.test(medium)) return 'referral';
  }
  const ref = (input.referrer || '').toLowerCase();
  if (!ref) return input.utmSource ? 'referral' : 'direct';
  let host = '';
  try {
    host = new URL(ref.startsWith('http') ? ref : `https://${ref}`).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (input.selfHost && host.endsWith(input.selfHost.toLowerCase())) return 'internal';
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return 'organic_search';
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return 'social';
  return 'referral';
}

/** Empty channel breakdown with the canonical key ordering preserved. */
export function emptyChannelBreakdown(): Record<ReferrerClass, number> {
  return { direct: 0, organic_search: 0, paid: 0, social: 0, email: 0, referral: 0, internal: 0, unknown: 0 };
}
