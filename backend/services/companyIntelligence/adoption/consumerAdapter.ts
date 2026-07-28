/**
 * CI-D407 — Company consumer read-adapter (the ONE seam). Consumers read company semantics through
 * `resolveCompanyProjection`: CANONICAL projection when the authoritative flag is ON for the tenant,
 * else the LEGACY profile fields (fallback). No migrated consumer bypasses this seam; flag OFF ⇒
 * byte-identical legacy behaviour ⇒ zero production change + O(1) rollback. Parity validation included.
 */

import type { CompanyProfileInput } from '../fromProfile';
import { companyFromProfile } from '../fromProfile';
import { buildCompanyUnderstanding } from '../builder';
import { toLegacyFields, type LegacyCompanyFields } from '../persistence';
import { isCompanyProjectionAuthoritative } from '../flags';
import { compareToLegacy } from '../shadowRuntime';

export interface ResolvedCompanyProjection { source: 'canonical' | 'legacy'; fields: LegacyCompanyFields; }

/** Legacy profile → the legacy-shaped fields (the compatibility default). */
function legacyProjection(p: CompanyProfileInput): LegacyCompanyFields {
  return {
    name: p.name ?? null, domain: p.domain ?? null, category: p.category ?? null,
    business_model: p.businessModel ?? null, products: p.products ?? [], services: p.services ?? [],
    competitors: p.competitors ?? [], confidence: 0,
  };
}

/**
 * THE consumer seam. Default (flag OFF) ⇒ legacy fields, byte-identical to today. Flag ON ⇒ the
 * canonical projection (built from the same profile evidence) served in the legacy shape.
 */
export function resolveCompanyProjection(profile: CompanyProfileInput): ResolvedCompanyProjection {
  if (!isCompanyProjectionAuthoritative()) return { source: 'legacy', fields: legacyProjection(profile) };
  const a = companyFromProfile(profile);
  const u = buildCompanyUnderstanding({ key: { companyId: profile.companyId }, builtAt: profile.asOf, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
  return { source: 'canonical', fields: toLegacyFields(u) };
}

export interface ConsumerParity { companyId: string; parity: number; matches: boolean; }
/** Shadow parity for a consumer: canonical vs legacy fields (adoption gate). */
export function validateConsumerParity(profile: CompanyProfileInput): ConsumerParity {
  const a = companyFromProfile(profile);
  const u = buildCompanyUnderstanding({ key: { companyId: profile.companyId }, builtAt: profile.asOf, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
  const parity = compareToLegacy(u, profile).parity;
  return { companyId: profile.companyId, parity, matches: parity >= 0.999 };
}
