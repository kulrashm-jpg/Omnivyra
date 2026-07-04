/**
 * Canonical Bing Webmaster Tools Provider Bridge  (BETA-PROVIDER-004) — REFERENCE IMPLEMENTATION #4
 *
 * Wires the FOURTH real external evidence provider — Bing Webmaster Tools — into the canonical
 * BETA-ENGINE-004 framework. Bing complements (does NOT duplicate) Google Search Console: GSC remains the
 * authoritative source for Google search; Bing becomes the authoritative source for Bing search. Together
 * they form the platform's complete first-party search-evidence layer.
 *
 * AUDIT NOTE (honest): unlike GSC (PROVIDER-002) and GA4 (PROVIDER-003), **no functional Bing data path
 * existed** — no OAuth, no ingestion service, no keyword pipeline, no table. The only prior Bing artifacts
 * are the anticipated-provider descriptor (`bing_webmaster`, UNAVAILABLE) and a provenance metadata entry
 * in `analyticsProviderNormalizationService` (`evidence_scope: 'search'`, `canonical_status:
 * 'foundation_only'`). Both are REUSED here. This bridge therefore builds the canonical Bing path
 * from-scratch (shaped like the backlink reference #1): descriptor reuse + registration + canonical-
 * Evidence conversion + availability + failure governance. The Bing *ingestion* pipeline (OAuth token
 * exchange + Bing Webmaster API fetch + persistence) does not yet exist and is called out as the remaining
 * gap — this bridge provides `fetchBingEvidence` (payload → canonical Evidence) ready for that pipeline.
 *
 * Backward compatible: with no `BING_WEBMASTER_API_KEY` the provider is UNAVAILABLE, so the SEO engine
 * keeps its current behaviour; the confidence combination activates only when the provider is connected.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  bingEvidenceAdapter, type BingSearchEvidenceInput,
} from './evidencePlatform/providers/bing/bingEvidenceAdapter';

const PROVIDER_ID = 'bing_webmaster';
const ENV_KEYS = ['BING_WEBMASTER_API_KEY'];

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Canonical Bing Webmaster query row (models the Bing Webmaster `GetQueryStats` response shape). Defined
 * here because no prior Bing ingestion existed to reuse; the future ingestion pipeline maps the raw API
 * response into this shape.
 */
export interface BingQueryRow {
  query: string;
  page?: string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  ctr?: number | string | null;
  avgPosition?: number | string | null;
  device?: string | null;
  country?: string | null;
}

/** Canonical Bing crawl stats (models the Bing Webmaster `GetCrawlStats` response shape). */
export interface BingCrawlStats {
  inIndex?: number | string | null;
  crawledPages?: number | string | null;
  crawlErrors?: number | string | null;
  blockedByRobotsTxt?: number | string | null;
}

/** True when the Bing Webmaster API credential is present. */
export function isBingProviderConfigured(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/** Register the canonical Bing provider with auth/connection derived from env (idempotent). */
export function registerBingProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('bing_webmaster descriptor missing from anticipated providers');
  const configured = isBingProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability engines consult to decide whether to add the provider-reliability factor. */
export function isBingProviderAvailable(): boolean {
  registerBingProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function bingProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/**
 * Aggregate Bing Webmaster query rows + crawl stats into the normalised, provider-agnostic evidence input.
 * Pure + deterministic: sums impressions/clicks, counts distinct queries/pages/devices/countries, computes
 * the impression-weighted average position, and carries crawl stats verbatim. No fabrication — absent
 * dimensions stay null.
 */
export function aggregateBingRows(
  siteUrl: string,
  rows: BingQueryRow[],
  crawl: BingCrawlStats | null,
  observedAt: string | null,
): BingSearchEvidenceInput {
  let totalImpressions = 0;
  let totalClicks = 0;
  let weightedPositionSum = 0;
  let positionWeight = 0;
  const queries = new Set<string>();
  const pages = new Set<string>();
  const devices = new Set<string>();
  const countries = new Set<string>();
  let hasImpressions = false;
  let hasClicks = false;
  let hasPosition = false;

  for (const row of rows) {
    const impressions = num(row.impressions);
    const clicks = num(row.clicks);
    const position = num(row.avgPosition);
    if (impressions != null) { totalImpressions += impressions; hasImpressions = true; }
    if (clicks != null) { totalClicks += clicks; hasClicks = true; }
    if (position != null) {
      hasPosition = true;
      const weight = impressions != null && impressions > 0 ? impressions : 1;
      weightedPositionSum += position * weight;
      positionWeight += weight;
    }
    const query = (row.query ?? '').trim();
    if (query) queries.add(query.toLowerCase());
    const page = (row.page ?? '').trim();
    if (page) pages.add(page.toLowerCase());
    const device = (row.device ?? '').trim();
    if (device) devices.add(device.toLowerCase());
    const country = (row.country ?? '').trim();
    if (country) countries.add(country.toLowerCase());
  }

  return {
    siteUrl,
    totalImpressions: hasImpressions ? totalImpressions : null,
    totalClicks: hasClicks ? totalClicks : null,
    avgCtr: null, // derived (clicks/impressions) by the adapter as CALCULATED — per-row ctr is not summable
    avgPosition: hasPosition && positionWeight > 0 ? weightedPositionSum / positionWeight : null,
    indexedPages: crawl ? num(crawl.inIndex) : null,
    crawledPages: crawl ? num(crawl.crawledPages) : null,
    crawlErrors: crawl ? num(crawl.crawlErrors) : null,
    blockedPages: crawl ? num(crawl.blockedByRobotsTxt) : null,
    indexedQueries: queries.size > 0 ? queries.size : null,
    landingPages: pages.size > 0 ? pages.size : null,
    deviceSegments: devices.size > 0 ? devices.size : null,
    countrySegments: countries.size > 0 ? countries.size : null,
    observedAt,
    providerReliability: bingProviderReliability(),
  };
}

/**
 * Reference fetch → canonical Evidence. Converts a Bing Webmaster payload (query rows + crawl stats)
 * through the canonical adapter. Every failure (no credentials, unauthorized, expired, quota, API disabled,
 * site missing/unverified, timeout, partial) becomes canonical Evidence — never throws, never fabricates.
 * `nowIso` is passed in (deterministic; no clock access).
 *
 * With no credential the provider is UNAVAILABLE and this returns a single UNAVAILABLE Evidence without
 * touching the network or the database (backward-compatible, test-verified).
 */
export function fetchBingEvidence(
  siteUrl: string,
  rows: BingQueryRow[] | null,
  crawl: BingCrawlStats | null,
  nowIso: string,
): Evidence[] {
  registerBingProvider();
  if (!isBingProviderConfigured()) {
    return bingEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'bing_impressions',
      'Bing Webmaster provider not connected. Set BING_WEBMASTER_API_KEY and verify the site.',
    ));
  }
  if ((!rows || rows.length === 0) && !crawl) {
    return bingEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: 'Bing Webmaster is connected but returned no search or crawl data for the site/window.',
      evidenceKey: 'bing_impressions',
      observedAt: nowIso,
    });
  }
  const input = aggregateBingRows(siteUrl, rows ?? [], crawl, nowIso);
  return bingEvidenceAdapter.toEvidence(input, { observedAt: nowIso, subjectId: siteUrl });
}
