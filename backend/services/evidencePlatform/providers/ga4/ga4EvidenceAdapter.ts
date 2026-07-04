/**
 * Google Analytics 4 Evidence Adapter  (BETA-PROVIDER-003, Phase 3-4) — REFERENCE IMPLEMENTATION #3
 *
 * Converts authenticated first-party GA4 behavioral data (sessions, engagement, users, conversions,
 * funnel page views) into canonical Evidence via the BETA-ENGINE-004 `ProviderEvidenceAdapter` contract.
 * It is the ONLY bridge from a GA4 payload to the canonical Evidence model — no engine consumes the
 * payload directly. Deterministic; emits ONLY the metrics GA4 actually returns (missing metrics are
 * omitted, failures emitted as UNAVAILABLE — never fabricated).
 *
 * Provider-agnostic input: it consumes a normalised `Ga4BehaviorEvidenceInput` that the GA4 bridge builds
 * by aggregating the existing `ga4IngestionService` row shapes (`Ga4SessionRow` / `Ga4EventRow`, reused,
 * not rewritten). The bridge maps either live `runReport` rows or already-ingested `canonical_sessions` /
 * `canonical_page_views` into this shape.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:analytics.ga4';

/**
 * Normalised, provider-agnostic GA4 behavioral metrics. Every field nullable — only values GA4 actually
 * reports pass through; nulls are omitted by the adapter (never fabricated). `engagementRate` is a
 * Google-measured metric; when the caller pre-aggregates, it may be left null and derived
 * (engagedSessions/sessions) as CALCULATED.
 */
export interface Ga4BehaviorEvidenceInput {
  propertyId: string;
  totalSessions: number | null;
  engagedSessions: number | null;
  engagementRate: number | null; // 0..1, Google-reported (null → derive from engaged/sessions)
  engagementTimeMsecTotal: number | null; // total engagement time, to derive avg per session
  pageViews: number | null;
  totalUsers: number | null;
  activeUsers: number | null;
  conversions: number | null; // count of conversion events (via conversionRegistry)
  deviceSegments: number | null; // count of device categories observed (coverage)
  geoSegments: number | null; // count of countries observed (coverage)
  observedAt: string | null;
  /** 0..1 provider reliability, from the provider descriptor. */
  providerReliability: number | null;
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const GA4_EVIDENCE_KEYS = [
  'sessions',
  'engaged_sessions',
  'engagement_rate',
  'avg_engagement_time_sec',
  'page_views',
  'total_users',
  'active_users',
  'conversions',
  'conversion_rate',
  'device_coverage',
  'geo_coverage',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class Ga4EvidenceAdapter implements ProviderEvidenceAdapter<Ga4BehaviorEvidenceInput> {
  readonly providerId = 'analytics.ga4';
  readonly supportedEvidence = [...GA4_EVIDENCE_KEYS];

  toEvidence(raw: Ga4BehaviorEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const prov = (steps: { op: string; detail?: string }[] = []) =>
      buildProvenance({
        origin: 'provider:analytics.ga4',
        collector: 'ga4_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: steps,
      });

    // Every emit is a value GA4 actually returns. Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'ga4_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));
    const calculated = (key: string, value: number, unit: string, measurementType: string, detail: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'CALCULATED',
        sourceSystem: 'ga4_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov([{ op: measurementType, detail }]), validationStatus: 'validated',
      }));

    if (raw.totalSessions != null) measured('sessions', raw.totalSessions, 'count', 'count');
    if (raw.engagedSessions != null) measured('engaged_sessions', raw.engagedSessions, 'count', 'count');
    if (raw.pageViews != null) measured('page_views', raw.pageViews, 'count', 'count');
    if (raw.totalUsers != null) measured('total_users', raw.totalUsers, 'count', 'count');
    if (raw.activeUsers != null) measured('active_users', raw.activeUsers, 'count', 'count');
    if (raw.conversions != null) measured('conversions', raw.conversions, 'count', 'count');
    if (raw.deviceSegments != null) measured('device_coverage', raw.deviceSegments, 'count', 'count');
    if (raw.geoSegments != null) measured('geo_coverage', raw.geoSegments, 'count', 'count');

    // engagement_rate: MEASURED when Google supplies it; else CALCULATED from engaged/sessions; else omitted.
    if (raw.engagementRate != null) {
      measured('engagement_rate', round4(raw.engagementRate), 'ratio', 'ratio');
    } else if (raw.engagedSessions != null && raw.totalSessions != null && raw.totalSessions > 0) {
      calculated('engagement_rate', round4(raw.engagedSessions / raw.totalSessions), 'ratio', 'ratio', 'engaged_sessions/sessions');
    }

    // avg engagement time per session (seconds) — only when both total time and sessions are present.
    if (raw.engagementTimeMsecTotal != null && raw.totalSessions != null && raw.totalSessions > 0) {
      calculated('avg_engagement_time_sec', round(raw.engagementTimeMsecTotal / raw.totalSessions / 1000), 'seconds', 'duration', 'engagement_time_ms/sessions/1000');
    }

    // conversion_rate — only when both conversions and sessions are present (never fabricated).
    if (raw.conversions != null && raw.totalSessions != null && raw.totalSessions > 0) {
      calculated('conversion_rate', round4(raw.conversions / raw.totalSessions), 'ratio', 'ratio', 'conversions/sessions');
    }
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const ga4EvidenceAdapter = new Ga4EvidenceAdapter();
