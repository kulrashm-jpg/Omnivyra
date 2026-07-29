/**
 * OI-B208 — Canonical Offering persistence contract (pure shape builder; NO writer wired in Phase B).
 * A compat adapter maps the canonical understanding to a legacy offering-field shape so consumers
 * (Company/GTM/Content) can be served the offering projection during adoption — Offering is the sole
 * owner; consumers reference it.
 */

import type { OfferingUnderstanding, OfferingProjection, OfferingUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: OfferingUnderstanding, projection: OfferingProjection, parity: number | null): OfferingUnderstandingShadowRecord {
  return { company_id: u.key.companyId, offering_id: u.key.offeringId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

export interface LegacyOfferingFields {
  company_id: string; offering_id: string;
  name: string | null; offering_type: string | null; category: string | null;
  features: string[]; pricing_plans: string[]; differentiators: string[]; confidence: number;
}
export function toLegacyFields(u: OfferingUnderstanding): LegacyOfferingFields {
  const id = u.facets.identity.value;
  return {
    company_id: u.key.companyId,
    offering_id: u.key.offeringId,
    name: id?.name ?? null,
    offering_type: u.facets.offeringType.value ?? null,
    category: u.facets.category.value?.category ?? null,
    features: u.facets.features.value?.features ?? [],
    pricing_plans: u.facets.pricing.value?.plans ?? [],
    differentiators: u.facets.differentiators.value?.differentiators ?? [],
    confidence: u.score.confidence,
  };
}
