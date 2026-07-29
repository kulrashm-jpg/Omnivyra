/**
 * CI-D407 / U2 — Company consumer read-adapter (the ONE seam). Consumers read company semantics through
 * `resolveCompanyProjection`. Routing:
 *   • flag OFF (default)                     → LEGACY projection (byte-identical to today; O(1) rollback)
 *   • flag ON + EvidenceSources supplied     → EVIDENCE-derived canonical projection (U1 pipeline)
 *   • flag ON + no evidence supplied         → PROFILE-derived canonical projection (U0 behaviour)
 *
 * U2 changes only the SOURCE of the authoritative projection (profile → evidence) behind the flag, with a
 * FAIL-SAFE parity gate: any UNEXPECTED regression (a parity-locked field diverging) falls back to legacy
 * and is recorded. Approved semantic improvements (category/solution_domains/…) pass. Consumers are NOT
 * migrated here and no default is enabled. Projection stays pure/deterministic/side-effect-free.
 */

import type { CompanyProfileInput } from '../fromProfile';
import { companyFromProfile } from '../fromProfile';
import { buildCompanyUnderstanding, COMPANY_MODEL_VERSION } from '../builder';
import { toLegacyFields, type LegacyCompanyFields } from '../persistence';
import { isCompanyProjectionAuthoritative } from '../flags';
import { compareToLegacy } from '../shadowRuntime';
import { buildCompanyUnderstandingFromEvidence, classifyLegacySurfaceDelta, type EvidenceSources, type FieldDelta } from '../evidence';
import type { CompanyUnderstanding } from '../types';

// U5 Stage A adds the authoritative READ path: when a PERSISTED canonical understanding is supplied, the
// projection reads it (production source of truth) instead of reconstructing via companyFromProfile.
export type ProjectionPath = 'legacy' | 'canonical_profile' | 'canonical_evidence' | 'canonical_persisted' | 'legacy_fallback';

/** Pure observability record for one projection resolution (no wall-clock; latency measured at the harness). */
export interface ProjectionObservation {
  companyId: string;
  version: number;
  path: ProjectionPath;
  flagAuthoritative: boolean;
  parity: number | null;
  unexpectedRegressions: number;
  approvedImprovements: number;
  deltas: FieldDelta[];
}

/**
 * Additive read-only view of the canonical worldView (the interpretive identity fields some consumers —
 * e.g. Market Pulse — read). Exposes already-computed canonical values; does NOT re-derive. `null` on the
 * legacy / fail-safe paths so those consumers fall back to their stored values (byte-identical when OFF).
 */
export interface ProjectedWorldView { category: string | null; businessModel: string | null; operatingModel: string | null; domainRole: string | null; }

export interface ResolvedCompanyProjection { source: ProjectionPath; fields: LegacyCompanyFields; observation: ProjectionObservation; worldView: ProjectedWorldView | null; }

export interface ResolveOptions {
  evidence?: EvidenceSources;
  /** U5 Stage A: the PERSISTED canonical understanding (from report_settings.canonical_understanding). When
   * supplied under the authoritative flag, the projection reads it as the production source of truth. */
  persistedCanonical?: CompanyUnderstanding;
}

/** Read the decided worldView facet (primaryMotion ⇒ operating model, marketPosition ⇒ domain role). */
function worldViewOf(u: { facets: { worldView: { value: { category?: string; businessModel?: string; primaryMotion?: string; marketPosition?: string } | null } } }): ProjectedWorldView {
  const wv = u.facets.worldView.value;
  return { category: wv?.category ?? null, businessModel: wv?.businessModel ?? null, operatingModel: wv?.primaryMotion ?? null, domainRole: wv?.marketPosition ?? null };
}

/** Legacy profile → the legacy-shaped fields (the compatibility default). */
function legacyProjection(p: CompanyProfileInput): LegacyCompanyFields {
  return {
    name: p.name ?? null, domain: p.domain ?? null, category: p.category ?? null,
    business_model: p.businessModel ?? null, products: p.products ?? [], services: p.services ?? [],
    competitors: p.competitors ?? [], confidence: 0,
  };
}

const obs = (companyId: string, version: number, path: ProjectionPath, flag: boolean, parity: number | null, regressions: number, improvements: number, deltas: FieldDelta[]): ProjectionObservation =>
  ({ companyId, version, path, flagAuthoritative: flag, parity, unexpectedRegressions: regressions, approvedImprovements: improvements, deltas });

/**
 * THE consumer seam. Default (flag OFF) ⇒ legacy fields, byte-identical to today. Flag ON ⇒ canonical
 * projection served in the legacy shape — evidence-derived when evidence is supplied (fail-safe on
 * unexpected regression), else profile-derived. Pure & deterministic (`asOf`/timestamps injected).
 */
export function resolveCompanyProjection(profile: CompanyProfileInput, opts: ResolveOptions = {}): ResolvedCompanyProjection {
  const authoritative = isCompanyProjectionAuthoritative();

  if (!authoritative) {
    return { source: 'legacy', fields: legacyProjection(profile), observation: obs(profile.companyId, COMPANY_MODEL_VERSION, 'legacy', false, null, 0, 0, []), worldView: null };
  }

  // U5 Stage A — authoritative READ path: the persisted canonical understanding is the production source of
  // truth (no reconstruction, no legacy echo). Same fail-safe as the evidence path: an unexpected regression
  // on a parity-locked field degrades to legacy and is recorded.
  if (opts.persistedCanonical) {
    const u = opts.persistedCanonical;
    const fields = toLegacyFields(u);
    const d = classifyLegacySurfaceDelta(profile, fields);
    if (d.unexpectedRegressions > 0) {
      return { source: 'legacy_fallback', fields: legacyProjection(profile), observation: obs(profile.companyId, u.version, 'legacy_fallback', true, d.parity, d.unexpectedRegressions, d.approvedImprovements, d.fields), worldView: null };
    }
    return { source: 'canonical_persisted', fields, observation: obs(profile.companyId, u.version, 'canonical_persisted', true, d.parity, 0, d.approvedImprovements, d.fields), worldView: worldViewOf(u) };
  }

  if (opts.evidence) {
    const u = buildCompanyUnderstandingFromEvidence(opts.evidence, profile.asOf);
    const fields = toLegacyFields(u);
    const d = classifyLegacySurfaceDelta(profile, fields);
    // Fail-safe: an unexpected regression (parity-locked field diverging) never reaches a consumer.
    if (d.unexpectedRegressions > 0) {
      return { source: 'legacy_fallback', fields: legacyProjection(profile), observation: obs(profile.companyId, u.version, 'legacy_fallback', true, d.parity, d.unexpectedRegressions, d.approvedImprovements, d.fields), worldView: null };
    }
    return { source: 'canonical_evidence', fields, observation: obs(profile.companyId, u.version, 'canonical_evidence', true, d.parity, 0, d.approvedImprovements, d.fields), worldView: worldViewOf(u) };
  }

  // Flag ON, no evidence supplied → profile-derived canonical (adoption baseline; parity 1.0 by design).
  const a = companyFromProfile(profile);
  const u = buildCompanyUnderstanding({ key: { companyId: profile.companyId }, builtAt: profile.asOf, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
  return { source: 'canonical_profile', fields: toLegacyFields(u), observation: obs(profile.companyId, u.version, 'canonical_profile', true, compareToLegacy(u, profile).parity, 0, 0, []), worldView: worldViewOf(u) };
}

export interface ConsumerParity { companyId: string; parity: number; matches: boolean; unexpectedRegressions?: number; approvedImprovements?: number; delta?: FieldDelta[]; }

/**
 * Parity gate. Profile-derived (default): field parity vs legacy, gate at ≥0.999 (unchanged). Evidence-
 * derived (`opts.evidence`): the semantic-delta gate — `matches` iff ZERO unexpected regressions (approved
 * improvements do not fail the gate). Pure & deterministic.
 */
export function validateConsumerParity(profile: CompanyProfileInput, opts: ResolveOptions = {}): ConsumerParity {
  if (!opts.evidence) {
    const a = companyFromProfile(profile);
    const u = buildCompanyUnderstanding({ key: { companyId: profile.companyId }, builtAt: profile.asOf, facets: a.facets, evidence: a.evidence, worldView: a.worldView });
    const parity = compareToLegacy(u, profile).parity;
    return { companyId: profile.companyId, parity, matches: parity >= 0.999 };
  }
  const u = buildCompanyUnderstandingFromEvidence(opts.evidence, profile.asOf);
  const d = classifyLegacySurfaceDelta(profile, toLegacyFields(u));
  return { companyId: profile.companyId, parity: d.parity, matches: d.unexpectedRegressions === 0, unexpectedRegressions: d.unexpectedRegressions, approvedImprovements: d.approvedImprovements, delta: d.fields };
}
