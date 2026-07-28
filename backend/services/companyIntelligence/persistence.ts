/**
 * CI-B207 — Canonical Company persistence contract (pure shape builder; NO writer wired in Phase B).
 * The shadow record is stored (in a later phase) at `report_settings.canonical_understanding`
 * (continuous with the certified ontology shadow location). A compat adapter maps the canonical
 * understanding back to the legacy profile-field shape so consumers keep working during adoption.
 */

import type { CompanyUnderstanding, CompanyProjection, CompanyUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: CompanyUnderstanding, projection: CompanyProjection, parity: number | null): CompanyUnderstandingShadowRecord {
  return { company_id: u.key.companyId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

/** Canonical → legacy profile-field shape (consumers remain operational; legacy = consumer, not owner). */
export interface LegacyCompanyFields {
  name: string | null; domain: string | null; category: string | null; business_model: string | null;
  products: string[]; services: string[]; competitors: string[]; confidence: number;
}
export function toLegacyFields(u: CompanyUnderstanding): LegacyCompanyFields {
  const id = u.facets.identity.value; const off = u.facets.offerings.value; const wv = u.facets.worldView.value; const comp = u.facets.competitive.value;
  return {
    name: id?.name ?? null,
    domain: id?.domain ?? null,
    category: wv?.category ?? u.facets.marketPosition.value?.segment ?? null,
    business_model: wv?.businessModel ?? null,
    products: off?.products ?? [],
    services: off?.services ?? [],
    competitors: comp?.competitors ?? [],
    confidence: u.score.confidence,
  };
}
