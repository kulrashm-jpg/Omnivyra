/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 1 — Company Profile adoption seam.
 *
 * The Company Profile surface obtains its company IDENTITY (name/domain/category/business_model/
 * products/services/competitors) ONLY through this reader → `resolveCompanyProjection`. It NEVER
 * classifies, infers, reinterprets, overrides, repairs, or reconstructs identity; it only READS the
 * projection and FORMATS it into the surface shape. Pure & deterministic. Flag OFF (default) ⇒
 * byte-identical legacy identity (O(1) rollback). Explainability is preserved via `observation.deltas`.
 */

import { resolveCompanyProjection, type ResolveOptions, type ProjectionObservation, type ProjectionPath } from '../consumerAdapter';
import type { CompanyProfileInput } from '../../fromProfile';
import type { EvidenceSources } from '../../evidence';

/** The identity view the Company Profile surface renders (legacy-compatible; camelCase surface shape). */
export interface CompanyProfileIdentityView {
  name: string | null;
  domain: string | null;
  category: string | null;
  businessModel: string | null;
  products: string[];
  services: string[];
  competitors: string[];
  confidence: number;
  projectionSource: ProjectionPath;      // legacy | canonical_evidence | canonical_profile | legacy_fallback
  projectionVersion: number;
  observation: ProjectionObservation;    // full explainability chain (deltas + parity + flag state)
}

export interface CompanyProfileIdentityInput extends CompanyProfileInput { evidence?: EvidenceSources }

/**
 * Consumer-1 identity read. The ONLY way the Company Profile surface may obtain company identity.
 * Consumes the projection; performs no derivation. Flag OFF ⇒ legacy identity, byte-identical.
 */
export function readCompanyProfileIdentity(input: CompanyProfileIdentityInput): CompanyProfileIdentityView {
  const opts: ResolveOptions = input.evidence ? { evidence: input.evidence } : {};
  const { source, fields, observation } = resolveCompanyProjection(input, opts);
  return {
    name: fields.name,
    domain: fields.domain,
    category: fields.category,
    businessModel: fields.business_model, // pure rename (surface camelCase) — no reinterpretation
    products: fields.products,
    services: fields.services,
    competitors: fields.competitors,
    confidence: fields.confidence,
    projectionSource: source,
    projectionVersion: observation.version,
    observation,
  };
}

// ── Live-record adoption (the Company Profile display API reads identity through this) ─────────────

/** The stored Company Profile record fields the consumer maps into the projection input. */
export interface CompanyProfileRecordLike {
  name?: string | null;
  website_url?: string | null;
  category?: string | null;
  business_classification?: { level_1?: string | null } | null;
  competitors?: string[] | null;
}

/** Map a stored Company Profile record → projection input (identity fields only). Pure; no derivation. */
export function companyProfileRecordToInput(record: CompanyProfileRecordLike, companyId: string, asOf: string): CompanyProfileIdentityInput {
  return {
    companyId,
    asOf,
    name: record.name ?? undefined,
    domain: record.website_url ?? undefined,
    category: record.category ?? undefined,
    businessModel: record.business_classification?.level_1 ?? undefined,
    competitors: Array.isArray(record.competitors) ? record.competitors : undefined,
  };
}

/**
 * Consumer-1 adoption overlay for the Company Profile display record. The display consumer obtains its
 * `category` identity through the projection instead of reading the raw stored field directly.
 * Flag OFF (default) ⇒ returns the SAME record reference, untouched (proven byte-identical no-op, O(1)
 * rollback). Flag ON ⇒ overlays the cleanly-mapped `category` from the canonical projection. Pure.
 * (competitors keep their dedicated read-time pipeline; business_classification decomposition and the
 * products_services string are intentionally not remapped here — adopt, do not redesign.)
 */
export function adoptCompanyProfileIdentity<T>(record: T, companyId: string, asOf: string): T {
  const like = record as unknown as CompanyProfileRecordLike;
  const identity = readCompanyProfileIdentity(companyProfileRecordToInput(like, companyId, asOf));
  if (identity.projectionSource === 'legacy') return record; // flag OFF ⇒ untouched, same reference
  return { ...(record as Record<string, unknown>), category: identity.category } as unknown as T;
}
