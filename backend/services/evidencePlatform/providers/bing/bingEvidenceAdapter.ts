/**
 * Bing Webmaster Tools Evidence Adapter  (BETA-PROVIDER-004, Phase 3-4) — REFERENCE IMPLEMENTATION #4
 *
 * Converts authenticated first-party Bing Webmaster search-performance + crawl data into canonical
 * Evidence via the BETA-ENGINE-004 `ProviderEvidenceAdapter` contract. It is the ONLY bridge from a Bing
 * payload to the canonical Evidence model — no engine consumes the payload directly. Deterministic; emits
 * ONLY the metrics Bing actually returns (missing metrics are omitted, failures emitted as UNAVAILABLE —
 * never fabricated).
 *
 * Bing complements — does not duplicate — Google Search Console: GSC is the authoritative source for
 * Google search, Bing is the authoritative source for Bing search. Together they form the platform's
 * complete first-party search-evidence layer. All Bing evidence keys are `bing_`-prefixed so they never
 * collide with GSC's canonical search keys.
 *
 * Provider-agnostic input: it consumes a normalised `BingSearchEvidenceInput` that the Bing bridge builds
 * by aggregating the Bing Webmaster API row shapes (GetQueryStats / GetRankAndTrafficStats / GetCrawlStats).
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:bing_webmaster';

/**
 * Normalised, provider-agnostic Bing Webmaster search + crawl metrics. Every field nullable — only values
 * Bing actually reports pass through; nulls are omitted by the adapter (never fabricated). `avgCtr` is
 * Bing-measured; when the caller pre-aggregates, it may be left null and derived (clicks/impressions).
 */
export interface BingSearchEvidenceInput {
  siteUrl: string;
  totalImpressions: number | null; // GetRankAndTrafficStats / GetQueryStats Impressions
  totalClicks: number | null; // Clicks
  avgCtr: number | null; // 0..1, Bing-reported (null → derive from clicks/impressions)
  avgPosition: number | null; // AvgImpressionPosition / AvgClickPosition
  indexedPages: number | null; // GetCrawlStats InIndex
  crawledPages: number | null; // GetCrawlStats CrawledPages
  crawlErrors: number | null; // GetCrawlStats CrawlErrors
  blockedPages: number | null; // GetCrawlStats BlockedByRobotsTxt
  indexedQueries: number | null; // distinct queries with Bing search data
  landingPages: number | null; // distinct landing pages with Bing search data
  deviceSegments: number | null; // count of device segments observed (coverage)
  countrySegments: number | null; // count of country segments observed (coverage)
  observedAt: string | null;
  /** 0..1 provider reliability, from the provider descriptor. */
  providerReliability: number | null;
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const BING_EVIDENCE_KEYS = [
  'bing_impressions',
  'bing_clicks',
  'bing_ctr',
  'bing_avg_position',
  'bing_indexed_pages',
  'bing_crawled_pages',
  'bing_crawl_errors',
  'bing_blocked_pages',
  'bing_indexed_queries',
  'bing_landing_pages',
  'bing_device_coverage',
  'bing_country_coverage',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class BingEvidenceAdapter implements ProviderEvidenceAdapter<BingSearchEvidenceInput> {
  readonly providerId = 'bing_webmaster';
  readonly supportedEvidence = [...BING_EVIDENCE_KEYS];

  toEvidence(raw: BingSearchEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const prov = (steps: { op: string; detail?: string }[] = []) =>
      buildProvenance({
        origin: 'provider:bing_webmaster',
        collector: 'bing_webmaster_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: steps,
      });

    // Every emit is a value Bing actually returns. Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'bing_webmaster_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));

    if (raw.totalImpressions != null) measured('bing_impressions', raw.totalImpressions, 'count', 'count');
    if (raw.totalClicks != null) measured('bing_clicks', raw.totalClicks, 'count', 'count');
    if (raw.avgPosition != null) measured('bing_avg_position', round(raw.avgPosition), 'position', 'rank');
    if (raw.indexedPages != null) measured('bing_indexed_pages', raw.indexedPages, 'count', 'count');
    if (raw.crawledPages != null) measured('bing_crawled_pages', raw.crawledPages, 'count', 'count');
    if (raw.crawlErrors != null) measured('bing_crawl_errors', raw.crawlErrors, 'count', 'count');
    if (raw.blockedPages != null) measured('bing_blocked_pages', raw.blockedPages, 'count', 'count');
    if (raw.indexedQueries != null) measured('bing_indexed_queries', raw.indexedQueries, 'count', 'count');
    if (raw.landingPages != null) measured('bing_landing_pages', raw.landingPages, 'count', 'count');
    if (raw.deviceSegments != null) measured('bing_device_coverage', raw.deviceSegments, 'count', 'count');
    if (raw.countrySegments != null) measured('bing_country_coverage', raw.countrySegments, 'count', 'count');

    // CTR: MEASURED when Bing supplies it directly; else CALCULATED from clicks/impressions; else omitted.
    if (raw.avgCtr != null) {
      measured('bing_ctr', round4(raw.avgCtr), 'ratio', 'ratio');
    } else if (raw.totalClicks != null && raw.totalImpressions != null && raw.totalImpressions > 0) {
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key: 'bing_ctr', value: round4(raw.totalClicks / raw.totalImpressions),
        maturity: 'CALCULATED', sourceSystem: 'bing_webmaster_api', sourceType: 'external_api',
        measurementType: 'ratio', unit: 'ratio', observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov([{ op: 'ratio', detail: 'clicks/impressions' }]), validationStatus: 'validated',
      }));
    }
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const bingEvidenceAdapter = new BingEvidenceAdapter();
