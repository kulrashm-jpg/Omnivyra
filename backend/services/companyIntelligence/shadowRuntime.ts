/**
 * CI-B209 — Company shadow runtime (pure). Builds the canonical Understanding from a legacy profile
 * and measures FIELD parity vs that legacy profile — ZERO production behaviour change, authoritative
 * OFF, consumed by nothing. `computeCompanyUnderstandingShadow` returns null when the flag is OFF
 * (default) — no work, no side effects. Shadow-first only.
 */

import type { CompanyUnderstanding, CompanyProjection } from './types';
import type { CompanyProfileInput } from './fromProfile';
import { companyFromProfile } from './fromProfile';
import { buildCompanyUnderstanding } from './builder';
import { projectCompany } from './projection';
import { isCompanyUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface CompanyFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface CompanyShadowComparison { companyId: string; divergences: CompanyFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

/** Field-parity of the canonical understanding vs the legacy profile it was projected from. */
export function compareToLegacy(u: CompanyUnderstanding, legacy: CompanyProfileInput): CompanyShadowComparison {
  const canonical = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['name', canonical.name, legacy.name ?? null],
    ['domain', canonical.domain, legacy.domain ?? null],
    ['category', canonical.category, legacy.category ?? null],
    ['business_model', canonical.business_model, legacy.businessModel ?? null],
    ['products', canonical.products, legacy.products ?? []],
    ['services', canonical.services, legacy.services ?? []],
    ['competitors', canonical.competitors, legacy.competitors ?? []],
  ];
  const divergences: CompanyFieldDivergence[] = pairs.map(([field, c, l]) => ({ field, canonical: c, legacy: l, agree: norm(c) === norm(l) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { companyId: u.key.companyId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface CompanyShadowBundle { understanding: CompanyUnderstanding; projection: CompanyProjection; comparison: CompanyShadowComparison; }

/** Flag-gated shadow entry point. Returns null when OFF (default) — no work, no side effects. */
export function computeCompanyUnderstandingShadow(profile: CompanyProfileInput): CompanyShadowBundle | null {
  if (!isCompanyUnderstandingEnabled()) return null;
  const adopted = companyFromProfile(profile);
  const understanding = buildCompanyUnderstanding({ key: { companyId: profile.companyId }, builtAt: profile.asOf, facets: adopted.facets, evidence: adopted.evidence, worldView: adopted.worldView });
  const projection = projectCompany(understanding, profile.asOf);
  const comparison = compareToLegacy(understanding, profile);
  return { understanding, projection, comparison };
}
