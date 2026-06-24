/**
 * customerRevenueIntelligenceService.ts
 *
 * READ-ONLY financial intelligence. Revenue is EVIDENCE-BACKED ONLY — measured from actual
 * recorded revenue amounts (`canonical_revenue_events`). If revenue cannot be measured from a
 * real billing source, it is **UNKNOWN** and is NEVER estimated, inferred, modelled from plan
 * names, extrapolated, or forecast. No writes, no recommendations, no automation.
 *
 * Hard facts about the source data (probed live):
 *  - `canonical_revenue_events` is the only company_id-keyed revenue table (revenue_amount,
 *    currency_code). Other amounts (invoices/credit_purchases) are organization_id-keyed.
 *  - There is NO recurring/subscription amount → MRR / ARR / ACTIVE_SUBSCRIPTIONS are UNKNOWN.
 *  - Mixed currencies → cross-currency totals are not computed (kept per-currency).
 */

import { supabase } from '../db/supabaseClient';
import type { TenantClass } from './customerPopulationIntegrityService';

export type Unknownable<T> = T | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface RevenueEvent { company_id: string; amount: number; currency: string; }
export interface RevenueCompany {
  company_id: string; company_name: string; tenant_class: TenantClass;
  events: RevenueEvent[]; has_value: boolean; adoption_score: number; execution_volume: number;
}

export interface CustomerRevenue {
  company_id: string; company_name: string; tenant_class: TenantClass;
  revenue_by_currency: Record<string, number>;
  total_revenue: Unknownable<number>; // a number only if single-currency; UNKNOWN if mixed or none
  primary_currency: string | null; event_count: number; measurable: boolean; confidence: Confidence;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: per-company revenue from recorded events. UNKNOWN when no events or mixed currency. */
export function calculateRevenueByCustomer(c: RevenueCompany): CustomerRevenue {
  const revenue_by_currency: Record<string, number> = {};
  for (const e of c.events) revenue_by_currency[e.currency] = round2((revenue_by_currency[e.currency] ?? 0) + e.amount);
  const currencies = Object.keys(revenue_by_currency);
  const measurable = c.events.length > 0;
  const total_revenue: Unknownable<number> = currencies.length === 1 ? revenue_by_currency[currencies[0]] : 'UNKNOWN';
  return {
    company_id: c.company_id, company_name: c.company_name, tenant_class: c.tenant_class,
    revenue_by_currency, total_revenue, primary_currency: currencies.length === 1 ? currencies[0] : null,
    event_count: c.events.length, measurable,
    confidence: !measurable ? 'UNKNOWN' : currencies.length === 1 ? 'HIGH' : 'MEDIUM',
  };
}

export interface RevenueConcentration {
  currency: string; total: number; companies_with_revenue: number;
  top1_share_pct: number | null; top3_share_pct: number | null; top5_share_pct: number | null;
  revenue_distribution: Array<{ company_name: string; amount: number; share_pct: number | null }>;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: revenue concentration per currency (evidence only). */
export function calculateRevenueConcentration(perCustomer: CustomerRevenue[]): RevenueConcentration[] {
  const currencies = Array.from(new Set(perCustomer.flatMap((c) => Object.keys(c.revenue_by_currency))));
  return currencies.map((currency) => {
    const rows = perCustomer.filter((c) => c.revenue_by_currency[currency]).map((c) => ({ company_name: c.company_name, amount: c.revenue_by_currency[currency] })).sort((a, b) => b.amount - a.amount || a.company_name.localeCompare(b.company_name));
    const total = round2(rows.reduce((a, r) => a + r.amount, 0));
    const topN = (n: number) => rows.slice(0, n).reduce((a, r) => a + r.amount, 0);
    return {
      currency, total, companies_with_revenue: rows.length,
      top1_share_pct: pct(topN(1), total), top3_share_pct: pct(topN(3), total), top5_share_pct: pct(topN(5), total),
      revenue_distribution: rows.map((r) => ({ company_name: r.company_name, amount: r.amount, share_pct: pct(r.amount, total) })),
    };
  }).sort((a, b) => b.total - a.total);
}

export interface RevenuePortfolio {
  // Metrics that cannot be measured from the available data — explicitly UNKNOWN.
  mrr: Unknownable<number>; arr: Unknownable<number>; active_subscriptions: Unknownable<number>;
  // Measurable from recorded events:
  paying_customers: number; // companies with ≥ 1 recorded revenue event
  observable_revenue_by_currency: Record<string, number>;
  per_customer: CustomerRevenue[];
  concentration: RevenueConcentration[];
  data_quality: {
    total_companies: number; customers_with_measurable_revenue: number; customers_with_unknown_revenue: number;
    revenue_coverage_pct: number | null; revenue_confidence: Confidence; missing_revenue_sources: string[];
    customer_class_with_revenue: Record<string, number>; // tenant_class → # with revenue
  };
  cross_signal: {
    revenue_without_value: Unknownable<number>; value_without_revenue: Unknownable<number>;
    revenue_without_adoption: Unknownable<number>; revenue_without_execution: Unknownable<number>;
  };
  can_revenue_be_measured: string;
  unknown_gaps: string[];
}

/** Pure: full revenue portfolio. Evidence only; UNKNOWN preserved. */
export function calculateRevenuePortfolio(companies: RevenueCompany[]): RevenuePortfolio {
  const per_customer = companies.map(calculateRevenueByCustomer);
  const withRevenue = per_customer.filter((c) => c.measurable);
  const observable_revenue_by_currency: Record<string, number> = {};
  for (const c of withRevenue) for (const [cur, amt] of Object.entries(c.revenue_by_currency)) observable_revenue_by_currency[cur] = round2((observable_revenue_by_currency[cur] ?? 0) + amt);

  const hasRev = (id: string) => withRevenue.some((c) => c.company_id === id);
  const measurableBoth = companies.filter((c) => hasRev(c.company_id)); // revenue measurable
  const cross_signal = measurableBoth.length === 0
    ? { revenue_without_value: 'UNKNOWN' as const, value_without_revenue: 'UNKNOWN' as const, revenue_without_adoption: 'UNKNOWN' as const, revenue_without_execution: 'UNKNOWN' as const }
    : {
        revenue_without_value: measurableBoth.filter((c) => !c.has_value).length,
        value_without_revenue: companies.filter((c) => c.has_value && !hasRev(c.company_id)).length,
        revenue_without_adoption: measurableBoth.filter((c) => c.adoption_score === 0).length,
        revenue_without_execution: measurableBoth.filter((c) => c.execution_volume === 0).length,
      };

  const classWithRevenue: Record<string, number> = {};
  for (const c of withRevenue) classWithRevenue[c.tenant_class] = (classWithRevenue[c.tenant_class] ?? 0) + 1;
  const customerRevenue = withRevenue.filter((c) => c.tenant_class === 'CUSTOMER').length;

  return {
    mrr: 'UNKNOWN', arr: 'UNKNOWN', active_subscriptions: 'UNKNOWN',
    paying_customers: withRevenue.length,
    observable_revenue_by_currency,
    per_customer, concentration: calculateRevenueConcentration(per_customer),
    data_quality: {
      total_companies: companies.length,
      customers_with_measurable_revenue: withRevenue.length,
      customers_with_unknown_revenue: companies.length - withRevenue.length,
      revenue_coverage_pct: pct(withRevenue.length, companies.length),
      revenue_confidence: withRevenue.length === 0 ? 'UNKNOWN' : customerRevenue === 0 ? 'LOW' : 'MEDIUM',
      missing_revenue_sources: ['no recurring/subscription amounts → MRR/ARR unmeasurable', 'invoices/credit_purchases are organization_id-keyed (not company-attributable)', 'payment_transactions / revenue_metrics tables are empty'],
      customer_class_with_revenue: classWithRevenue,
    },
    cross_signal,
    can_revenue_be_measured: withRevenue.length === 0
      ? 'NO — zero recorded revenue events for the tracked company population; revenue is UNKNOWN for every company.'
      : customerRevenue === 0
        ? `PARTIAL — revenue events exist for ${withRevenue.length} company(ies), but NONE are classified CUSTOMER (test/internal only); real-customer revenue is UNKNOWN.`
        : `PARTIAL — revenue measurable for ${customerRevenue} customer(s) via canonical_revenue_events; MRR/ARR still UNKNOWN (no recurring data).`,
    unknown_gaps: [
      'MRR / ARR / ACTIVE_SUBSCRIPTIONS are UNKNOWN — no recurring/subscription amounts in the data',
      'revenue is one-time events only (canonical_revenue_events); no contract/subscription model',
      'cross-currency totals not computed (USD + INR present) — reported per currency',
    ],
  };
}

// ── Read-only loader ─────────────────────────────────────────────────────────
const safe = async <T>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };

export async function loadRevenueEvents(companyIds: string[]): Promise<Map<string, RevenueEvent[]>> {
  const map = new Map<string, RevenueEvent[]>();
  if (companyIds.length === 0) return map;
  const rows = await safe(async () => ((await supabase.from('canonical_revenue_events').select('company_id, revenue_amount, currency_code').in('company_id', companyIds)).data ?? []) as any[], []);
  for (const r of rows) {
    const id = String(r.company_id);
    const amount = Number(r.revenue_amount);
    if (!Number.isFinite(amount)) continue;
    map.set(id, [...(map.get(id) ?? []), { company_id: id, amount, currency: String(r.currency_code ?? 'UNKNOWN') }]);
  }
  return map;
}
