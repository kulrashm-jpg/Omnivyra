/**
 * Public research — the external digital footprint: official social profiles, independent mentions
 * and review listings. Owned profiles are never counted as independent endorsement, and a mention is
 * not a backlink.
 *
 * Profiles: each declared or homepage-linked profile is fetched (SSRF-safe) once, logged out. Its
 * state is the strongest one the evidence supports:
 *   identity_confirmed  the page names the brand AND links to its domain
 *   domain_linked       the page links to the domain
 *   fetched             the page answered but neither was shown
 *   inaccessible        login wall / bot wall / HTTP error / transport failure (reason recorded)
 *   declared_unverified listed by the company, not fetched
 * A platform that blocks logged-out viewing is "inaccessible", never "not found".
 *
 * Mentions and reviews: one web-search call (OpenAI, Claude fallback) returns third-party pages that
 * mention the brand and the review platforms it checked; every page is re-opened and kept as
 * confirmed only if it actually names the brand.
 */
import { readCapped, safeFetch } from '../../../../lib/security/safeFetch';
import { webJsonCompletion } from './llm';

export type ProfileState = 'identity_confirmed' | 'domain_linked' | 'fetched' | 'inaccessible' | 'declared_unverified';

export type ProfileCheck = {
  platform: string;
  url: string;
  declared: boolean;
  onHomepage: boolean;
  inSameAs: boolean;
  attempted: boolean;
  httpStatus: number | null;
  outcome: 'responded' | 'login_wall' | 'http_error' | 'transport_failed' | 'not_attempted';
  namesBrand: boolean | null;
  linksDomain: boolean | null;
  /**
   * Posts visible to a signed-out visitor, read from the page's own structured data (datePublished).
   * A sample, not the platform's full history.
   */
  posts: { count: number; newest: string | null; oldest: string | null } | null;
  /** The page text around the website match, kept so a confirmation can be audited later. */
  evidence?: string | null;
  state: ProfileState;
  reason: string | null;
  checkedAt: string;
};

const PLATFORMS: Array<[RegExp, string]> = [
  [/linkedin\.com/i, 'LinkedIn'], [/(^|\.)x\.com|twitter\.com/i, 'X'], [/facebook\.com/i, 'Facebook'],
  [/instagram\.com/i, 'Instagram'], [/youtube\.com|youtu\.be/i, 'YouTube'], [/tiktok\.com/i, 'TikTok'], [/pinterest\./i, 'Pinterest'],
];
export const platformOf = (url: string): string | null => {
  try { const h = new URL(url).hostname; return PLATFORMS.find(([re]) => re.test(h))?.[1] ?? null; } catch { return null; }
};

/** One canonical form per profile, so "linkedin.com/company/x" and "www.linkedin.com/company/x/" are one. */
export const canonicalProfile = (url: string): string => {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `https://${u.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch { return url.trim().toLowerCase(); }
};

/** Dated posts the page itself publishes in its structured data; null when it shows none. */
export function postSample(html: string): ProfileCheck['posts'] {
  const dates = [...html.matchAll(/"(?:datepublished|uploaddate)"\s*:\s*"(\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1]).sort();
  return dates.length ? { count: dates.length, newest: dates[dates.length - 1], oldest: dates[0] } : null;
}

const LOGIN_WALL = /(authwall|sign in to (see|view)|log in to (see|view|continue)|join linkedin|login\.(php|jsp)|"loginForm"|you need to log in)/i;

export async function checkProfiles(
  brand: string,
  domain: string,
  sources: { declared: string[]; homepage: string[]; sameAs: string[] },
  timeoutMs = 15_000,
): Promise<ProfileCheck[]> {
  const byKey = new Map<string, { url: string; declared: boolean; onHomepage: boolean; inSameAs: boolean }>();
  const add = (url: string, field: 'declared' | 'onHomepage' | 'inSameAs') => {
    if (!platformOf(url)) return;
    const key = canonicalProfile(url);
    const entry = byKey.get(key) ?? { url, declared: false, onHomepage: false, inSameAs: false };
    entry[field] = true;
    byKey.set(key, entry);
  };
  sources.declared.forEach((u) => add(u, 'declared'));
  sources.homepage.forEach((u) => add(u, 'onHomepage'));
  sources.sameAs.forEach((u) => add(u, 'inSameAs'));

  const own = domain.replace(/^www\./, '').toLowerCase();
  return Promise.all([...byKey.values()].map(async (p): Promise<ProfileCheck> => {
    const checkedAt = new Date().toISOString();
    const base = { platform: platformOf(p.url) ?? 'Other', url: p.url, declared: p.declared, onHomepage: p.onHomepage, inSameAs: p.inSameAs, checkedAt };
    try {
      const res = await safeFetch(p.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0)', 'accept-language': 'en' } },
        { timeoutMs, maxBytes: 3_000_000, metricLabel: 'public_research_profile' });
      const body = (await readCapped(res, 3_000_000)).toString('utf8').toLowerCase();
      const namesBrand = body.includes(brand.toLowerCase());
      const linksDomain = body.includes(own);
      const at = body.indexOf(own);
      const evidence = at >= 0 ? body.slice(Math.max(0, at - 80), at + own.length + 40).replace(/\s+/g, ' ') : null;
      if (res.status === 999 || res.status === 401 || (res.status === 403 && !namesBrand) || (LOGIN_WALL.test(body) && !namesBrand)) {
        return { ...base, attempted: true, httpStatus: res.status, outcome: 'login_wall', namesBrand: null, linksDomain: null, posts: null, state: 'inaccessible',
          reason: `The platform requires sign-in or blocks automated viewing (HTTP ${res.status}); the profile was not read.` };
      }
      if (res.status >= 400) {
        return { ...base, attempted: true, httpStatus: res.status, outcome: 'http_error', namesBrand: null, linksDomain: null, posts: null, state: 'inaccessible', reason: `HTTP ${res.status}` };
      }
      const state: ProfileState = namesBrand && linksDomain ? 'identity_confirmed' : linksDomain ? 'domain_linked' : 'fetched';
      return { ...base, attempted: true, httpStatus: res.status, outcome: 'responded', namesBrand, linksDomain, evidence, posts: postSample(body), state,
        reason: state === 'fetched' ? 'The page answered but did not show the brand name and website together to a logged-out visitor.' : null };
    } catch (error) {
      return { ...base, attempted: true, httpStatus: null, outcome: 'transport_failed', namesBrand: null, linksDomain: null, posts: null, state: 'inaccessible',
        reason: `Request failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}` };
    }
  }));
}

export type MentionType = 'directory' | 'review' | 'press' | 'partner_or_customer' | 'comparison' | 'community' | 'other';
export type Mention = { url: string; title: string; type: MentionType; check: 'confirmed' | 'unconfirmed' };
/** A post on a social platform naming the brand. Never counted as independent: authorship cannot be verified signed out. */
export type SocialPost = { url: string; title: string; platform: string; fromOwnAccount: boolean };

/** The account handle in a profile URL (linkedin.com/company/acme -> "acme"). */
const handleOf = (url: string): string | null => {
  try { const seg = new URL(url).pathname.split('/').filter(Boolean); return (seg[seg.length - 1] ?? '').toLowerCase() || null; } catch { return null; }
};
/**
 * listed — a listing page that names the brand was opened; claimed_unconfirmed — search reported a
 * listing but its page could not be opened or did not name the brand (many review sites block
 * automated reads); not_found_in_search — the search looked and reported none.
 */
export type PlatformCheck = { platform: string; state: 'listed' | 'claimed_unconfirmed' | 'not_found_in_search'; url: string };

const MENTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mentions', 'platforms'],
  properties: {
    mentions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'title', 'type'],
      properties: { url: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: ['directory', 'review', 'press', 'partner_or_customer', 'comparison', 'community', 'other'] } } } },
    platforms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['platform', 'found', 'url'],
      properties: { platform: { type: 'string' }, found: { type: 'boolean' }, url: { type: 'string' } } } },
  },
};

const REVIEW_PLATFORMS = ['G2', 'Capterra', 'Product Hunt', 'Trustpilot', 'Crunchbase', 'SaaSworthy'];

/**
 * Third-party pages that mention the brand, and whether it is listed on the review / directory
 * platforms that matter for software. Owned domains and owned social profiles are excluded.
 */
export async function findIndependentMentions(
  subject: { brand: string; domain: string; offering: string },
  ownedUrls: string[],
  timeoutMs = 120_000,
): Promise<{ mentions: Mention[]; socialPosts: SocialPost[]; platforms: PlatformCheck[]; provider: string | null; searches: string[] }> {
  const own = subject.domain.replace(/^www\./, '').toLowerCase();
  const owned = new Set(ownedUrls.map(canonicalProfile));
  const prompt = `Use web search. Find third-party web pages (not ${subject.domain} and not the company's own social profiles) that mention the company "${subject.brand}" (${subject.domain}), which sells: ${subject.offering}. Beware of similarly named companies — include a page only if it is about THIS company.
Also check whether it has a listing on each of these platforms: ${REVIEW_PLATFORMS.join(', ')}; report found true only with the listing URL.
Return up to 10 mentions with the exact page URL, its title and its type.`;
  const r = await webJsonCompletion('mentions', prompt, { name: 'mentions', schema: MENTION_SCHEMA }, { timeoutMs }).catch(() => null);
  if (!r) return { mentions: [], socialPosts: [], platforms: [], provider: null, searches: [] };
  const brandLc = subject.brand.toLowerCase();
  const check = async (url: string) => {
    try {
      const res = await safeFetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0)' } }, { timeoutMs: 15_000, maxBytes: 2_000_000, metricLabel: 'public_research_mention' });
      if (!res.ok) return 'unconfirmed' as const;
      return (await readCapped(res, 2_000_000)).toString('utf8').toLowerCase().includes(brandLc) ? 'confirmed' as const : 'unconfirmed' as const;
    } catch { return 'unconfirmed' as const; }
  };
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const raw: any[] = (Array.isArray(r.json?.mentions) ? r.json.mentions : [])
    .filter((m: any) => typeof m?.url === 'string' && /^https?:\/\//.test(m.url))
    .filter((m: any) => { const h = hostOf(m.url); return h !== own && !h.endsWith(`.${own}`) && !owned.has(canonicalProfile(m.url)); });
  // Social-platform pages are posts, not independent coverage; posts under an owned handle are the company's own.
  const handles = new Set(ownedUrls.map(handleOf).filter((h): h is string => Boolean(h && h.length > 2)));
  const socialPosts: SocialPost[] = raw.filter((m) => platformOf(m.url)).map((m) => {
    const path = (() => { try { return new URL(m.url).pathname.toLowerCase(); } catch { return ''; } })();
    return { url: m.url, title: String(m.title ?? '').slice(0, 160), platform: platformOf(m.url)!, fromOwnAccount: [...handles].some((h) => path.includes(`/${h}`) || path.includes(`/${h}_`) || path.includes(`posts/${h}`)) };
  });
  const mentions = await Promise.all(raw
    .filter((m) => !platformOf(m.url))
    .slice(0, 10)
    .map(async (m): Promise<Mention> => ({ url: m.url, title: String(m.title ?? '').slice(0, 160), type: m.type, check: await check(m.url) })));
  const platforms: PlatformCheck[] = await Promise.all(REVIEW_PLATFORMS.map(async (name) => {
    const p = (Array.isArray(r.json?.platforms) ? r.json.platforms : []).find((x: any) => String(x?.platform ?? '').toLowerCase() === name.toLowerCase());
    const url = typeof p?.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : '';
    if (!p?.found || !url) return { platform: name, state: 'not_found_in_search' as const, url: '' };
    // A claimed listing counts as listed only if its page names the brand.
    return { platform: name, state: (await check(url)) === 'confirmed' ? 'listed' as const : 'claimed_unconfirmed' as const, url };
  }));
  return { mentions, socialPosts, platforms, provider: r.provider, searches: r.searches ?? [] };
}
