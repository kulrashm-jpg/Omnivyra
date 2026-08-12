/**
 * W1 — canonical prospect / identity foundation (public surface).
 *
 * SCOPE: storage contracts, deterministic normalization, and READ-ONLY shadow
 * resolution. Nothing here enriches, scores, contacts, merges or migrates.
 *
 * Canonical entities, as ratified by the Phase 0.5 ADR and re-verified against
 * production before this module was written:
 *
 *   companies          the Omnivyra TENANT. Never a prospect.
 *   prospect_accounts  the external company being pursued. Tenant-scoped.
 *   unified_persons    the canonical person spine (pre-existing, unchanged).
 *   identity_claims    durable, explainable identity assertions.
 *
 * Identity is TENANT-SCOPED throughout. The same human, email, phone, profile
 * or domain may exist independently in two tenants, and must: a platform-global
 * person would be a shared mutable object two tenants enrich and suppress
 * against each other.
 *
 * The live write path remains `identityResolutionService.resolveUnifiedPerson`.
 * This module does not replace it and does not write to the spine.
 */

export {
  normalizeClaimValue,
  normalizeDomainClaim,
  normalizeExternalIdentity,
  normalizePlatform,
  normalizeEmail,
  normalizePhone,
  normalizeCompanyDomain,
  isClaimType,
  isPlatformFree,
  CLAIM_TYPES,
  PLATFORM_FREE_CLAIM_TYPES,
  type ClaimType,
} from './normalization';

export {
  resolveIdentityShadow,
  evaluateCandidate,
  type IdentityCandidate,
  type CandidateVerdict,
  type ShadowResolution,
  type ResolutionOutcome,
} from './shadowResolver';

/**
 * W3 — legacy → canonical transcription. Turns identity evidence that is
 * already explicit in legacy columns into durable claims. It resolves nothing
 * and merges nothing; the shadow resolver above still answers "who is this",
 * and identityResolutionService remains the only resolve-or-create path.
 */
export {
  analyseCanonicalisation,
  persistClaims,
  runCanonicalisation,
  deriveFromPerson,
  deriveFromContact,
  CANONICALISATION_VERSION,
  CANONICALISATION_SOURCE,
  type DerivedClaim,
  type DerivationSummary,
  type BackfillResult,
} from './canonicalisation';

/** Table names, so callers do not hand-write string literals. */
export const PROSPECT_ACCOUNTS_TABLE = 'prospect_accounts';
export const IDENTITY_CLAIMS_TABLE = 'identity_claims';
export const UNIFIED_PERSONS_TABLE = 'unified_persons';

/**
 * The uniqueness rule for an identity claim, stated once in code so it cannot
 * drift from the database. Mirrors uq_identity_claims_tenant_identity:
 *
 *   (organization_id, claim_type, platform, normalized_value)
 *   NULLS NOT DISTINCT, among rows WHERE revoked_at IS NULL
 *
 * NULLS NOT DISTINCT matters: `platform` is NULL for email/phone/domain, and
 * under PostgreSQL's default NULLS DISTINCT two identical email claims would
 * both be accepted because NULL <> NULL — defeating the constraint for the
 * three most common claim types.
 */
export const IDENTITY_CLAIM_UNIQUENESS = Object.freeze({
  columns: ['organization_id', 'claim_type', 'platform', 'normalized_value'] as const,
  nullsNotDistinct: true,
  activeOnly: true,
  index: 'uq_identity_claims_tenant_identity',
});

/**
 * Account identity uniqueness. Mirrors uq_prospect_accounts_org_domain_active:
 * (organization_id, domain_normalized) among rows WHERE status = 'active'.
 * Partial on status so a merged or archived account never blocks a live one.
 */
export const PROSPECT_ACCOUNT_UNIQUENESS = Object.freeze({
  columns: ['organization_id', 'domain_normalized'] as const,
  activeOnly: true,
  index: 'uq_prospect_accounts_org_domain_active',
});
