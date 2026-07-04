/**
 * Commercial Outcomes & Revenue Evidence Adapter  (BETA-PROVIDER-008, Phase 4)
 *
 * Converts authenticated, MEASURED commercial-outcome data (CRM revenue events, GA4 conversions with value,
 * lead systems, payment processors) into canonical Evidence via the BETA-ENGINE-004 `ProviderEvidenceAdapter`
 * contract. It is the ONLY bridge from a commercial payload to the canonical Evidence model — no engine
 * consumes the payload directly. Deterministic; emits ONLY metrics genuinely supplied (missing metrics
 * omitted, failures emitted as UNAVAILABLE — never fabricated).
 *
 * NON-NEGOTIABLE: never fabricate a commercial metric, never estimate revenue. `revenue_per_conversion`,
 * `avg_order_value`, and `lead_to_customer_rate` are emitted ONLY when both of their measured inputs are
 * present (CALCULATED from real numerator + denominator); absent → omitted. This is what upgrades ROI from
 * Not-Determinable to Measured downstream.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:commercial';

/** Normalised, provider-agnostic CONSOLIDATED commercial outcomes. Every field nullable — only genuinely
 *  measured values pass through; nulls are omitted (never fabricated, never estimated). */
export interface CommercialEvidenceInput {
  subjectId: string;
  revenue: number | null; // measured revenue over the window (currency-agnostic amount)
  conversions: number | null; // measured conversion count
  conversionValueTotal: number | null; // measured total conversion value (may equal revenue for e-comm)
  qualifiedLeads: number | null;
  closedDeals: number | null;
  pipelineValue: number | null;
  recurringRevenue: number | null;
  ordersCount: number | null; // for AOV
  customersCount: number | null; // for LTV
  observedAt: string | null;
  providerReliability: number | null;
  contributingSources: string[]; // crm, ga4, stripe, …
}

export const COMMERCIAL_EVIDENCE_KEYS = [
  'revenue',
  'conversions',
  'conversion_value',
  'revenue_per_conversion',
  'avg_order_value',
  'lead_to_customer_rate',
  'pipeline_value',
  'qualified_leads',
  'closed_deals',
  'recurring_revenue',
  'customer_lifetime_value',
] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class CommercialEvidenceAdapter implements ProviderEvidenceAdapter<CommercialEvidenceInput> {
  readonly providerId = 'commercial';
  readonly supportedEvidence = [...COMMERCIAL_EVIDENCE_KEYS];

  toEvidence(raw: CommercialEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const sources = raw.contributingSources ?? [];
    const prov = (steps: { op: string; detail?: string }[] = []) =>
      buildProvenance({ origin: 'provider:commercial', collector: 'commercial_api', engine: PROVIDER_ENGINE_ID, version: '1.0.0', timestamp: ts, calculationSteps: [{ op: 'consolidate', detail: `sources=${sources.join('+') || 'none'}` }, ...steps] });

    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({ engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED', sourceSystem: 'commercial_api', sourceType: 'external_api', measurementType, observationType: 'aggregate', unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated' }));
    const calculated = (key: string, value: number, unit: string, measurementType: string, detail: string) =>
      out.push(createEvidence({ engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'CALCULATED', sourceSystem: 'commercial_api', sourceType: 'external_api', measurementType, observationType: 'aggregate', unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov([{ op: measurementType, detail }]), validationStatus: 'validated' }));

    if (raw.revenue != null) measured('revenue', round2(raw.revenue), 'currency_amount', 'sum');
    if (raw.conversions != null) measured('conversions', raw.conversions, 'count', 'count');
    if (raw.conversionValueTotal != null) measured('conversion_value', round2(raw.conversionValueTotal), 'currency_amount', 'sum');
    if (raw.qualifiedLeads != null) measured('qualified_leads', raw.qualifiedLeads, 'count', 'count');
    if (raw.closedDeals != null) measured('closed_deals', raw.closedDeals, 'count', 'count');
    if (raw.pipelineValue != null) measured('pipeline_value', round2(raw.pipelineValue), 'currency_amount', 'sum');
    if (raw.recurringRevenue != null) measured('recurring_revenue', round2(raw.recurringRevenue), 'currency_amount', 'sum');

    // Derived — ONLY when both measured inputs are present (never estimated / fabricated).
    const revenueBasis = raw.conversionValueTotal ?? raw.revenue;
    if (revenueBasis != null && raw.conversions != null && raw.conversions > 0) {
      calculated('revenue_per_conversion', round2(revenueBasis / raw.conversions), 'currency_amount', 'ratio', 'revenue/conversions');
    }
    if (revenueBasis != null && raw.ordersCount != null && raw.ordersCount > 0) {
      calculated('avg_order_value', round2(revenueBasis / raw.ordersCount), 'currency_amount', 'ratio', 'revenue/orders');
    }
    if (raw.closedDeals != null && raw.qualifiedLeads != null && raw.qualifiedLeads > 0) {
      calculated('lead_to_customer_rate', round4(raw.closedDeals / raw.qualifiedLeads), 'ratio', 'ratio', 'closed_deals/qualified_leads');
    }
    if (revenueBasis != null && raw.customersCount != null && raw.customersCount > 0) {
      calculated('customer_lifetime_value', round2(revenueBasis / raw.customersCount), 'currency_amount', 'ratio', 'revenue/customers');
    }
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const commercialEvidenceAdapter = new CommercialEvidenceAdapter();
