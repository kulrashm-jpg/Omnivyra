/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 5 — Lead Intelligence adoption seam.
 *
 * "Lead Intelligence" is mixed: the canonical `leadUnderstanding/` + `leadIntelligence/` spine is
 * REFERENCES-ONLY (keyed by companyId; reads no company identity — certified by a guard test). The
 * Active-Leads SOURCE-RECOMMENDATION surface, however, CONSUMES the company's projection-owned `category`
 * (→ industry bucket) to score lead sources. This seam routes that `category` acquisition through
 * `resolveCompanyProjection`. It NEVER reclassifies/repairs/overrides identity — it READS the projected
 * value and overlays it onto the profile row the source-rec engine reads. Pure & deterministic. Flag OFF
 * (default) ⇒ same profile reference, byte-identical (O(1) rollback).
 *
 * Scope: `industry` is NOT owned by the projection surface, so the industry-driven qualifier prompts and the
 * `active-leads/context.ts` keyword classifier are documented (industry model-coverage gap + U5 classifier
 * retirement), not migrated here. Lead/behavior/engagement data is never touched.
 */

import { readCompanyProfileIdentity, companyProfileRecordToInput, type CompanyProfileRecordLike } from './companyProfileConsumer';
import type { EvidenceSources } from '../../evidence';

/**
 * Overlay the projected company `category` onto a profile row consumed by Lead Intelligence's
 * source-recommendation surface. Flag OFF ⇒ same reference (no-op); flag ON ⇒ projected category
 * (evidence-derived when supplied, else profile-derived). Pure & deterministic.
 */
export function adoptLeadCompanyIdentity<T>(profile: T, companyId: string, asOf: string, evidence?: EvidenceSources): T {
  if (profile == null) return profile;
  const input = { ...companyProfileRecordToInput(profile as unknown as CompanyProfileRecordLike, companyId, asOf), evidence };
  const identity = readCompanyProfileIdentity(input);
  if (identity.projectionSource === 'legacy') return profile; // flag OFF / no canonical ⇒ untouched, same reference
  return { ...(profile as Record<string, unknown>), category: identity.category } as unknown as T;
}
