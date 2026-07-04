/**
 * Google Search Console Evidence Adapter  (BETA-PROVIDER-002, Phase 3-4) — REFERENCE IMPLEMENTATION #2
 *
 * Converts authenticated first-party Search Console search-performance data into canonical Evidence via
 * the BETA-ENGINE-004 `ProviderEvidenceAdapter` contract. It is the ONLY bridge from a GSC payload to the
 * canonical Evidence model — no engine consumes the payload directly. Deterministic; emits ONLY the
 * metrics Search Console actually returns (missing metrics are omitted, failures emitted as UNAVAILABLE —
 * never fabricated).
 *
 * Provider-agnostic input: it consumes a normalised `GscSearchEvidenceInput` that the GSC bridge builds by
 * aggregating the existing `gscIngestionService` row shape (reused, not rewritten). The bridge maps either
 * live `searchAnalytics/query` rows or already-ingested `keyword_metrics` into this shape.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:search_console';

/**
 * Normalised, provider-agnostic Search Console search-performance metrics. Every field nullable — only
 * values GSC actually reports pass through; nulls are omitted by the adapter (never fabricated).
 * `avgCtr`/`avgPosition` are Google-measured metrics; when the caller pre-aggregates over the window,
 * `avgCtr` may be left null and derived (clicks/impressions) as CALCULATED.
 */
export interface GscSearchEvidenceInput {
  siteUrl: string;
  totalImpressions: number | null;
  totalClicks: number | null;
  avgCtr: number | null; // 0..1, Google-reported click-through rate (null → derive from clicks/impressions)
  avgPosition: number | null; // Google-reported average ranking position (lower is better)
  indexedQueries: number | null; // distinct queries with search data
  indexedPages: number | null; // distinct landing pages with search data
  deviceSegments: number | null; // count of device segments observed (coverage)
  countrySegments: number | null; // count of country segments observed (coverage)
  observedAt: string | null;
  /** 0..1 provider reliability, from the provider descriptor. */
  providerReliability: number | null;
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const GSC_EVIDENCE_KEYS = [
  'impressions',
  'clicks',
  'ctr',
  'avg_position',
  'indexed_queries',
  'indexed_pages',
  'device_coverage',
  'country_coverage',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class GscEvidenceAdapter implements ProviderEvidenceAdapter<GscSearchEvidenceInput> {
  readonly providerId = 'search_console';
  readonly supportedEvidence = [...GSC_EVIDENCE_KEYS];

  toEvidence(raw: GscSearchEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const prov = (steps: { op: string; detail?: string }[] = []) =>
      buildProvenance({
        origin: 'provider:search_console',
        collector: 'search_console_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: steps,
      });

    // Every emit is a value GSC actually returns. Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'search_console_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));

    if (raw.totalImpressions != null) measured('impressions', raw.totalImpressions, 'count', 'count');
    if (raw.totalClicks != null) measured('clicks', raw.totalClicks, 'count', 'count');
    if (raw.avgPosition != null) measured('avg_position', round(raw.avgPosition), 'position', 'rank');
    if (raw.indexedQueries != null) measured('indexed_queries', raw.indexedQueries, 'count', 'count');
    if (raw.indexedPages != null) measured('indexed_pages', raw.indexedPages, 'count', 'count');
    if (raw.deviceSegments != null) measured('device_coverage', raw.deviceSegments, 'count', 'count');
    if (raw.countrySegments != null) measured('country_coverage', raw.countrySegments, 'count', 'count');

    // CTR: MEASURED when Google supplies it directly; else CALCULATED from clicks/impressions. Omitted
    // entirely when neither is available (never fabricated).
    if (raw.avgCtr != null) {
      measured('ctr', round4(raw.avgCtr), 'ratio', 'ratio');
    } else if (raw.totalClicks != null && raw.totalImpressions != null && raw.totalImpressions > 0) {
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key: 'ctr', value: round4(raw.totalClicks / raw.totalImpressions),
        maturity: 'CALCULATED', sourceSystem: 'search_console_api', sourceType: 'external_api',
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

export const gscEvidenceAdapter = new GscEvidenceAdapter();
