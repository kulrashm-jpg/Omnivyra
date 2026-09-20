/**
 * CPG-006 — general public-web evidence DISCOVERY (§4, §7, §10, §15).
 *
 * ─── THE ONE IDEA THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 * A search result is a CANDIDATE, never a claim.
 *
 *   title + snippet + URL   →  candidate
 *   fetched document        →  evidence
 *   resolved field value    →  claim
 *
 * Snippets are marketing-shaped, truncated, and frequently wrong. This layer
 * therefore carries them ONLY as a relevance hint for ranking, and there is no
 * code path anywhere that turns a snippet into an `EvidenceClaim`. Retrieval
 * through `safeFetch` is mandatory before anything becomes evidence (§6).
 *
 * ─── WHAT THIS LAYER MUST NOT DO ───────────────────────────────────────────
 *   • decide a field value — the CPG-001 resolver owns that;
 *   • score entity match — CPG-003 `resolveEntity` owns that;
 *   • assign authority — the CPG-003 source registry owns that;
 *   • count corroboration — CPG-003 provider families own that.
 *
 * Search rank is DISCOVERY ORDER, not evidence strength. A #1 result from a
 * source the registry marks `neverFor` a field is still excluded (§9).
 *
 * Pure: no I/O here. Providers are injected; retrieval happens downstream.
 */

export type DiscoveryProviderId = 'serp_api' | 'scaleserp' | 'dataforseo' | 'manual_import' | 'keyless_web';

export type DiscoveryStatus =
  | 'ok'
  | 'DISCOVERY_UNAVAILABLE'   // provider could not answer
  | 'no_results';

/** One raw search result. NOT evidence. */
export interface DiscoveryCandidate {
  /** Verbatim query that produced this candidate — part of provenance. */
  query: string;
  provider: DiscoveryProviderId;
  /** Discovery ORDER. Recorded for audit; never evidence strength, never a SERP rank. */
  rank: number;
  /** Provider-declared SERP position, or null when none was declared. Never index-derived. */
  serpPosition: number | null;
  url: string;
  /** Normalised form used for dedup; the original is preserved above. */
  canonicalUrl: string;
  host: string;
  title: string | null;
  /** Hint only. NEVER promoted to a claim. */
  snippet: string | null;
  retrievedAt: string;
  /** Why this candidate was kept — surfaced so ranking stays inspectable. */
  discoveryReason: string;
}

export interface DiscoveryResult {
  status: DiscoveryStatus;
  companyName: string;
  field: string;
  provider: DiscoveryProviderId | null;
  /** Populated only when status === 'ok'. */
  candidates: DiscoveryCandidate[];
  rejected: { url: string; reason: string }[];
  /** §15 — explicit failure detail. Never a silent fallback. */
  unavailableReason: string | null;
  queriedAt: string;
}

export interface RawSearchResult {
  url: string;
  title?: string | null;
  snippet?: string | null;
  /** Discovery ORDER within this provider response. Never a SERP rank. */
  rank: number;
  /**
   * The provider-declared SERP position, when the provider actually declared
   * one. null means no authoritative rank: it is NEVER back-filled from the
   * array index, because an index is discovery order, not a rank.
   */
  serpPosition?: number | null;
}

export interface DiscoveryProvider {
  id: DiscoveryProviderId;
  /** False when credential-gated and uncredentialed. Never throws. */
  isAvailable(): Promise<boolean> | boolean;
  search(query: string, limit: number): Promise<RawSearchResult[] | null>;
}

// ── §16 conservative bounds ─────────────────────────────────────────────────

export const DISCOVERY_LIMITS = Object.freeze({
  /** Results requested per query. */
  maxResultsPerQuery: 10,
  /** Candidates kept after filtering, per field. */
  maxCandidatesPerField: 5,
  /** Queries issued per (company, field). Bounded — no query expansion loops. */
  maxQueriesPerField: 2,
  /** Documents fetched per field. Bounded — this is not a crawler. */
  maxRetrievalsPerField: 3,
  timeoutMs: 12_000,
});

// ── §7 filtering ────────────────────────────────────────────────────────────

/**
 * Hosts that are search-result pages, aggregator noise, or must not be fetched.
 *
 * ⚠️ CPG-006 LIVE FINDING — these are matched as DOMAIN-OR-SUBDOMAIN.
 * The first version anchored on `^(www\.)?linkedin\.com$`, which does not match
 * `in.linkedin.com`. A live Infosys CEO search surfaced exactly that host and the
 * pipeline FETCHED it — violating the CPG-002 §8 rule that LinkedIn may be
 * referenced but never retrieved. Country and regional subdomains
 * (`in.`, `uk.`, `m.`, `www.`) are the normal shape of these hosts, so a
 * suffix match is the only correct test.
 */
const REJECT_DOMAIN_SUFFIXES: readonly string[] = Object.freeze([
  // search engines — their result pages are not evidence
  'google.com', 'google.co.in', 'bing.com', 'duckduckgo.com', 'yandex.com', 'baidu.com',
  'search.marcia.com',
  // social / access-controlled — referenced, NEVER fetched (CPG-002 §8)
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'youtube.com', 'pinterest.com', 'reddit.com', 'tiktok.com', 'threads.net',
]);

/** True when `host` equals a listed domain or is any subdomain of one. */
function matchesRejectSuffix(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return REJECT_DOMAIN_SUFFIXES.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Search-engine hosts also appear with other TLDs (google.de, google.fr, …). */
const SEARCH_ENGINE_PREFIX = /^(www\.)?(google|bing|duckduckgo|yandex|baidu)\./i;

/** Private / loopback / link-local — defence in depth ahead of safeFetch. */
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?)/i;

export function canonicalizeUrl(raw: string): { url: string; canonical: string; host: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host || PRIVATE_HOST.test(u.hostname)) return null;
  // Canonical form for dedup: drop hash, tracking params, trailing slash.
  const canonical = new URL(u.toString());
  canonical.hash = '';
  for (const p of [...canonical.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref|source)/i.test(p)) canonical.searchParams.delete(p);
  }
  let s = canonical.toString().replace(/\/$/, '');
  s = s.replace(/^https?:\/\/www\./, `${canonical.protocol}//`);
  return { url: raw, canonical: s, host };
}

export function isRejectedHost(host: string): boolean {
  return matchesRejectSuffix(host) || SEARCH_ENGINE_PREFIX.test(host);
}

/**
 * Filter + deduplicate raw results into candidates (§7, §10).
 *
 * Deduplicates by canonical URL AND by host: three pages of one site are ONE
 * candidate here, because letting all three through would hand the corroboration
 * layer three copies of a single source. Genuine family counting still belongs
 * to CPG-003 — this only avoids feeding it obvious duplicates.
 */
export function filterCandidates(
  raw: readonly RawSearchResult[],
  ctx: { query: string; provider: DiscoveryProviderId; retrievedAt: string; companyDomain: string | null; limit: number },
): { candidates: DiscoveryCandidate[]; rejected: { url: string; reason: string }[] } {
  const candidates: DiscoveryCandidate[] = [];
  const rejected: { url: string; reason: string }[] = [];
  const seenCanonical = new Set<string>();
  const seenHost = new Set<string>();

  for (const r of raw) {
    if (candidates.length >= ctx.limit) break;
    const c = canonicalizeUrl(r.url);
    if (!c) { rejected.push({ url: r.url, reason: 'malformed, unsupported protocol, or private address' }); continue; }
    if (isRejectedHost(c.host)) { rejected.push({ url: r.url, reason: `disallowed host: ${c.host}` }); continue; }
    if (seenCanonical.has(c.canonical)) { rejected.push({ url: r.url, reason: 'duplicate canonical URL' }); continue; }
    if (seenHost.has(c.host)) { rejected.push({ url: r.url, reason: `duplicate host already represented: ${c.host}` }); continue; }

    seenCanonical.add(c.canonical);
    seenHost.add(c.host);
    const isFirstParty = ctx.companyDomain
      ? c.host === ctx.companyDomain.toLowerCase().replace(/^www\./, '')
      : false;
    candidates.push({
      query: ctx.query, provider: ctx.provider, rank: r.rank,
      serpPosition: r.serpPosition ?? null,
      url: c.url, canonicalUrl: c.canonical, host: c.host,
      title: r.title ?? null, snippet: r.snippet ?? null,
      retrievedAt: ctx.retrievedAt,
      discoveryReason: isFirstParty
        ? 'first-party domain surfaced by search'
        : r.serpPosition == null
          // No authoritative rank: state where it was discovered, never claim a rank.
          ? `independent host, discovery position ${r.rank}`
          : `independent host at search rank ${r.serpPosition}`,
    });
  }
  return { candidates, rejected };
}

/** §15 — explicit unavailability. Never a silent substitution. */
export function discoveryUnavailable(
  companyName: string, field: string, provider: DiscoveryProviderId | null, reason: string, at: string,
): DiscoveryResult {
  return {
    status: 'DISCOVERY_UNAVAILABLE', companyName, field, provider,
    candidates: [], rejected: [], unavailableReason: reason, queriedAt: at,
  };
}

export interface DiscoverInput {
  companyName: string;
  companyDomain: string | null;
  field: string;
  queries: readonly string[];
  provider: DiscoveryProvider;
  asOf: string;
  limit?: number;
}

/**
 * Run bounded discovery for one (company, field). Never throws; a provider
 * failure becomes DISCOVERY_UNAVAILABLE with its reason.
 */
export async function discover(input: DiscoverInput): Promise<DiscoveryResult> {
  const { companyName, field, provider, asOf } = input;
  const limit = input.limit ?? DISCOVERY_LIMITS.maxCandidatesPerField;

  let available: boolean;
  try { available = await provider.isAvailable(); }
  catch { available = false; }
  if (!available) {
    return discoveryUnavailable(companyName, field, provider.id, 'provider unavailable (no credential or not configured)', asOf);
  }

  const allRaw: RawSearchResult[] = [];
  const queries = input.queries.slice(0, DISCOVERY_LIMITS.maxQueriesPerField);
  let lastError: string | null = null;

  for (const q of queries) {
    try {
      const rows = await provider.search(q, DISCOVERY_LIMITS.maxResultsPerQuery);
      // Discovery order is the position in THIS response. Nullish, not truthy:
      // a provider-supplied 0 must not be silently replaced by an index.
      if (rows) allRaw.push(...rows.map((r, i) => ({ ...r, rank: r.rank ?? i + 1, serpPosition: r.serpPosition ?? null })));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (allRaw.length === 0) {
    return lastError
      ? discoveryUnavailable(companyName, field, provider.id, `provider error: ${lastError}`, asOf)
      : { status: 'no_results', companyName, field, provider: provider.id, candidates: [], rejected: [], unavailableReason: null, queriedAt: asOf };
  }

  const { candidates, rejected } = filterCandidates(allRaw, {
    query: queries.join(' | '), provider: provider.id, retrievedAt: asOf,
    companyDomain: input.companyDomain, limit,
  });

  return {
    status: 'ok', companyName, field, provider: provider.id,
    candidates, rejected, unavailableReason: null, queriedAt: asOf,
  };
}
