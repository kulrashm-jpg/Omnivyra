/**
 * Canonical Search Console Provider Bridge  (BETA-PROVIDER-002) — REFERENCE IMPLEMENTATION #2
 *
 * Wires the SECOND real external evidence provider — Google Search Console — into the canonical
 * BETA-ENGINE-004 framework by REUSING the existing GSC integration (no provider code is duplicated):
 *   • the ingestion row shape + fetch semantics of `gscIngestionService` (`GscKeywordRow`),
 *   • the already-ingested first-party data in `keyword_metrics` (source='gsc'),
 *   • the connection/readiness signals in `searchConsoleReadinessService`.
 * It:
 *   • registers the canonical `search_console` provider with live auth/connection from env,
 *   • aggregates the reused GSC rows into a normalised input and converts it to canonical Evidence via
 *     `gscEvidenceAdapter`,
 *   • maps every provider failure (unauthorized / expired token / quota / API disabled / property missing
 *     / not verified / timeout / partial) to canonical Evidence (no fabrication, no silent failure),
 *   • exposes a deterministic availability signal engines use to lift confidence.
 *
 * Backward compatible: with no GSC OAuth credentials the provider is UNAVAILABLE, so the GSC consumer
 * engines keep their current behaviour (their keyword_metrics data is already MEASURED); the confidence
 * lift — the provider-reliability factor — activates only when the canonical provider is connected.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  gscEvidenceAdapter, type GscSearchEvidenceInput,
} from './evidencePlatform/providers/searchConsole/gscEvidenceAdapter';
import type { GscKeywordRow } from './gscIngestionService';

const PROVIDER_ID = 'search_console';
const ENV_KEYS = ['GSC_OAUTH_CLIENT_ID', 'GSC_OAUTH_CLIENT_SECRET'];

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** True when the Google Search Console OAuth credentials are present. */
export function isSearchConsoleProviderConfigured(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/** Register the canonical Search Console provider with auth/connection derived from env (idempotent). */
export function registerSearchConsoleProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('search_console descriptor missing from anticipated providers');
  const configured = isSearchConsoleProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability engines consult to decide whether to add the provider-reliability factor. */
export function isSearchConsoleProviderAvailable(): boolean {
  registerSearchConsoleProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function searchConsoleProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

/**
 * Aggregate the reused GSC row shape (`gscIngestionService.GscKeywordRow`) into the normalised,
 * provider-agnostic evidence input. Pure + deterministic: sums impressions/clicks, counts distinct
 * queries/pages/devices/countries, and computes the impression-weighted average position (the honest
 * aggregate of Google's per-row measured positions). No fabrication — absent dimensions stay null.
 */
export function aggregateGscRows(
  siteUrl: string,
  rows: GscKeywordRow[],
  observedAt: string | null,
): GscSearchEvidenceInput {
  let totalImpressions = 0;
  let totalClicks = 0;
  let weightedPositionSum = 0;
  let positionImpressionWeight = 0;
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
      positionImpressionWeight += weight;
    }
    const keyword = (row.keyword ?? '').trim();
    if (keyword) queries.add(keyword.toLowerCase());
    const page = (row.pageUrl ?? '').trim();
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
    avgCtr: null, // derived (clicks/impressions) by the adapter as CALCULATED — Google's per-row ctr is not summable
    avgPosition: hasPosition && positionImpressionWeight > 0 ? weightedPositionSum / positionImpressionWeight : null,
    indexedQueries: queries.size > 0 ? queries.size : null,
    indexedPages: pages.size > 0 ? pages.size : null,
    deviceSegments: devices.size > 0 ? devices.size : null,
    countrySegments: countries.size > 0 ? countries.size : null,
    observedAt,
    providerReliability: searchConsoleProviderReliability(),
  };
}

/**
 * Reference fetch → canonical Evidence. Reuses the existing GSC integration (ingestion row shape +
 * already-ingested first-party data) and converts it through the canonical adapter. Every failure
 * (no credentials, unauthorized, expired token, quota, API disabled, property missing/unverified,
 * timeout, partial) becomes canonical Evidence — never throws, never fabricates. `nowIso` is passed in
 * (deterministic; no clock access).
 *
 * With no OAuth credentials the provider is UNAVAILABLE and this returns a single UNAVAILABLE Evidence
 * without touching the network or the database (backward-compatible, test-verified).
 */
export function fetchSearchConsoleEvidence(
  siteUrl: string,
  rows: GscKeywordRow[] | null,
  nowIso: string,
): Evidence[] {
  registerSearchConsoleProvider();
  if (!isSearchConsoleProviderConfigured()) {
    return gscEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'impressions',
      'Search Console provider not connected. Set GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET and authorise the property.',
    ));
  }
  if (!rows || rows.length === 0) {
    return gscEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: 'Search Console is connected but returned no search-performance rows for the property/window.',
      evidenceKey: 'impressions',
      observedAt: nowIso,
    });
  }
  const input = aggregateGscRows(siteUrl, rows, nowIso);
  return gscEvidenceAdapter.toEvidence(input, { observedAt: nowIso, subjectId: siteUrl });
}
