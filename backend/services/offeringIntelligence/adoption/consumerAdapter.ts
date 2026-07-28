/**
 * OI-D404 — Offering consumer read-adapter (the ONE seam). Consumers (Company/GTM/Content) read
 * offering semantics through `resolveOfferingProjection`: CANONICAL projection when the authoritative
 * flag is ON for the tenant, else the LEGACY offering fields (fallback from the seed). No migrated
 * consumer bypasses this seam; flag OFF ⇒ byte-identical legacy behaviour ⇒ zero production change +
 * O(1) rollback. Parity validation included.
 */

import type { OfferingSeedInput } from '../fromSeed';
import { offeringFromSeed } from '../fromSeed';
import { buildOfferingUnderstanding } from '../builder';
import { toLegacyFields, type LegacyOfferingFields } from '../persistence';
import { isOfferingProjectionAuthoritative } from '../flags';
import { compareToLegacy } from '../shadowRuntime';

export interface ResolvedOfferingProjection { source: 'canonical' | 'legacy'; fields: LegacyOfferingFields; }

function legacyProjection(s: OfferingSeedInput): LegacyOfferingFields {
  return {
    company_id: s.companyId, offering_id: (s.name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'offering',
    name: s.name ?? null, offering_type: s.offeringType ?? null, category: s.category ?? null,
    features: s.features ?? [], pricing_plans: s.plans ?? [], differentiators: s.differentiators ?? [], confidence: 0,
  };
}

export function resolveOfferingProjection(seed: OfferingSeedInput): ResolvedOfferingProjection {
  if (!isOfferingProjectionAuthoritative()) return { source: 'legacy', fields: legacyProjection(seed) };
  const a = offeringFromSeed(seed);
  const u = buildOfferingUnderstanding({ key: a.key, builtAt: seed.asOf, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
  return { source: 'canonical', fields: toLegacyFields(u) };
}

export interface OfferingConsumerParity { offeringId: string; parity: number; matches: boolean; }
export function validateOfferingConsumerParity(seed: OfferingSeedInput): OfferingConsumerParity {
  const a = offeringFromSeed(seed);
  const u = buildOfferingUnderstanding({ key: a.key, builtAt: seed.asOf, facets: a.facets, evidence: a.evidence, offeringType: a.offeringType });
  const parity = compareToLegacy(u, seed).parity;
  return { offeringId: u.key.offeringId, parity, matches: parity >= 0.999 };
}
