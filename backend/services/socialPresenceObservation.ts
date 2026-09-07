/**
 * G-1 — public social profile observation, mediated by the approved SERP provider.
 *
 * WHY NOT FETCH THE PLATFORMS DIRECTLY
 * The G-1 audit read the platforms' own robots.txt. For `User-agent: *`, LinkedIn, Instagram,
 * Facebook, X and Reddit all return `Disallow: /` — LinkedIn adds "please email
 * whitelist-crawl@linkedin.com to apply for white listing". Only YouTube permits generic crawling.
 * Directly fetching those profiles would breach the platforms' stated access policy, and this
 * repository has no robots-permission gate to enforce compliance. So nothing here ever contacts a
 * social platform. It asks the SAME approved SERP provider Report 1 already pays for what the
 * public search index holds — which is, by construction, only what each platform allows to be
 * indexed.
 *
 * WHAT AN OBSERVATION IS, AND IS NOT
 * A social URL sitting in a company profile is NOT evidence that the profile exists publicly — that
 * conflation is the defect G-8 corrected at the persistence layer, and it is not reintroduced here.
 * An entry becomes `observed` only when TWO things hold: the candidate's own shape is a company
 * profile (F-1 — the existing `isGenericSocialUrl` / `isLikelyCompanySocialLink` guards), and a
 * returned search result URL normalises to the SAME profile URL on the SAME platform. Everything
 * else stays `declared`. If the provider could not answer at all, every ELIGIBLE candidate is
 * `unreachable`, so "we did not look" never reads as "nothing is there"; an ineligible candidate is
 * settled on its shape alone and stays `declared` regardless of provider state.
 *
 * An indexed result also does NOT prove the profile is currently active — only that the public index
 * holds it. Nothing in this module claims recency, activity, reach, or audience.
 *
 * BUDGET
 * ONE query per report, not one per platform: a single brand-anchored query surfaces the company's
 * profiles across platforms in the same result set. The call goes through the existing
 * `fetchSerpResultsForKeyword`, so the established scan-budget gate, provider-call logging and cost
 * ledger all apply unchanged — this module adds no provider, no credential, no timeout and no retry
 * policy of its own. The H2 deadline seam is likewise reused rather than bypassed, though no H2
 * deadline is active on this path (see the note at the call site in `snapshotReportService`).
 */

import {
  normalizeSocialUrl,
  isGenericSocialUrl,
  isLikelyCompanySocialLink,
} from './companyProfile/normalization';
import type { CanonicalSocialPresenceEntry } from './canonicalReport/canonicalReportTypes';
import type { SerpKeywordResult } from './reportCompetitorIntelligenceServiceHelpers';

/** Platforms for which a SERP-indexed profile URL is a meaningful public identity observation. */
const PLATFORM_HOSTS: ReadonlyArray<{ platform: string; test: (host: string) => boolean }> = [
  { platform: 'linkedin', test: (h) => h.endsWith('linkedin.com') },
  { platform: 'facebook', test: (h) => h.endsWith('facebook.com') },
  { platform: 'instagram', test: (h) => h.endsWith('instagram.com') },
  { platform: 'x', test: (h) => h.endsWith('x.com') || h.endsWith('twitter.com') },
  { platform: 'youtube', test: (h) => h.endsWith('youtube.com') || h.endsWith('youtu.be') },
  { platform: 'tiktok', test: (h) => h.endsWith('tiktok.com') },
  { platform: 'reddit', test: (h) => h.endsWith('reddit.com') },
];

/** The platform a URL belongs to, or null when it is not one of the supported platforms. */
export function socialPlatformOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return PLATFORM_HOSTS.find((entry) => entry.test(host))?.platform ?? null;
  } catch {
    return null;
  }
}

/**
 * Identity key for a profile URL: platform + normalised path, lowercased, trailing slash removed.
 *
 * Two representations of the same profile (`https://www.linkedin.com/company/acme/` and
 * `https://linkedin.com/company/acme`) must collapse to one entry, and a DIFFERENT profile on the
 * same platform must not. The query string is dropped deliberately — tracking parameters on a
 * shared link do not make it a different profile.
 */
function profileKey(url: string): string | null {
  const platform = socialPlatformOf(url);
  if (!platform) return null;
  const normalized = normalizeSocialUrl(url) ?? url;
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${platform}:${path}`;
  } catch {
    return null;
  }
}

const trimmed = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
};

/**
 * The single public query. Anchored on the company's own identity so the result set is the
 * company's own profiles rather than a generic platform listing.
 */
export function buildSocialObservationQuery(params: {
  companyName?: string | null;
  websiteDomain?: string | null;
}): string | null {
  const name = trimmed(params.companyName);
  const domain = trimmed(params.websiteDomain);
  const anchor = name ?? domain;
  if (!anchor) return null;
  // Both identity anchors when available: the name finds the profiles, the domain disambiguates
  // companies that share a name.
  return name && domain ? `${name} ${domain}` : anchor;
}

export type SocialObservationParams = {
  candidateUrls: readonly string[];
  companyName?: string | null;
  websiteDomain?: string | null;
  /** Injected so tests never touch a provider. Production passes `fetchSerpResultsForKeyword`. */
  fetchSerp: (keyword: string, geography: string | null) => Promise<SerpKeywordResult>;
  geography?: string | null;
  now?: () => Date;
};

/**
 * Observe the company's public social presence.
 *
 * Returns one entry per DISTINCT candidate profile, in candidate order. An empty candidate list
 * returns an empty array and issues no query at all — no candidates means nothing to observe, which
 * is not the same as an unreachable provider.
 */
export async function observeSocialPresence(
  params: SocialObservationParams,
): Promise<CanonicalSocialPresenceEntry[]> {
  const now = params.now ?? (() => new Date());

  // De-duplicate candidates by profile identity, keeping the first representation seen.
  const candidates: Array<{ key: string; platform: string; url: string; observable: boolean }> = [];
  const seen = new Set<string>();
  for (const raw of params.candidateUrls) {
    const key = profileKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const platform = key.slice(0, key.indexOf(':'));
    const normalized = normalizeSocialUrl(raw) ?? raw;
    // F-1 — a candidate must LOOK like a company profile before it is eligible to be called one.
    //
    // Candidates reach here from the report form and from stored report defaults as well as from
    // the crawl, and only the crawl path is gated upstream. Without this, a URL such as
    // `linkedin.com/feed/` would key to `linkedin:/feed`, match a search result carrying that same
    // URL, and be published to the customer as a publicly observed social identity.
    //
    // Both guards are the repository's existing ones, unchanged and unduplicated:
    //   isGenericSocialUrl        rejects platform-level pages (bare host, share/sharer, watch/results)
    //   isLikelyCompanySocialLink rejects shapes that are not a profile (LinkedIn must be /company/,
    //                             X a single handle segment, YouTube a channel, Reddit /r/, …)
    //
    // A rejected candidate is NOT dropped — silence would be indistinguishable from "not supplied".
    // It stays in the output as `declared`, which is the existing honest non-observed state: the
    // company gave us this URL and nothing established it as a public profile.
    const observable = !isGenericSocialUrl(normalized) && isLikelyCompanySocialLink(platform, normalized);
    candidates.push({ key, platform, url: raw, observable });
  }
  if (candidates.length === 0) return [];

  // A candidate that cannot be a profile is settled on its own shape — no provider state changes
  // that, so it is reported `declared` even when the provider is unavailable.
  const observableCandidates = candidates.filter((candidate) => candidate.observable);

  const query = observableCandidates.length > 0 ? buildSocialObservationQuery(params) : null;
  if (!query) {
    // No identity anchor, or nothing worth asking about ⇒ no query is issued. An inability to look
    // is not an absence, so eligible candidates are `unreachable` rather than `declared`.
    return candidates.map((candidate) => (candidate.observable ? unreachable(candidate) : declared(candidate)));
  }

  const result = await params.fetchSerp(query, params.geography ?? null);
  if (result.status !== 'ok') {
    return candidates.map((candidate) => (candidate.observable ? unreachable(candidate) : declared(candidate)));
  }

  // Index the returned rows by the SAME profile identity used for candidates, so a match means the
  // result really is that profile — not merely the same platform.
  const observedByKey = new Map<string, { title: string | null; snippet: string | null }>();
  for (const row of result.rows) {
    if (!row.url) continue;
    const key = profileKey(row.url);
    if (!key || observedByKey.has(key)) continue;
    observedByKey.set(key, { title: trimmed(row.title), snippet: trimmed(row.snippet) });
  }

  const observedAt = now().toISOString();
  return candidates.map((candidate) => {
    // F-1 — an ineligible candidate can never be matched, whatever the result set contains.
    const hit = candidate.observable ? observedByKey.get(candidate.key) : undefined;
    if (!hit) {
      // Either the shape disqualified it, or the provider answered and this profile was not in the
      // public result set. Honest state either way: the company declared it, nothing observed it.
      return declared(candidate);
    }
    return {
      platform: candidate.platform,
      url: candidate.url,
      status: 'observed' as const,
      observed_at: observedAt,
      // Only what the provider actually returned. Absent stays null.
      name: hit.title,
      description: hit.snippet,
      source: 'serp' as const,
    };
  });
}

function declared(candidate: { platform: string; url: string }): CanonicalSocialPresenceEntry {
  return {
    platform: candidate.platform,
    url: candidate.url,
    status: 'declared',
    observed_at: null,
    name: null,
    description: null,
    source: 'unspecified',
  };
}

function unreachable(candidate: { platform: string; url: string }): CanonicalSocialPresenceEntry {
  return {
    platform: candidate.platform,
    url: candidate.url,
    status: 'unreachable',
    observed_at: null,
    name: null,
    description: null,
    source: 'unspecified',
  };
}
