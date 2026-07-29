/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U0 — Shadow Parity harness (pure, offline analysis).
 *
 * Runs the canonical Company Understanding in SHADOW over a corpus of legacy profiles and aggregates a
 * Delta Report: per-company parity, per-field parity, and the exact divergences. ZERO production impact —
 * pure functions, deterministic (uses each profile's `asOf`, never `Date.now`), invoked ONLY by the parity
 * test / offline analysis and NEVER wired into any request path. It reuses the certified shadow machinery
 * (`companyFromProfile` → `buildCompanyUnderstanding` → `compareToLegacy`) and derives nothing itself
 * (no classification, no AI, no regex) — it only measures.
 */

import type { CompanyProfileInput } from './fromProfile';
import { companyFromProfile } from './fromProfile';
import { buildCompanyUnderstanding } from './builder';
import { compareToLegacy, type CompanyShadowComparison } from './shadowRuntime';

export interface FieldParity {
  field: string;
  agree: number;
  total: number;
  rate: number;
}

export interface CompanyParity {
  companyId: string;
  parity: number;
  divergences: { field: string; canonical: unknown; legacy: unknown }[];
}

export interface ShadowParityReport {
  companies: CompanyParity[];
  perField: FieldParity[];
  overallParity: number;
  fullMatch: number;
  withDivergence: number;
}

/** Build the canonical understanding from a legacy profile and measure field parity vs that profile. */
function shadowCompare(profile: CompanyProfileInput): CompanyShadowComparison {
  const adopted = companyFromProfile(profile);
  const understanding = buildCompanyUnderstanding({
    key: { companyId: profile.companyId },
    builtAt: profile.asOf,
    facets: adopted.facets,
    evidence: adopted.evidence,
    worldView: adopted.worldView,
  });
  return compareToLegacy(understanding, profile);
}

/** Run shadow parity over a corpus of legacy profiles → an aggregated, deterministic Delta Report. */
export function runCompanyShadowParity(profiles: readonly CompanyProfileInput[]): ShadowParityReport {
  const comparisons = profiles.map(shadowCompare);

  const companies: CompanyParity[] = comparisons.map((c) => ({
    companyId: c.companyId,
    parity: c.parity,
    divergences: c.divergences
      .filter((d) => !d.agree)
      .map((d) => ({ field: d.field, canonical: d.canonical, legacy: d.legacy })),
  }));

  const fieldAgg = new Map<string, { agree: number; total: number }>();
  for (const c of comparisons) {
    for (const d of c.divergences) {
      const cur = fieldAgg.get(d.field) ?? { agree: 0, total: 0 };
      cur.total += 1;
      cur.agree += d.agree ? 1 : 0;
      fieldAgg.set(d.field, cur);
    }
  }
  const perField: FieldParity[] = [...fieldAgg.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([field, v]) => ({ field, agree: v.agree, total: v.total, rate: Number((v.agree / v.total).toFixed(4)) }));

  const overallParity = companies.length
    ? Number((companies.reduce((s, c) => s + c.parity, 0) / companies.length).toFixed(4))
    : 1;
  const fullMatch = companies.filter((c) => c.parity === 1).length;

  return { companies, perField, overallParity, fullMatch, withDivergence: companies.length - fullMatch };
}
