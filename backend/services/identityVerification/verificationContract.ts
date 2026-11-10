/**
 * Identity verification contract — WHAT may make an external platform account a
 * PERSON's, and what may not.
 *
 * `identity_claims.verification_state = 'verified'` (W1, 20260920000000) is the
 * only state the community person proof (orchestration/communityIdentityProof.ts)
 * accepts. This module defines what a verified `external_id` claim must CARRY in
 * its `evidence` before that state is honoured, so that "verified" can never be a
 * bare flag a writer sets. Pure: no I/O, no clock unless one is passed.
 *
 * ─── WHAT EXISTS IN THE REPOSITORY TODAY (inspected 2026-10-28) ────────────
 *   - Every identity_claims writer records 'unverified' (prospectIdentity/
 *     canonicalisation.ts `toRow`; socialContactResolution.ts via persistClaims).
 *   - Every platform OAuth flow (pages/api/auth/{linkedin,x,facebook,youtube,
 *     instagram,...}/callback.ts; pages/api/community-ai/connectors/*\/callback.ts)
 *     requires a signed-in TENANT user (getSupabaseUserFromRequest +
 *     assertTenantAccess, state user == session user) and stores the TENANT's
 *     token (social_accounts / community_ai_platform_tokens). It proves the
 *     tenant controls an account. It says nothing about which PROSPECT owns
 *     another account, and a prospect cannot complete it.
 *   => No supported mechanism proves that a specific external account belongs
 *      to a specific person. Nothing in this module or its callers pretends one
 *      exists: the accepted method below has NO writer, so every community link
 *      remains refused until one is built and reviewed.
 *
 * ─── THE ONE ACCEPTED METHOD: subject_platform_oauth ──────────────────────
 * The PERSON (not an operator, not the tenant) completes the platform's OAuth
 * consent in a flow bound to (tenant, person), and the provider returns the
 * provider user id. The claim's evidence must then say exactly that:
 *   method            'subject_platform_oauth'
 *   provider          = the claim's platform
 *   provider_user_id  normalizes to the claim's normalized_value
 *   subject_person_id = the claim's person_id     (a reassigned claim fails)
 *   organization_id   = the claim's tenant        (a copied claim fails)
 *   flow_id           the verification flow / OAuth state id (non-blank)
 *   completed_at      ISO time the provider answered; not in the future
 *                     (5 min skew), not older than MAX_PROOF_AGE_DAYS (stale)
 *
 * ─── NEVER A PROOF ────────────────────────────────────────────────────────
 * Operator attestation / confirmation, resolver matches, imports and manual
 * entry are NON_PROVING_METHODS: a verified claim carrying one is refused, and
 * an attestation record (identity_verification_attestations) can never set
 * verification_state (attestationStore.ts never writes identity_claims; the
 * table's `confers_verification` is CHECKed false).
 *
 * ─── FUTURE OPERATOR CONFIRMATION — WHAT IT WOULD NEED ────────────────────
 * See OPERATOR_CONFIRMATION_REQUIREMENTS. Until an owner adds a reviewed method
 * to ACCEPTED_PROOF_METHODS (here AND in the database guard, migration
 * 20261231000007), operator confirmation confers nothing.
 */
import { normalizeClaimValue } from '../prospectIdentity/normalization';

/** Methods whose evidence can make an external_id claim a person's. */
export const ACCEPTED_PROOF_METHODS = ['subject_platform_oauth'] as const;
export type AcceptedProofMethod = typeof ACCEPTED_PROOF_METHODS[number];

/** Methods that are recorded but NEVER prove ownership. */
export const NON_PROVING_METHODS = [
  'operator_attestation',
  'operator_confirmation',
  'resolver_match',
  'import',
  'manual',
] as const;

/** A proof older than this no longer proves current ownership (accounts change hands). */
export const MAX_PROOF_AGE_DAYS = 365;
/** Clock skew tolerated for a provider timestamp. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// The two lists must never meet: a method cannot be both.
for (const m of ACCEPTED_PROOF_METHODS) {
  if ((NON_PROVING_METHODS as readonly string[]).includes(m)) {
    throw new Error(`identity verification contract: ${m} is both accepted and non-proving`);
  }
}

export type EvidenceVerdict =
  | { ok: true; method: AcceptedProofMethod }
  | { ok: false; reason: EvidenceRefusal };

export type EvidenceRefusal =
  | 'evidence_missing'
  | 'method_non_proving'
  | 'method_unsupported'
  | 'tenant_mismatch'
  | 'person_mismatch'
  | 'provider_mismatch'
  | 'provider_user_id_mismatch'
  | 'flow_missing'
  | 'timestamp_invalid'
  | 'timestamp_future'
  | 'proof_stale';

export interface VerifiedClaimForEvidence {
  organization_id: string | null;
  person_id: string | null;
  platform: string | null;
  normalized_value: string | null;
  evidence?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Does a claim's evidence carry an ACCEPTED, self-consistent person-level proof?
 * Called only for a claim that is already verification_state 'verified'.
 */
export function evaluateClaimEvidence(claim: VerifiedClaimForEvidence, now: Date = new Date()): EvidenceVerdict {
  const ev = claim.evidence;
  if (!isObject(ev)) return { ok: false, reason: 'evidence_missing' };
  const method = str(ev.method);
  if (method === null) return { ok: false, reason: 'evidence_missing' };
  if ((NON_PROVING_METHODS as readonly string[]).includes(method)) return { ok: false, reason: 'method_non_proving' };
  if (!(ACCEPTED_PROOF_METHODS as readonly string[]).includes(method)) return { ok: false, reason: 'method_unsupported' };

  if (str(ev.organization_id) === null || str(ev.organization_id) !== claim.organization_id) {
    return { ok: false, reason: 'tenant_mismatch' };
  }
  if (str(ev.subject_person_id) === null || str(ev.subject_person_id) !== claim.person_id) {
    return { ok: false, reason: 'person_mismatch' };
  }
  const provider = str(ev.provider)?.toLowerCase() ?? null;
  if (provider === null || provider !== claim.platform) return { ok: false, reason: 'provider_mismatch' };
  const providerUserId = normalizeClaimValue('external_id', typeof ev.provider_user_id === 'string' ? ev.provider_user_id : null);
  if (!providerUserId || providerUserId !== claim.normalized_value) return { ok: false, reason: 'provider_user_id_mismatch' };
  if (str(ev.flow_id) === null) return { ok: false, reason: 'flow_missing' };

  const completed = str(ev.completed_at);
  const at = completed === null ? NaN : Date.parse(completed);
  if (!Number.isFinite(at)) return { ok: false, reason: 'timestamp_invalid' };
  if (at > now.getTime() + MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'timestamp_future' };
  if (now.getTime() - at > MAX_PROOF_AGE_DAYS * 24 * 60 * 60 * 1000) return { ok: false, reason: 'proof_stale' };

  return { ok: true, method: method as AcceptedProofMethod };
}

/**
 * Operator attestation records (identity_verification_attestations) and any
 * operator confirmation flow confer NO verification. This is a constant, not a
 * setting: changing it requires changing ACCEPTED_PROOF_METHODS, the database
 * guard, and this function, under owner review.
 */
export function operatorAttestationConfersVerification(): false {
  return false;
}

/**
 * What a FUTURE operator-confirmation workflow would have to capture, and who
 * would have to approve, before an owner could consider adding it to
 * ACCEPTED_PROOF_METHODS. Operator say-so alone is never on this list: each item
 * is evidence produced by the PLATFORM or the PERSON, observed by the system.
 */
export const OPERATOR_CONFIRMATION_REQUIREMENTS = Object.freeze([
  {
    id: 'platform_challenge',
    requirement: 'A server-issued, single-use challenge nonce (>= 128 bits, TTL <= 24h) bound to (tenant, person, platform, provider user id), '
      + 'that the ACCOUNT ITSELF publishes or sends (post, bio field, or DM to the tenant\'s connected account).',
  },
  {
    id: 'platform_observation',
    requirement: 'The system — not the operator — reads the nonce back through the platform API with the tenant\'s connector token, and the '
      + 'provider-returned AUTHOR id equals the claimed provider user id. Screenshots, URLs or operator-typed text do not count.',
  },
  {
    id: 'raw_response_digest',
    requirement: 'SHA-256 of the provider API response, the API endpoint, the provider object id of the post/message, and the observation time.',
  },
  {
    id: 'subject_and_tenant',
    requirement: 'organization_id, subject person_id, platform, normalized provider user id — identical to the claim the proof would verify.',
  },
  {
    id: 'operator_identity_step_up',
    requirement: 'Initiating operator user id, holding PROSPECT_INGEST in the tenant, with an active phishing-resistant step-up session (id + factor recorded).',
  },
  {
    id: 'second_approver',
    requirement: 'A DIFFERENT user (four-eyes) holding PROSPECT_INGEST with phishing-resistant step-up approves after observation; self-approval refused.',
  },
  {
    id: 'lawful_basis',
    requirement: 'A recorded lawful basis / consent reference for processing the person\'s platform identity in this tenant.',
  },
  {
    id: 'revocation_and_expiry',
    requirement: 'Revocation through identity_claims.revoked_at (+ revoked_reason) and re-verification after MAX_PROOF_AGE_DAYS.',
  },
  {
    id: 'owner_decision',
    requirement: 'The product owner adds the method to ACCEPTED_PROOF_METHODS and to the database guard in one reviewed change, with tests.',
  },
] as const);
