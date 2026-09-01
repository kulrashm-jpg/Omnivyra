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
 * LI-1 — canonical attribute contracts. Storage shape and the two closed
 * vocabularies the database enforces, published so ingestion and enrichment
 * conform to one definition instead of each inventing their own. These are
 * attributes, never identity: LinkedIn and other profiles remain evidence in
 * `identity_claims` / `external_keys`, and no attribute carries a unique
 * constraint.
 */
export {
  SENIORITY_VALUES,
  EMPLOYEE_BANDS,
  PERSON_ATTRIBUTE_COLUMNS,
  ACCOUNT_ATTRIBUTE_COLUMNS,
  normalizeDisplayText,
  normalizeCountryCode,
  normalizeEmployeeCount,
  isSeniority,
  isEmployeeBand,
  toPersonAttributes,
  toAccountAttributes,
  type Seniority,
  type EmployeeBand,
  type PersonAttributes,
  type AccountAttributes,
  type NormalizedAccountAttributes,
  type AttributeProvenance,
} from './attributes';

/**
 * LI-3B — canonical contact governance. The type vocabulary, channel semantics
 * and a PURE evaluator answering "may this tenant contact this person on this
 * channel now?".
 *
 * Tenant-scoped by construction: there is no global scope and no `__global__`
 * sentinel (ADR D-1). The evaluator performs no I/O and is called by nothing —
 * wiring it into the outreach governance gate is LI-3C.
 */
export {
  GOVERNANCE_TYPES,
  KNOWN_CHANNELS,
  ALL_CHANNELS,
  CONTACT_GOVERNANCE_COLUMNS,
  CONTACT_GOVERNANCE_VERSION,
  isGovernanceType,
  mayContact,
  type GovernanceType,
  type GovernanceChannel,
  type KnownChannel,
  type GovernanceRecord,
  type GovernanceDecision,
  type MayContactInput,
  type MayContactResult,
} from './contactGovernance';

/**
 * LI-3D — the governance WRITER. The only module permitted to create or revoke
 * a contact governance record. Idempotent by database constraint (insert →
 * catch 23505), append-only, and tenant-safe by composite foreign key rather
 * than by a pre-check.
 */
export {
  recordContactGovernance,
  revokeContactGovernance,
  GovernanceWriteError,
  type RecordGovernanceInput,
  type RecordGovernanceResult,
  type RevokeGovernanceInput,
} from './contactGovernanceWriter';

/**
 * LI-4C — person lifecycle and duplicate parking. Deterministic detection only
 * (exact email / phone / provider-identifier equality), and NO merge executor:
 * ADR D-4 requires governance to survive a merge, so merging stays disabled
 * until the governance lookup can follow a merge chain.
 */
export {
  DUPLICATE_CLASSIFICATIONS,
  MATCH_SIGNALS,
  CANDIDATE_STATUSES,
  PERSON_STATUSES,
  detectPersonDuplicates,
  parkDuplicateCandidate,
  detectAndParkDuplicates,
  resolveDuplicateCandidate,
  listOpenDuplicateCandidates,
  type DuplicateClassification,
  type MatchSignal,
  type CandidateStatus,
  type PersonStatus,
  type DuplicateSignals,
  type DetectedDuplicate,
  type ParkResult,
} from './personDuplicates';

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

/**
 * W4 — deterministic prospect-account resolution and the canonical
 * person → account edge. Resolves the EXTERNAL company only; people are still
 * resolved exclusively by `identityResolutionService.resolveUnifiedPerson`.
 * Company name is never an identity key, and disagreement returns `ambiguous`
 * rather than a merge.
 */
export {
  resolveAccountShadow,
  resolveOrCreateAccount,
  attachPersonToAccount,
  ACCOUNT_RESOLUTION_VERSION,
  W4_SOURCE,
  type AccountCandidate,
  type AccountResolution,
  type AccountOutcome,
} from './accountResolution';

/**
 * B1 — the social contact identity edge, closed at ingestion. Resolves a
 * freshly-created `contacts` row against the canonical claims store, writes ONE
 * `external_id` claim carrying the verdict, and links `unified_person_id` only
 * on a single deterministic match. It never creates a person from a bare handle,
 * never resolves on a profile URL, and never uses a name as an identity key.
 * Additive and fail-open: it cannot break social signal ingestion.
 */
export {
  resolveSocialContactIdentity,
  buildSocialContactClaim,
  classifySocialClaimFailure,
  SOCIAL_CONTACT_RESOLUTION_VERSION,
  SOCIAL_CONTACT_SOURCE,
  SOCIAL_CONTACT_CLAIM_TYPE,
  type SocialContactOutcome,
  type SocialClaimOutcome,
  type SocialContactIdentityInput,
  type SocialContactResolutionResult,
} from './socialContactResolution';

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
