/**
 * Meta Ad Library acquisition client — the SECOND advertising platform.
 *
 * ─── WHY THIS IS A CLIENT AND NOT A NEW SUBSYSTEM ─────────────────────────
 * `AdsTransparencyClient` already exists as the provider seam, the platform is already DECLARED
 * by the client rather than inferred by the orchestrator, and `adsEvidenceStore` already stamps
 * and segregates rows per platform. So Meta arrives as one more implementation of the existing
 * interface. Nothing in the identity model, the access-state vocabulary, the count semantics or
 * the domain scoping changes.
 *
 * ─── THE COVERAGE BOUNDARY, WHICH IS THE WHOLE DIFFICULTY ─────────────────
 * Meta's archive is NOT a general advertising archive. Per Meta's own `ads_archive` reference,
 * "Ads that reached no EU location appear only if they concern social issues, elections, or
 * politics", and Meta's transparency research-tools page scopes the API to political/issue ads
 * worldwide "as well as ads that deliver to the EU and associated territories".
 *
 * So for an ordinary commercial advertiser that does not deliver to the EU/UK, a correct query
 * returns ZERO ROWS — and that zero means "outside the archive's coverage", NOT "this company
 * does not advertise". Reporting it as an empty `observed` would be the exact
 * UNAVAILABLE → PRESENTED AS FACT transition Report 1 exists to prevent. This client therefore
 * refuses to search at all when the requested delivery area carries no non-political coverage,
 * raising {@link MetaArchiveCoverageError}, which the orchestrator maps to `unavailable` with a
 * coverage reason.
 *
 * ─── WHY `verified` IS ALWAYS FALSE, AND WHY THAT IS THE CORRECT ANSWER ───
 * `MATCHED` — the only state carrying `eligibleForCompanyClaim` — requires
 * `advertiser.verified === true`, because the provider's own identity assertion is what makes the
 * advertiser side independent of the public brand string. Meta publishes no such assertion for
 * commercial advertisers: its funder field (`bylines`) is POLITICAL-AND-ISSUE-ONLY, and what a
 * commercial ad exposes is `page_name`, a Page display name rather than a verified legal entity.
 *
 * Setting `verified: false` is therefore not a limitation being worked around — it is the truth,
 * and it makes the EXISTING resolver cap every Meta advertiser at `PROBABLE_MATCH` with
 * `eligibleForCompanyClaim: false`, with no change to the resolver and no weakening of the Google
 * path. Meta evidence is reportable context; it can never become a company-specific claim.
 *
 * ─── WHAT IS DELIBERATELY NOT IMPLEMENTED ─────────────────────────────────
 * `searchByDomain` is optional on the interface and is NOT implemented here, because the archive
 * exposes no ad destination URL. `ad_creative_link_captions` is the DISPLAYED caption, not the
 * landing URL, and `ad_snapshot_url` is a Meta-hosted render of the ad. Inferring a landing
 * destination from either would fabricate evidence, so Meta contributes no destination-domain
 * discovery path and no landing analysis.
 *
 * Restricted fields — `spend`, `impressions`, `currency`, `bylines`,
 * `demographic_distribution`, `estimated_audience_size`, `delivery_by_region` — are
 * political-and-issue-only and are never requested, so no performance figure can enter the report
 * through this client.
 *
 * ─── CREDENTIALS ──────────────────────────────────────────────────────────
 * The access token is supplied by the caller, carried only in the request URL this module builds,
 * and never logged, stringified into an error, or placed on a returned object. Every error raised
 * here is constructed from the HTTP status and Meta's error code, never from the request.
 */
import {
  ADS_PLATFORM_META,
  type AdsTransparencyClient,
  type AdvertiserProfileObservation,
  type AdvertiserSuggestion,
} from './adsTransparencyObservation';

/** Pinned Graph API version: an unpinned version silently changes the contract under us. */
export const META_GRAPH_VERSION = 'v21.0';

/** Meta's documented cap on `search_terms`. */
export const META_SEARCH_TERMS_MAX = 100;

/** Meta's documented cap on `search_page_ids`. */
export const META_SEARCH_PAGE_IDS_MAX = 10;

/** Our own ceiling on paging, so one subject cannot walk the archive indefinitely. */
export const META_DEFAULT_MAX_PAGES = 5;

/**
 * Delivery areas for which the archive carries NON-political advertising: the EU 27, plus `GB`
 * because Meta's Ad Library API page states "ads of any type delivered to the UK or EU" while the
 * `ads_archive` reference speaks only of EU locations. `GB` is included on the strength of that
 * API-page wording; if it proves wrong the only consequence is an `unavailable` coverage refusal
 * for UK-only subjects, which is the safe direction to be wrong in.
 */
export const META_NON_POLITICAL_COVERAGE: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'GB',
];

/** Raised when the requested delivery area carries no non-political archive coverage. */
export class MetaArchiveCoverageError extends Error {
  constructor(requested: readonly string[]) {
    super(
      'outside the archive coverage: the Meta Ad Library carries non-political advertising only '
      + `for EU/UK delivery, and the requested delivery area (${requested.join(', ') || 'none'}) is not covered`,
    );
    this.name = 'MetaArchiveCoverageError';
  }
}

/** One archived ad, narrowed to the fields available for ALL ad types. */
export interface MetaArchivedAd {
  id?: unknown;
  page_id?: unknown;
  page_name?: unknown;
  ad_creative_bodies?: unknown;
  ad_creative_link_titles?: unknown;
  ad_creative_link_captions?: unknown;
  ad_creative_link_descriptions?: unknown;
  ad_delivery_start_time?: unknown;
  ad_delivery_stop_time?: unknown;
  ad_snapshot_url?: unknown;
  publisher_platforms?: unknown;
  languages?: unknown;
}

export interface MetaHttpResponse {
  status: number;
  /** Parsed JSON body, or null when the response carried none. */
  body: unknown;
}

/** The injected transport. Production supplies a real fetch; tests supply a fake. */
export type MetaFetch = (url: string) => Promise<MetaHttpResponse>;

export interface MetaAdLibraryClientConfig {
  /** Owner-provisioned Graph API token. Never logged by this module. */
  accessToken: string;
  /** ISO-3166 alpha-2 delivery areas to query. */
  reachedCountries: readonly string[];
  fetch: MetaFetch;
  maxPages?: number;
  graphVersion?: string;
}

/** The only ad fields requested: every one is available for ALL ad types, not just political. */
const AD_FIELDS = [
  'id',
  'page_id',
  'page_name',
  'ad_creative_bodies',
  'ad_creative_link_titles',
  'ad_creative_link_captions',
  'ad_creative_link_descriptions',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_snapshot_url',
  'publisher_platforms',
  'languages',
].join(',');

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Map an HTTP status and Meta error code onto a message `accessStateFromError` classifies.
 * The request URL — which carries the token — is never included.
 */
function describeFailure(status: number, body: unknown): Error {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof error?.code === 'number' ? error.code : null;

  // 190 is Meta's invalid/expired OAuth token. Token lifetimes are short, so this is routine
  // rather than exceptional, and it must read as "we could not look", never as "no ads".
  if (code === 190 || status === 401) {
    return new Error('meta ad library: auth required — the access token was rejected (code 190)');
  }
  // 613 is Meta's rate-limit code. Meta publishes no numeric limits, so there is nothing to
  // pace against beyond backing off and declaring the observation incomplete.
  if (code === 613 || status === 429) {
    return new Error('meta ad library: rate limit reached (code 613); no further pages were requested');
  }
  if (status >= 500) {
    return new Error(`meta ad library: network failure, upstream returned ${status}`);
  }
  if (status === 403) {
    return new Error('meta ad library: forbidden — the archive refused this query from this vantage (403)');
  }
  return new Error(`meta ad library: query failed with status ${status}${code == null ? '' : ` (code ${code})`}`);
}

export function createMetaAdLibraryClient(config: MetaAdLibraryClientConfig): AdsTransparencyClient {
  const graphVersion = config.graphVersion ?? META_GRAPH_VERSION;
  const maxPages = Math.max(1, config.maxPages ?? META_DEFAULT_MAX_PAGES);

  const covered = config.reachedCountries
    .map((c) => c.trim().toUpperCase())
    .filter((c) => META_NON_POLITICAL_COVERAGE.includes(c));

  /** Fail closed before any request: no covered area means the archive cannot answer the question. */
  function requireCoverage(): void {
    if (covered.length === 0) throw new MetaArchiveCoverageError(config.reachedCountries);
  }

  function buildUrl(params: Record<string, string>): string {
    const search = new URLSearchParams({
      access_token: config.accessToken,
      ad_type: 'ALL',
      ad_active_status: 'ALL', // the default ACTIVE would hide concluded campaigns
      ad_reached_countries: JSON.stringify(covered),
      fields: AD_FIELDS,
      limit: '100',
      ...params,
    });
    return `https://graph.facebook.com/${graphVersion}/ads_archive?${search.toString()}`;
  }

  /**
   * Walk `paging.next` up to `maxPages`. A rate limit mid-walk ends the walk by throwing.
   *
   * ─── WHY THIS DEDUPLICATES BY AD ID ───────────────────────────────────
   * Graph paging is cursor-based over a live archive, so consecutive pages can legitimately
   * overlap: a cursor can re-serve a row the previous page already returned. Concatenating blindly
   * would then report the same ad twice, which inflates `creativeIds` and makes an identical
   * observation non-deterministic between runs purely because of cursor timing. The ad `id` is
   * Meta's own stable identifier for the ad, so it is the natural key.
   *
   * Rows with no usable `id` are kept, because dropping an ad because its identifier was
   * unreadable would silently under-report evidence; they simply cannot participate in dedup.
   * First occurrence wins, so order is the archive's own.
   */
  async function collect(firstUrl: string): Promise<MetaArchivedAd[]> {
    const rows: MetaArchivedAd[] = [];
    const seenAdIds = new Set<string>();
    let url: string | null = firstUrl;
    for (let page = 0; page < maxPages && url; page += 1) {
      const res = await config.fetch(url);
      if (res.status < 200 || res.status >= 300) throw describeFailure(res.status, res.body);
      const body = res.body as { data?: unknown; paging?: { next?: unknown } } | null;
      const data = Array.isArray(body?.data) ? (body?.data as MetaArchivedAd[]) : [];
      for (const row of data) {
        const adId = str(row.id);
        if (adId !== null) {
          if (seenAdIds.has(adId)) continue;
          seenAdIds.add(adId);
        }
        rows.push(row);
      }
      // The result set ends when `data` carries no values, whatever `paging` says. Note this uses
      // the RAW page length, not the deduplicated count: a page made entirely of repeats is still
      // a page the cursor served, and treating it as the end would truncate the walk.
      url = data.length > 0 ? str(body?.paging?.next) : null;
    }
    return rows;
  }

  return {
    // Declared, never inferred — the same rule the Google client follows.
    platform: ADS_PLATFORM_META,

    async searchAdvertisers(name: string): Promise<AdvertiserSuggestion[]> {
      requireCoverage();
      const term = name.trim().slice(0, META_SEARCH_TERMS_MAX);
      if (!term) return [];
      const rows = await collect(buildUrl({ search_terms: term, search_type: 'KEYWORD_UNORDERED' }));

      // `ads_archive` is a flat ad search; advertisers are recovered by grouping on `page_id`.
      const byPage = new Map<string, { name: string | null; ads: number }>();
      for (const row of rows) {
        const pageId = str(row.page_id);
        if (!pageId) continue;
        const entry = byPage.get(pageId) ?? { name: str(row.page_name), ads: 0 };
        entry.name = entry.name ?? str(row.page_name);
        entry.ads += 1;
        byPage.set(pageId, entry);
      }

      // Two Pages sharing a display name is Meta's analogue of Google's "multiple advertiser
      // accounts have a similar name": it is reported, and the resolver refuses BOTH attribution
      // and exclusion on it.
      const nameCounts = new Map<string, number>();
      for (const entry of byPage.values()) {
        const key = (entry.name ?? '').toLowerCase();
        if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }

      return [...byPage.entries()].map(([pageId, entry]) => ({
        advertiserId: pageId,
        name: entry.name ?? pageId,
        // The archive exposes no advertiser location for commercial ads.
        basedIn: null,
        // Meta publishes no identity assertion for commercial advertisers — see the header.
        verified: false,
        ambiguityFlagged: (nameCounts.get((entry.name ?? '').toLowerCase()) ?? 0) > 1,
        // Meta states no provider-rounded ad count, and the contract forbids re-deriving one
        // from the rows we happened to page through.
        adCountLabel: null,
      }));
    },

    async openAdvertiser(advertiserId: string): Promise<AdvertiserProfileObservation | null> {
      requireCoverage();
      const pageId = advertiserId.trim();
      if (!pageId) return null;
      const rows = await collect(
        buildUrl({ search_page_ids: JSON.stringify([pageId].slice(0, META_SEARCH_PAGE_IDS_MAX)) }),
      );
      if (rows.length === 0) return null;

      const pageName = str(rows.find((row) => str(row.page_name))?.page_name);
      return {
        advertiserId: pageId,
        // A Page display name, carried where the resolver expects a legal name — and paired with
        // `verified: false`, which is what stops it ever reaching `MATCHED`.
        legalName: pageName,
        basedIn: null,
        verified: false,
        ambiguityFlagged: false,
        adCountLabel: null,
        creativeIds: rows.map((row) => str(row.id)).filter((id): id is string => id !== null),
        profileUrl: `https://www.facebook.com/ads/library/?view_all_page_id=${encodeURIComponent(pageId)}`,
        artifactRef: null,
      };
    },

    // `searchByDomain` is intentionally absent: the archive exposes no ad destination URL.
  };
}
