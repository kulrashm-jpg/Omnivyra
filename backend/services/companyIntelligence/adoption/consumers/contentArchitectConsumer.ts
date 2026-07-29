/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 2 — Content Architect adoption seam.
 *
 * The Content Architect content pipeline obtains its projection-owned COMPANY IDENTITY (`category`)
 * through this reader → `resolveCompanyProjection`, before context/prompt construction. It NEVER
 * classifies, infers, reinterprets, repairs, reclassifies, or overrides identity — it READS the
 * projection and overlays it onto the profile the pipeline consumes. Pure & deterministic. Flag OFF
 * (default) ⇒ returns the SAME profile reference, byte-identical (O(1) rollback).
 *
 * Scope note: the projection owns *company identity* (name/domain/category/products/competitors). Content
 * Architect's `industry` / `target_audience` / `ideal_customer_profile` / `brand_positioning` reads are
 * AUDIENCE & STRATEGY context — not company identity — so they legitimately remain profile/strategy reads
 * and are out of this seam's scope. `products`/`competitors` follow their existing pipelines (see C1).
 */

import { readCompanyProfileIdentity, companyProfileRecordToInput, type CompanyProfileRecordLike } from './companyProfileConsumer';
import type { EvidenceSources } from '../../evidence';

/**
 * Consumer-2 identity adoption. Overlays the projected `category` onto the profile the Content Architect
 * pipeline reads. Flag OFF ⇒ same reference (no-op). Flag ON ⇒ projected category (evidence-derived when
 * `evidence` is supplied; otherwise the profile-derived canonical value = the stored category). Pure.
 */
export function adoptContentArchitectIdentity<T>(
  profile: T,
  companyId: string,
  asOf: string,
  evidence?: EvidenceSources,
): T {
  if (profile == null) return profile;
  const input = { ...companyProfileRecordToInput(profile as unknown as CompanyProfileRecordLike, companyId, asOf), evidence };
  const identity = readCompanyProfileIdentity(input);
  if (identity.projectionSource === 'legacy') return profile; // flag OFF ⇒ untouched, same reference
  return { ...(profile as Record<string, unknown>), category: identity.category } as unknown as T;
}
