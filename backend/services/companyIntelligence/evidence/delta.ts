/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1/U2 — Semantic Delta (shadow analysis).
 *
 * Classifies the EVIDENCE-derived legacy surface against the legacy profile, per field:
 * parity / approved_improvement / expected_abstention / unexpected_regression. Pure + deterministic;
 * consumed by nothing in production. `classifyLegacySurfaceDelta` is THE single classifier — reused by
 * `runSemanticDelta` (U1) and by the U2 authoritative-projection parity gate. Unexpected regressions
 * block rollout.
 */

import type { CompanyProfileInput } from '../fromProfile';
import { toLegacyFields, type LegacyCompanyFields } from '../persistence';
import { buildCompanyUnderstandingFromEvidence } from './buildFromEvidence';
import type { EvidenceSources } from './adapters';

export type DeltaClass = 'parity' | 'approved_improvement' | 'expected_abstention' | 'unexpected_regression';

// The approved semantic-improvement whitelist (may diverge from legacy) and the parity-locked fields.
export const APPROVED_DIVERGENCE = new Set(['category', 'business_model', 'solution_domains', 'provider_type', 'operating_model', 'domain_role', 'competitors', 'firmographics']);
export const PARITY_LOCKED = new Set(['name', 'domain', 'products', 'services']);

export interface FieldDelta { field: string; legacy: unknown; evidence: unknown; class: DeltaClass; }
export interface SurfaceDelta { fields: FieldDelta[]; unexpectedRegressions: number; approvedImprovements: number; expectedAbstentions: number; parity: number; }
export interface CompanyDelta { companyId: string; fields: FieldDelta[]; regressions: number; improvements: number; abstentions: number; }
export interface SemanticDeltaReport { companies: CompanyDelta[]; totalRegressions: number; approvedImprovements: number; expectedAbstentions: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

/** THE classifier: legacy profile vs the projected legacy surface, field by field. Pure. */
export function classifyLegacySurfaceDelta(legacy: CompanyProfileInput, canon: LegacyCompanyFields): SurfaceDelta {
  const pairs: [string, unknown, unknown][] = [
    ['name', legacy.name ?? null, canon.name],
    ['domain', legacy.domain ?? null, canon.domain],
    ['category', legacy.category ?? null, canon.category],
    ['business_model', legacy.businessModel ?? null, canon.business_model],
    ['products', legacy.products ?? [], canon.products],
    ['services', legacy.services ?? [], canon.services],
    ['competitors', legacy.competitors ?? [], canon.competitors],
  ];
  const fields: FieldDelta[] = pairs.map(([field, l, c]) => {
    let cls: DeltaClass;
    if (norm(l) === norm(c)) cls = 'parity';
    else if (PARITY_LOCKED.has(field)) cls = 'unexpected_regression';
    else if (norm(c) === '') cls = 'expected_abstention'; // evidence abstained where legacy had a value
    else if (APPROVED_DIVERGENCE.has(field)) cls = 'approved_improvement';
    else cls = 'unexpected_regression';
    return { field, legacy: l, evidence: c, class: cls };
  });
  const agree = fields.filter((f) => f.class === 'parity').length;
  return {
    fields,
    unexpectedRegressions: fields.filter((f) => f.class === 'unexpected_regression').length,
    approvedImprovements: fields.filter((f) => f.class === 'approved_improvement').length,
    expectedAbstentions: fields.filter((f) => f.class === 'expected_abstention').length,
    parity: fields.length ? Number((agree / fields.length).toFixed(4)) : 1,
  };
}

/** Corpus-level shadow delta (U1) — delegates to the single classifier. */
export function runSemanticDelta(cases: { legacy: CompanyProfileInput; sources: EvidenceSources }[]): SemanticDeltaReport {
  const companies: CompanyDelta[] = cases.map(({ legacy, sources }) => {
    const u = buildCompanyUnderstandingFromEvidence(sources, legacy.asOf);
    const d = classifyLegacySurfaceDelta(legacy, toLegacyFields(u));
    return { companyId: u.key.companyId, fields: d.fields, regressions: d.unexpectedRegressions, improvements: d.approvedImprovements, abstentions: d.expectedAbstentions };
  });
  return {
    companies,
    totalRegressions: companies.reduce((s, c) => s + c.regressions, 0),
    approvedImprovements: companies.reduce((s, c) => s + c.improvements, 0),
    expectedAbstentions: companies.reduce((s, c) => s + c.abstentions, 0),
  };
}
