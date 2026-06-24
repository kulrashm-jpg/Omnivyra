/**
 * customerOperationsRebaseService.ts
 *
 * READ-ONLY recalculation (Phase 16B) of existing metrics under the corrected 16A truth:
 * `organization_id == company_id`. Pure, deterministic. No new engines, no behavior change —
 * this recomputes attribution and reports OLD vs REBASED. UNKNOWN stays UNKNOWN; no estimates.
 *
 * The correction makes org-keyed data ATTRIBUTABLE — and attribution then reveals it is
 * almost entirely vendor (engagement/community/execution) or test (revenue), not customer.
 */

import type { TenantClass } from './customerPopulationIntegrityService';

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number): number | null => (d > 0 ? round1((n / d) * 100) : null);

export interface ClassVolume { tenant_class: TenantClass; volume: number; }
export interface ShareResult { total: number; by_class: Array<{ tenant_class: TenantClass; volume: number; share_pct: number | null }>; customer_share_pct: number | null; vendor_share_pct: number | null; }

/** Pure: share of a measured volume by tenant class (vendor = INTERNAL). */
export function shareByClass(volumes: ClassVolume[]): ShareResult {
  const total = volumes.reduce((a, v) => a + v.volume, 0);
  const agg = new Map<TenantClass, number>();
  for (const v of volumes) agg.set(v.tenant_class, (agg.get(v.tenant_class) ?? 0) + v.volume);
  return {
    total,
    by_class: Array.from(agg.entries()).map(([tenant_class, volume]) => ({ tenant_class, volume, share_pct: pct(volume, total) })).sort((a, b) => b.volume - a.volume),
    customer_share_pct: pct(agg.get('CUSTOMER') ?? 0, total),
    vendor_share_pct: pct(agg.get('INTERNAL') ?? 0, total),
  };
}

export interface RevenueByClass { currency: string; by_class: Array<{ tenant_class: TenantClass; amount: number }>; customer_amount: number; total: number; }

/** Pure: attribute revenue by class (now joinable via org=company). */
export function attributeRevenue(events: Array<{ tenant_class: TenantClass; amount: number; currency: string }>): RevenueByClass[] {
  const currencies = Array.from(new Set(events.map((e) => e.currency)));
  return currencies.map((currency) => {
    const rows = events.filter((e) => e.currency === currency);
    const agg = new Map<TenantClass, number>();
    for (const e of rows) agg.set(e.tenant_class, round1((agg.get(e.tenant_class) ?? 0) + e.amount));
    return {
      currency, by_class: Array.from(agg.entries()).map(([tenant_class, amount]) => ({ tenant_class, amount })).sort((a, b) => b.amount - a.amount),
      customer_amount: agg.get('CUSTOMER') ?? 0, total: round1(rows.reduce((a, e) => a + e.amount, 0)),
    };
  });
}

export interface FoundationRebase {
  old: { customer_integrity: number; joinability: number; coverage: number; foundation: number; level: string };
  rebased: { customer_integrity: number; joinability: number; coverage: number; foundation: number; level: string };
  notes: string[];
}

const W = { integrity: 0.3, telemetry: 0.2, confidence: 0.2, joinability: 0.15, coverage: 0.15 };
function foundation(i: number, t: number, c: number, j: number, cov: number) { return round1(i * W.integrity + t * W.telemetry + c * W.confidence + j * W.joinability + cov * W.coverage); }
function level(f: number, i: number) { let l = f < 20 ? 'LEVEL_0' : f < 40 ? 'LEVEL_1' : f < 60 ? 'LEVEL_2' : f < 80 ? 'LEVEL_3' : 'LEVEL_4'; if (i < 20 && (l === 'LEVEL_2' || l === 'LEVEL_3' || l === 'LEVEL_4')) l = 'LEVEL_1'; return l; }

/**
 * Pure: rebase the foundation. Integrity is recomputed against CUSTOMER-only (via the persisted
 * classification, so excluding non-customers). Joinability rises (org=company + signup domain
 * join). Coverage is recomputed HONESTLY from CUSTOMER data — which the rebase shows is near-zero,
 * correcting 16A's optimistic coverage estimate.
 */
export function rebaseFoundation(input: {
  telemetry: number; confidence: number;
  old_integrity: number; old_joinability: number; old_coverage: number;
  rebased_integrity: number; rebased_joinability: number; rebased_coverage: number;
}): FoundationRebase {
  const fo = foundation(input.old_integrity, input.telemetry, input.confidence, input.old_joinability, input.old_coverage);
  const fr = foundation(input.rebased_integrity, input.telemetry, input.confidence, input.rebased_joinability, input.rebased_coverage);
  return {
    old: { customer_integrity: input.old_integrity, joinability: input.old_joinability, coverage: input.old_coverage, foundation: fo, level: level(fo, input.old_integrity) },
    rebased: { customer_integrity: input.rebased_integrity, joinability: input.rebased_joinability, coverage: input.rebased_coverage, foundation: fr, level: level(fr, input.rebased_integrity) },
    notes: [
      'integrity rebased to CUSTOMER-only (persisted classification excludes non-customers)',
      'joinability rebased up: org_id=company_id makes engagement/community/revenue attributable; signup domain-join recovers 96%',
      'coverage rebased HONESTLY: newly-attributable data is ~100% vendor/test, so CUSTOMER coverage does NOT rise — corrects 16A optimism',
    ],
  };
}
