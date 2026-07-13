/**
 * enrichmentProvenance.ts — provenance + freshness for discovered company data
 * (ONBOARD-001R §2/§3).
 *
 * Pure, dependency-light. Does NOT crawl, enrich, or query — it shapes
 * provenance metadata for values the EXISTING crawl/AI pipeline already
 * produced, and decides which fields are stale enough to refresh. Reuses the
 * existing `report_settings.discovered_metadata` structure (adds a `provenance`
 * sub-object) rather than introducing a new store.
 */

import type { DiscoveredWebsiteMetadata } from './websiteMetadataExtractor';

/** Where a field's current value originated (§2/§4). */
export type FieldOrigin = 'system_discovered' | 'ai_enriched' | 'user_edited';

export type VerificationStatus = 'unverified' | 'verified' | 'stale';

/** Full provenance carried by every discovered value (§2). */
export interface FieldProvenance {
  source: string;                    // e.g. 'website_crawl', 'ai_refiner', 'user'
  confidence: 'low' | 'medium' | 'high';
  discoveredAt: string;              // ISO
  lastVerified: string | null;       // ISO, null until re-verified
  verificationStatus: VerificationStatus;
  fieldOrigin: FieldOrigin;
}

/** Discovered-metadata fields → their default crawl confidence. */
const DISCOVERED_FIELD_CONFIDENCE: Readonly<Record<string, FieldProvenance['confidence']>> = {
  favicon_url: 'high',      // deterministic <link>/well-known
  logo_url: 'medium',       // og:image is usually right, sometimes a banner
  geography: 'low',         // inferred from locale, weakest signal
  description: 'medium',
  language: 'high',
  brand_color: 'medium',
  title: 'high',
  site_name: 'high',
};

/**
 * Build per-field provenance for the values a single crawl discovered (§2).
 * `now` is injected for determinism/testing.
 */
export function buildDiscoveredProvenance(
  meta: DiscoveredWebsiteMetadata,
  now: string,
): Record<string, FieldProvenance> {
  const out: Record<string, FieldProvenance> = {};
  const add = (field: string, present: unknown) => {
    if (present === null || present === undefined || present === '' ) return;
    out[field] = {
      source: 'website_crawl',
      confidence: DISCOVERED_FIELD_CONFIDENCE[field] ?? 'medium',
      discoveredAt: now,
      lastVerified: now,           // discovered == verified at this instant
      verificationStatus: 'verified',
      fieldOrigin: 'system_discovered',
    };
  };
  add('favicon_url', meta.faviconUrl);
  add('logo_url', meta.logoUrl);
  add('geography', meta.country);
  add('description', meta.description);
  add('language', meta.language);
  add('brand_color', meta.brandColor);
  add('title', meta.title);
  add('site_name', meta.siteName);
  return out;
}

// ── §3 incremental / freshness ────────────────────────────────────────────────

export interface FreshnessConfig {
  /** A discovered/enriched field older than this is stale (ms). */
  maxAgeMs: number;
}

/** Default: 30-day freshness (overridable via env ENRICHMENT_FRESHNESS_DAYS). */
export function getFreshnessConfig(): FreshnessConfig {
  const days = Number(process.env.ENRICHMENT_FRESHNESS_DAYS ?? '30');
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return { maxAgeMs: safeDays * 24 * 60 * 60 * 1000 };
}

/**
 * Deterministic staleness rule (§3): a field is stale when its lastVerified
 * (or discoveredAt) is older than maxAge, OR it was never verified. User-edited
 * fields are NEVER stale — they are the user's source of truth and must not be
 * auto-refreshed over.
 */
export function isFieldStale(prov: FieldProvenance | undefined, nowMs: number, config: FreshnessConfig): boolean {
  if (!prov) return true;                          // unknown provenance ⇒ refreshable
  if (prov.fieldOrigin === 'user_edited') return false; // never overwrite the user
  const ref = prov.lastVerified ?? prov.discoveredAt;
  const refMs = ref ? new Date(ref).getTime() : 0;
  if (!refMs) return true;
  return nowMs - refMs > config.maxAgeMs;
}

/**
 * Given the existing provenance map and the candidate fields, return only the
 * fields that are stale and therefore worth refreshing (§3). Callers reuse the
 * existing crawl result for these — no new crawler, no duplicate request.
 */
export function selectStaleFields(
  provenance: Record<string, FieldProvenance> | null | undefined,
  candidateFields: string[],
  nowMs: number,
  config: FreshnessConfig = getFreshnessConfig(),
): string[] {
  const prov = provenance ?? {};
  return candidateFields.filter((f) => isFieldStale(prov[f], nowMs, config));
}

/**
 * Decide whether a company's discovered metadata should be re-crawled at all
 * (§3): only when at least one candidate field is stale. Lets callers skip the
 * fetch entirely when everything is fresh.
 */
export function shouldRefreshDiscovery(
  provenance: Record<string, FieldProvenance> | null | undefined,
  candidateFields: string[],
  nowMs: number,
  config: FreshnessConfig = getFreshnessConfig(),
): boolean {
  return selectStaleFields(provenance, candidateFields, nowMs, config).length > 0;
}
