/**
 * Community person proof — does this community action concern the journey's PERSON?
 *
 * A `community` journey step is about one canonical person (the run's subject →
 * `unified_persons`); a community action is about one platform account. Linking
 * the two, or executing the link, is only sound when an AUTHORITATIVE,
 * tenant-owned record says that platform account IS that person. This module is
 * the one place that answers the question, for the link store (link time) and
 * the community adapter (execution time). It reads; it never writes.
 *
 * ─── THE CHAIN, AND WHERE EACH LINK COMES FROM ────────────────────────────
 *   execution task (subject_kind, subject_id)
 *     → canonical person   resolveSubjectPersonId (leadOutreachExecution/
 *                          personAnchor.ts): leads / canonical_leads
 *                          .unified_person_id, tenant-first.
 *   community action
 *     → platform account   community_ai_actions.discovered_user_id
 *                          → community_ai_discovered_users (platform,
 *                          external_user_id): the engine's own record of whom
 *                          the action engages. Tenant-filtered and re-checked.
 *     → canonical person   identity_claims (W1, 20260920000000): ONE active
 *                          (revoked_at IS NULL) `external_id` claim on that
 *                          platform for that normalized provider id, attributed
 *                          to a person (person_id NOT NULL) and VERIFIED
 *                          (verification_state 'verified', verified_at set).
 *
 * ─── WHY ONLY A VERIFIED external_id CLAIM ────────────────────────────────
 * `identity_claims` is the repository's canonical external-identity store
 * (externalIdentityShadow.ts, recipientOwner.ts). Every writer that exists today
 * records `verification_state = 'unverified'` (canonicalisation.ts `toRow`,
 * socialContactResolution.ts via `persistClaims`): an ingested or resolver-made
 * attribution is an observation, not an assertion that a person owns an account.
 * Acting on a person's public account on that basis would be a guess, so an
 * attributed-but-unverified claim is refused (`identity_unverified`), distinctly
 * from no claim at all (`identity_unclaimed`). `external_profile` (profile URLs)
 * is deliberately not consulted: profile-URL identity is deferred per provider
 * (socialContactResolution.ts, LI-5C Q-3).
 *
 * ─── NEVER INFERRED ───────────────────────────────────────────────────────
 * No name, display name, username, company, email domain or phone is ever used
 * as an identity key. The only key is the provider-issued id the engine stored.
 *
 * ─── WHAT THE ACTION ADDRESSES MUST BE THAT ACCOUNT ───────────────────────
 *   reply / like / share  act on the account's content: the discovered user is
 *                         the account.
 *   follow                target_id IS an account: it must be the discovered
 *                         user's provider id (else `target_actor_mismatch`).
 *   dm                    the recipient must be that provider id. A DM addressed
 *                         to a thread (thread URL / id, `dm_thread_ready`
 *                         metadata), a handle or a profile URL cannot be tied to
 *                         the person — no person ↔ thread mapping exists — so it
 *                         is refused (`dm_recipient_unproven`).
 *
 * Every refusal has an explicit code. Read failures are `*_unreadable` and are
 * the only refusals a caller may retry.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { resolveSubjectPersonId } from '../leadOutreachExecution/personAnchor';
import { normalizeClaimValue } from '../prospectIdentity/normalization';
import type { SubjectRef } from '../executionSubject/subjectRef';

export const DISCOVERED_USERS_TABLE = 'community_ai_discovered_users';
export const IDENTITY_CLAIMS_TABLE = 'identity_claims';

/** The only claim type that proves a platform account. */
export const PROVING_CLAIM_TYPE = 'external_id' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDENTITY_REFUSAL_CODES = [
  'person_unreadable',          // the run's subject could not be read
  'person_unresolved',          // the run's subject has no canonical person
  'person_mismatch',            // a recorded/supplied person differs from the run's person
  'identity_cross_tenant',      // the action or its account is not this tenant's
  'identity_missing',           // the action names no platform account (or no provider id)
  'identity_unreadable',        // the account or the claims could not be read
  'identity_platform_mismatch', // the account is on another platform than the action
  'target_actor_mismatch',      // a follow addresses another account than the action's
  'dm_recipient_unproven',      // a DM is addressed to something not tied to the account
  'identity_unclaimed',         // no active claim attributes the account to any person
  'identity_ambiguous',         // more than one active claim / person for the account
  'identity_unverified',        // the account is attributed, but not verified
  'identity_mismatch',          // the verified owner of the account is another person
] as const;
export type IdentityRefusalCode = typeof IDENTITY_REFUSAL_CODES[number];

/** Refusals that are about a read, not about the facts. */
export const TRANSIENT_IDENTITY_CODES: ReadonlySet<IdentityRefusalCode> = new Set(['person_unreadable', 'identity_unreadable']);

export type PersonProof =
  | {
      ok: true;
      personId: string;
      claimId: string;
      discoveredUserId: string;
      platform: string;
      providerId: string;
    }
  | { ok: false; code: IdentityRefusalCode; reason: string };

/** The action fields the proof depends on. */
export interface ProofActionRow {
  id: string;
  tenant_id: string | null;
  organization_id: string | null;
  platform: string | null;
  action_type: string | null;
  target_id: string | null;
  discovered_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DiscoveredUserRow {
  id: string;
  tenant_id: string | null;
  organization_id: string | null;
  platform: string | null;
  external_user_id: string | null;
}

export interface IdentityClaimRow {
  id: string;
  organization_id: string | null;
  person_id: string | null;
  claim_type: string | null;
  platform: string | null;
  normalized_value: string | null;
  verification_state: string | null;
  verified_at: string | null;
  revoked_at: string | null;
}

/** Reads, every one tenant-filtered. `undefined` = unreadable; `null` = none in this tenant. */
export interface CommunityIdentityPort {
  resolveRunPerson(organizationId: string, subject: SubjectRef): Promise<{ ok: boolean; personId: string | null }>;
  readDiscoveredUser(organizationId: string, id: string): Promise<DiscoveredUserRow | null | undefined>;
  /** Active (non-revoked) `external_id` claims for one (platform, normalized value). */
  readActiveExternalIdClaims(organizationId: string, platform: string, normalizedValue: string): Promise<IdentityClaimRow[] | undefined>;
}

const CLAIM_COLUMNS = 'id, organization_id, person_id, claim_type, platform, normalized_value, verification_state, verified_at, revoked_at';

export const defaultCommunityIdentityPort: CommunityIdentityPort = {
  resolveRunPerson: (organizationId, subject) => resolveSubjectPersonId(organizationId, subject),

  async readDiscoveredUser(organizationId, id) {
    try {
      const res = await ownedDbTable(DISCOVERED_USERS_TABLE)
        .select('id, tenant_id, organization_id, platform, external_user_id')
        .eq('organization_id', organizationId)            // TENANT FIRST
        .eq('id', id)
        .maybeSingle();
      if (res.error) return undefined;
      return (res.data as DiscoveredUserRow | null) ?? null;
    } catch {
      return undefined;
    }
  },

  async readActiveExternalIdClaims(organizationId, platform, normalizedValue) {
    try {
      const res = await ownedDbTable(IDENTITY_CLAIMS_TABLE)
        .select(CLAIM_COLUMNS)
        .eq('organization_id', organizationId)            // TENANT FIRST
        .eq('claim_type', PROVING_CLAIM_TYPE)
        .eq('platform', platform)
        .eq('normalized_value', normalizedValue)
        .is('revoked_at', null)
        .limit(10);
      if (res.error) return undefined;
      return Array.isArray(res.data) ? (res.data as unknown as IdentityClaimRow[]) : [];
    } catch {
      return undefined;
    }
  },
};

const refuse = (code: IdentityRefusalCode, reason: string): PersonProof => ({ ok: false, code, reason });
const lowerTrim = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Prove that `action` concerns the person of the run whose subject is `subject`,
 * in `organizationId`. `expectedPersonIds` are persons the caller already holds
 * (the link's recorded person, the step context's person): each non-null one
 * must equal the run's person.
 */
export async function proveActionPerson(
  input: {
    organizationId: string;
    subject: SubjectRef;
    action: ProofActionRow;
    expectedPersonIds?: ReadonlyArray<string | null | undefined>;
  },
  port: CommunityIdentityPort = defaultCommunityIdentityPort,
): Promise<PersonProof> {
  const org = input.organizationId;
  const action = input.action;

  // ── the action and the run are one tenant's ──────────────────────────────
  if (action.organization_id !== org || action.tenant_id !== org) {
    return refuse('identity_cross_tenant', 'the community action is not this tenant\'s');
  }

  // ── the run's person ─────────────────────────────────────────────────────
  let run: { ok: boolean; personId: string | null };
  try {
    run = await port.resolveRunPerson(org, input.subject);
  } catch {
    return refuse('person_unreadable', 'the journey subject could not be read');
  }
  if (run.ok === false) return refuse('person_unreadable', 'the journey subject could not be read');
  const personId = run.personId;
  if (personId === null || !UUID.test(personId)) {
    return refuse('person_unresolved', 'the journey subject has no canonical person');
  }
  for (const expected of input.expectedPersonIds ?? []) {
    if (expected === undefined || expected === null) continue;
    if (expected !== personId) return refuse('person_mismatch', 'a recorded person differs from the journey run\'s person');
  }

  // ── the platform account the action engages ──────────────────────────────
  const discoveredUserId = typeof action.discovered_user_id === 'string' ? action.discovered_user_id : null;
  if (discoveredUserId === null || !UUID.test(discoveredUserId)) {
    return refuse('identity_missing', 'the community action names no platform account');
  }
  let du: DiscoveredUserRow | null | undefined;
  try {
    du = await port.readDiscoveredUser(org, discoveredUserId);
  } catch {
    du = undefined;
  }
  if (du === undefined) return refuse('identity_unreadable', 'the action\'s platform account could not be read');
  if (du === null) return refuse('identity_missing', 'the action\'s platform account does not exist in this tenant');
  if (du.organization_id !== org || du.tenant_id !== org) {
    return refuse('identity_cross_tenant', 'the action\'s platform account is not this tenant\'s');
  }
  const platform = lowerTrim(du.platform);
  if (!platform || platform !== lowerTrim(action.platform)) {
    return refuse('identity_platform_mismatch', 'the platform account is on a different platform than the action');
  }
  const providerId = normalizeClaimValue(PROVING_CLAIM_TYPE, du.external_user_id);
  if (!providerId) return refuse('identity_missing', 'the platform account carries no provider id');

  // ── what the action addresses must be that account ───────────────────────
  const type = lowerTrim(action.action_type);
  if (type === 'follow') {
    if (normalizeClaimValue(PROVING_CLAIM_TYPE, action.target_id) !== providerId) {
      return refuse('target_actor_mismatch', 'the follow addresses a different account than the action\'s platform account');
    }
  } else if (type === 'dm') {
    const meta = action.metadata ?? null;
    if (meta !== null && typeof meta === 'object' && (meta as Record<string, unknown>).dm_thread_ready === true) {
      return refuse('dm_recipient_unproven', 'the DM is addressed to a thread, and no person-to-thread mapping exists');
    }
    if (normalizeClaimValue(PROVING_CLAIM_TYPE, action.target_id) !== providerId) {
      return refuse('dm_recipient_unproven', 'the DM recipient is not the action\'s platform account provider id');
    }
  }

  // ── the authoritative mapping: account → person ──────────────────────────
  let claims: IdentityClaimRow[] | undefined;
  try {
    claims = await port.readActiveExternalIdClaims(org, platform, providerId);
  } catch {
    claims = undefined;
  }
  if (claims === undefined) return refuse('identity_unreadable', 'the identity claims could not be read');

  // Re-filter in memory: tenant, type, exact key, active. A row that slipped
  // through a filter is ignored, never trusted.
  const active = claims.filter((c) => c.organization_id === org
    && c.claim_type === PROVING_CLAIM_TYPE
    && c.platform === platform
    && c.normalized_value === providerId
    && (c.revoked_at === null || c.revoked_at === undefined));
  const attributed = active.filter((c) => typeof c.person_id === 'string' && c.person_id.length > 0);
  const persons = new Set(attributed.map((c) => c.person_id as string));

  if (active.length > 1 || persons.size > 1) {
    return refuse('identity_ambiguous', 'more than one active identity claim exists for the platform account');
  }
  if (attributed.length === 0) {
    return refuse('identity_unclaimed', 'no active identity claim attributes the platform account to a person');
  }
  const claim = attributed[0];
  if (claim.verification_state !== 'verified' || !claim.verified_at) {
    return refuse('identity_unverified', 'the platform account is attributed to a person but the claim is not verified');
  }
  if (claim.person_id !== personId) {
    return refuse('identity_mismatch', 'the platform account belongs to a different person than the journey run\'s');
  }

  return { ok: true, personId, claimId: claim.id, discoveredUserId, platform, providerId };
}
