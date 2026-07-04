/**
 * Canonical Commercial Outcomes & Revenue Provider Bridge  (BETA-PROVIDER-008)
 *
 * Wires the canonical `commercial` provider into the BETA-ENGINE-004 framework, REUSING the platform's
 * existing measured commercial data paths (no new commercial ingestion is built):
 *   • CRM revenue events (`crmIngestionService` → `canonical_revenue_events`, revenue_amount),
 *   • GA4 conversions with value (`ga4IngestionService` → `canonical_conversions`, conversion_value),
 *   • lead systems (`active_leads`) — where connected.
 * It registers the provider, aggregates the reused sources into a normalised input, converts to canonical
 * Evidence via `commercialEvidenceAdapter`, and governs every failure as canonical Evidence.
 *
 * This provider closes BETA-ENGINE-012's ROI honesty gap: it supplies the measured `revenue`,
 * `conversions`, `conversion_value`, and `revenue_per_conversion` evidence that lets the Business Impact
 * Engine upgrade a ROI classification from Not-Determinable/Estimated to MEASURED — deterministically, from
 * authenticated evidence only.
 *
 * NON-NEGOTIABLE: never fabricate a commercial metric, never estimate revenue. With no credential the
 * provider is UNAVAILABLE and ROI stays Not-Determinable (backward compatible).
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  commercialEvidenceAdapter, type CommercialEvidenceInput,
} from './evidencePlatform/providers/commercial/commercialEvidenceAdapter';

const PROVIDER_ID = 'commercial';
const ENV_KEYS = ['CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED'];

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One measured commercial source's outcomes (CRM, GA4 conversions, Stripe, leads, …). */
export interface CommercialSourcePayload {
  source: string;
  revenue?: number | string | null;
  conversions?: number | string | null;
  conversionValue?: number | string | null;
  qualifiedLeads?: number | string | null;
  closedDeals?: number | string | null;
  pipelineValue?: number | string | null;
  recurringRevenue?: number | string | null;
  orders?: number | string | null;
  customers?: number | string | null;
}

export function isCommercialProviderConfigured(): boolean {
  return ENV_KEYS.some((k) => Boolean(process.env[k]));
}

export function registerCommercialProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('commercial descriptor missing from anticipated providers');
  const configured = isCommercialProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

export function isCommercialProviderAvailable(): boolean {
  registerCommercialProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function commercialProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

const addNullable = (a: number | null, b: number | null): number | null => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

/**
 * DETERMINISTIC multi-source consolidation. Sums measured commercial outcomes across sources (CRM + GA4 +
 * Stripe + leads). Missing fields stay null (never fabricated). Pure.
 */
export function consolidateCommercialSources(sources: CommercialSourcePayload[], observedAt: string | null): CommercialEvidenceInput {
  let revenue: number | null = null, conversions: number | null = null, conversionValue: number | null = null;
  let qualifiedLeads: number | null = null, closedDeals: number | null = null, pipelineValue: number | null = null;
  let recurringRevenue: number | null = null, orders: number | null = null, customers: number | null = null;
  const contributing = new Set<string>();

  for (const s of sources) {
    const r = num(s.revenue); const c = num(s.conversions); const cv = num(s.conversionValue);
    const ql = num(s.qualifiedLeads); const cd = num(s.closedDeals); const pv = num(s.pipelineValue);
    const rr = num(s.recurringRevenue); const o = num(s.orders); const cu = num(s.customers);
    if ([r, c, cv, ql, cd, pv, rr, o, cu].some((v) => v != null)) contributing.add((s.source ?? '').trim().toLowerCase() || 'unknown');
    revenue = addNullable(revenue, r); conversions = addNullable(conversions, c); conversionValue = addNullable(conversionValue, cv);
    qualifiedLeads = addNullable(qualifiedLeads, ql); closedDeals = addNullable(closedDeals, cd); pipelineValue = addNullable(pipelineValue, pv);
    recurringRevenue = addNullable(recurringRevenue, rr); orders = addNullable(orders, o); customers = addNullable(customers, cu);
  }

  return {
    subjectId: '', revenue, conversions, conversionValueTotal: conversionValue, qualifiedLeads, closedDeals,
    pipelineValue, recurringRevenue, ordersCount: orders, customersCount: customers,
    observedAt, providerReliability: commercialProviderReliability(), contributingSources: [...contributing],
  };
}

/**
 * Reference fetch → canonical Evidence. Consolidates the reused commercial sources and converts them via the
 * canonical adapter. Every failure (no credential, unauthorized, no CRM, no revenue/conversion data, quota,
 * timeout, partial) becomes canonical Evidence — never throws, never fabricates. `nowIso` is passed in.
 *
 * With no credential the provider is UNAVAILABLE → a single UNAVAILABLE Evidence, no network/DB, ROI stays
 * Not-Determinable (backward compatible, test-verified).
 */
export function fetchCommercialEvidence(subjectId: string, sources: CommercialSourcePayload[] | null, nowIso: string): Evidence[] {
  registerCommercialProvider();
  if (!isCommercialProviderConfigured()) {
    return commercialEvidenceAdapter.onFailure(unavailableFailure(PROVIDER_ID, 'revenue', 'Commercial provider not connected. Set CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED and connect a CRM / payment / analytics-conversion source.'));
  }
  const consolidated = sources ? consolidateCommercialSources(sources, nowIso) : null;
  const hasAny = consolidated && (consolidated.revenue != null || consolidated.conversions != null || consolidated.conversionValueTotal != null || consolidated.pipelineValue != null || consolidated.qualifiedLeads != null);
  if (!consolidated || !hasAny) {
    return commercialEvidenceAdapter.onFailure({ providerId: PROVIDER_ID, state: PROVIDER_FAILURE.UNAVAILABLE, reason: 'Commercial provider is connected but returned no revenue/conversion data.', evidenceKey: 'revenue', observedAt: nowIso });
  }
  return commercialEvidenceAdapter.toEvidence({ ...consolidated, subjectId }, { observedAt: nowIso, subjectId });
}
