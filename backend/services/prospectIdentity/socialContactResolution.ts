/**
 * B1 — social contact → canonical person, at ingestion time.
 *
 * `canonicalLeadSignalService` creates a `contacts` row for every social author
 * it sees, with six columns and no identity resolution at all. The column
 * `contacts.unified_person_id` and its tenant-safe composite FK have existed
 * since W5, and every production row still has it NULL: the identity edge is
 * severed at the point of creation, not later. This module closes it — FORWARD
 * ONLY, for contacts created from here on.
 *
 * ─── WHAT IT DOES ──────────────────────────────────────────────────────────
 * For one freshly-upserted social contact it:
 *   1. asks the W1 shadow resolver whether this tenant already knows a person
 *      by this platform identity,
 *   2. records exactly ONE `external_id` claim carrying the verdict,
 *   3. sets `contacts.unified_person_id` only on a single deterministic match,
 *   4. parks a duplicate candidate when the identity points at more than one
 *      person, and links nothing.
 *
 * ─── WHAT IT REFUSES TO DO ────────────────────────────────────────────────
 * It NEVER creates a `unified_persons` row. A social handle is a bare provider
 * identifier with no email, no phone and no verified name — `contacts` carries
 * none of those columns — so minting a person from one would fabricate a
 * canonical human out of an unverified string, and every later email or phone
 * arriving for that same human would then collide with a ghost. Whether an
 * un-contactable handle deserves a person is a product decision that has not
 * been made; until it is, the honest record is a claim with `person_id = NULL`.
 *
 * It also never resolves on a profile URL (`external_profile` is deferred per
 * provider, LI-5C Q-3), never reads or writes `external_keys`, and never uses
 * a name, display name, company or title as an identity key. Names are not
 * identifiers; two humans share one constantly.
 *
 * ─── AGAINST TODAY'S DATA THIS LINKS NOTHING, BY DESIGN ───────────────────
 * The only external_id claims that exist are 10 W3 backfill rows with
 * `person_id IS NULL`, and the shadow resolver deliberately ignores unlinked
 * claims — resolving on an observation nobody attributed would invent the
 * attribution. So every social contact resolves `unresolved` until a linked
 * claim exists. That is the correct outcome, and the claim written here is what
 * eventually makes a link possible.
 *
 * ─── FAILURE POSTURE: FAIL-OPEN, CLASSIFIED ───────────────────────────────
 * `canonicalLeadSignalService` is a live ingestion path. This is an ADDITIVE
 * identity write on top of a contact that is already durable, so a defect here
 * must never drop a social signal. Nothing in this module throws: failures are
 * classified into a closed vocabulary and returned for the caller to log —
 * following the LI-5D precedent. A `23503` is a tenant-FK violation and is
 * reported as `tenant_fk_failure`, never as a transient database problem.
 *
 * ─── TENANT ────────────────────────────────────────────────────────────────
 * Every read and every write is filtered by `organization_id`. The backend uses
 * a service-role client that bypasses RLS, so that filter IS the tenant
 * boundary. The contact update carries it in addition to the primary key.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { persistClaims, type DerivedClaim } from './canonicalisation';
import { normalizeClaimValue, normalizePlatform, type ClaimType } from './normalization';
import { resolveIdentityShadow, type ShadowResolution } from './shadowResolver';
import { parkDuplicateCandidate } from './personDuplicates';

/** Bumped when the resolution rules change, so a claim traces to the logic that made it. */
export const SOCIAL_CONTACT_RESOLUTION_VERSION = 'b1.1';

/**
 * Provenance. Live ingestion, NOT `w3_backfill` — a claim created by today's
 * traffic must not describe itself as a historical backfill, and the 10 rows
 * W3 already wrote must stay separable from these.
 */
export const SOCIAL_CONTACT_SOURCE = 'social_contact_ingestion';

/**
 * The only claim type this module emits. An opaque provider-issued identifier,
 * matching the shape of the existing LinkedIn claims. `external_profile` is
 * deliberately never written here.
 */
export const SOCIAL_CONTACT_CLAIM_TYPE: ClaimType = 'external_id';

/** What happened to the identity edge for one contact. */
export type SocialContactOutcome =
  | 'linked'          // exactly one person matched; contacts.unified_person_id set
  | 'already_linked'  // the contact already carried a link; left untouched
  | 'ambiguous'       // >1 person matched; nothing linked, candidates parked
  | 'unresolved'      // nobody in this tenant holds this identity
  | 'unusable'        // platform / identifier did not normalize
  | 'skipped'         // required inputs absent
  | 'failed';         // classified failure; ingestion is unaffected

/** Per-claim outcome. Only `already_exists` is a benign duplicate. */
export type SocialClaimOutcome =
  | 'not_attempted'
  | 'created'
  | 'already_exists'
  | 'invalid_claim'
  | 'tenant_fk_failure'
  | 'database_failure';

export interface SocialContactResolutionResult {
  outcome: SocialContactOutcome;
  /** The person linked, or null. Null for every outcome except `linked`/`already_linked`. */
  personId: string | null;
  claim: SocialClaimOutcome;
  /** Distinct persons the identity pointed at. Length > 1 means ambiguous. */
  candidatePersonIds: string[];
  /** Duplicate candidates newly parked (ambiguous only). */
  duplicatesParked: number;
  /** SQLSTATEs observed — codes only, never values. */
  failureCodes: string[];
  reason: string;
}

export interface SocialContactIdentityInput {
  organizationId: string;
  contactId: string;
  platform: string | null | undefined;
  platformUserId: string | null | undefined;
  /** Whatever the contact already carried. A pre-existing link is never rewritten. */
  existingPersonId?: string | null;
  now?: string;
}

const result = (
  outcome: SocialContactOutcome,
  reason: string,
  over: Partial<SocialContactResolutionResult> = {},
): SocialContactResolutionResult => ({
  outcome,
  personId: null,
  claim: 'not_attempted',
  candidatePersonIds: [],
  duplicatesParked: 0,
  failureCodes: [],
  reason,
  ...over,
});

const errCode = (e: unknown): string | null => (e as { code?: string } | null)?.code ?? null;

/**
 * Map a SQLSTATE to the outcome vocabulary.
 *
 * `23505` never reaches here — `persistClaims` absorbs it as already-present,
 * the one benign duplicate. Everything else is a genuine failure and is
 * classified rather than flattened, so a tenant-FK violation can never be
 * mistaken for a transient database problem.
 */
export function classifySocialClaimFailure(code: string | null | undefined): SocialClaimOutcome {
  switch (code) {
    case '23503': return 'tenant_fk_failure';   // composite FK: person is not in this tenant
    case '23514': return 'invalid_claim';       // CHECK: platform rule, normalisation, vocabulary
    case '23502': return 'invalid_claim';       // NOT NULL
    default: return 'database_failure';
  }
}

/**
 * Build the single claim this contact implies. Pure.
 *
 * Exactly one claim, always: `external_id` on the normalized platform, valued
 * by the normalized `platform_user_id`. `personId` is the resolver's verdict —
 * null whenever the identity is unresolved or ambiguous, because a claim that
 * names a person it is not sure about is worse than one that names nobody.
 */
export function buildSocialContactClaim(input: {
  organizationId: string;
  contactId: string;
  platform: string;
  normalizedValue: string;
  rawValue: string;
  personId: string | null;
  resolution: Pick<ShadowResolution, 'outcome' | 'reason' | 'candidatePersonIds'>;
}): DerivedClaim {
  return {
    organizationId: input.organizationId,
    personId: input.personId,
    claimType: SOCIAL_CONTACT_CLAIM_TYPE,
    platform: input.platform,
    normalizedValue: input.normalizedValue,
    rawValue: input.rawValue,
    sourceTable: 'contacts',
    sourceId: input.contactId,
    sourceColumn: 'platform_user_id',
    source: SOCIAL_CONTACT_SOURCE,
    // The durable verdict. Summary only — counts and outcomes, never the
    // provider payload, which belongs to LI-2 `source_records`.
    evidence: {
      resolutionVersion: SOCIAL_CONTACT_RESOLUTION_VERSION,
      platform: input.platform,
      derivation: 'social_contact_platform_identity',
      resolutionOutcome: input.resolution.outcome,
      resolutionReason: input.resolution.reason,
      candidatePersonCount: input.resolution.candidatePersonIds.length,
      linked: input.personId !== null,
    },
  };
}

/**
 * Set `contacts.unified_person_id`, tenant-scoped, once.
 *
 * `.is('unified_person_id', null)` makes a concurrent linker win harmlessly
 * rather than being overwritten, and the `organization_id` filter is the tenant
 * boundary even though `id` is the primary key — a service-role client has no
 * other one. The composite FK refuses a cross-tenant person with `23503`; we
 * classify that rather than reporting it as a generic write failure.
 */
async function linkContact(
  organizationId: string,
  contactId: string,
  personId: string,
): Promise<{ linked: boolean; code: string | null }> {
  const res = await ownedDbTable('contacts')
    .update({ unified_person_id: personId })
    .eq('organization_id', organizationId)   // tenant boundary — never optional
    .eq('id', contactId)
    .is('unified_person_id', null)
    .select('id');

  if (res.error) return { linked: false, code: errCode(res.error) ?? 'unknown' };
  return { linked: ((res.data ?? []) as unknown[]).length > 0, code: null };
}

/**
 * Park the ambiguity for tenant review.
 *
 * When one platform identity names several people, those people are candidate
 * duplicates OF EACH OTHER — that is the reviewable fact, and `external_key` is
 * exactly the deterministic signal LI-4C defines for it. Pairs are taken from a
 * stable ordering so a re-run parks the same pairs and the partial open-pair
 * index absorbs the repeat as `23505`.
 *
 * Never throws: a duplicate we failed to park must not cost the tenant a signal.
 */
async function parkAmbiguity(
  organizationId: string,
  personIds: string[],
): Promise<{ parked: number; codes: string[] }> {
  const ordered = [...personIds].sort();
  const anchor = ordered[0];
  let parked = 0;
  const codes: string[] = [];

  for (const other of ordered.slice(1)) {
    try {
      const res = await parkDuplicateCandidate({
        organizationId,
        personId: anchor,
        candidatePersonId: other,
        classification: 'probable',   // a provider id is an assertion, not a contact fact
        matchedOn: 'external_key',
      });
      if (res.parked) parked += 1;
    } catch (e) {
      codes.push(errCode(e) ?? 'park_failed');
    }
  }

  return { parked, codes };
}

/**
 * Resolve and record the identity of one freshly-created social contact.
 *
 * NEVER THROWS. The contact and the signal it belongs to are already durable by
 * the time this runs; failing ingestion because a secondary identity write was
 * rejected would turn an additive edge into an outage.
 */
export async function resolveSocialContactIdentity(
  input: SocialContactIdentityInput,
): Promise<SocialContactResolutionResult> {
  try {
    const organizationId = String(input.organizationId ?? '').trim();
    const contactId = String(input.contactId ?? '').trim();
    if (!organizationId || !contactId) {
      return result('skipped', 'organizationId and contactId are both required');
    }

    // A link established earlier is evidence somebody already decided. Re-deciding
    // it here would let ingestion silently move a person, so it is left alone.
    if (input.existingPersonId) {
      return result('already_linked', 'contact already carries a canonical person', {
        personId: input.existingPersonId,
      });
    }

    const platform = normalizePlatform(SOCIAL_CONTACT_CLAIM_TYPE, input.platform);
    const rawValue = String(input.platformUserId ?? '').trim();
    const normalizedValue = normalizeClaimValue(SOCIAL_CONTACT_CLAIM_TYPE, rawValue);
    if (!platform || !normalizedValue) {
      return result('unusable', 'platform or platform identifier did not normalize to an identity');
    }

    // The ONLY identity key. Never a name, display name, company or title.
    const resolution = await resolveIdentityShadow(
      organizationId,
      [{ claimType: SOCIAL_CONTACT_CLAIM_TYPE, value: rawValue, platform }],
      input.now,
    );

    const ambiguous = resolution.outcome === 'ambiguous' || resolution.candidatePersonIds.length > 1;
    const matched = !ambiguous && resolution.personId ? resolution.personId : null;

    // The claim is written in EVERY case, carrying the verdict — including
    // `unresolved`, which is the outcome today's data produces for all of them.
    // person_id is null unless exactly one person matched.
    const claim = buildSocialContactClaim({
      organizationId,
      contactId,
      platform,
      normalizedValue,
      rawValue,
      personId: matched,
      resolution,
    });

    // On the `matched_claim` path this is ALWAYS a benign `23505`: an active
    // claim for this identity is exactly how the person was found. The claim is
    // still attempted rather than skipped, because the resolution may have come
    // from the spine, and a prior SELECT would be a race rather than a check.
    // `persistClaims` inserts and catches — it never updates, so the claim that
    // produced the match is not rewritten.
    const persisted = await persistClaims([claim], input.now);
    const claimError = persisted.errors[0];
    const claimOutcome: SocialClaimOutcome = persisted.inserted
      ? 'created'
      : persisted.alreadyPresent
        ? 'already_exists'
        : classifySocialClaimFailure(claimError?.code);
    const failureCodes = persisted.errors.map((e) => e.code ?? 'unknown');

    if (ambiguous) {
      const park = await parkAmbiguity(organizationId, resolution.candidatePersonIds);
      return result('ambiguous', resolution.reason, {
        claim: claimOutcome,
        candidatePersonIds: resolution.candidatePersonIds,
        duplicatesParked: park.parked,
        failureCodes: [...failureCodes, ...park.codes],
      });
    }

    if (!matched) {
      // No person. NO `unified_persons` row is created — see the header.
      return result('unresolved', resolution.reason, {
        claim: claimOutcome,
        failureCodes,
      });
    }

    // A tenant-FK rejection on the claim means the person is not in this tenant,
    // so linking the contact to it would be the same violation. Refuse the link.
    if (claimOutcome === 'tenant_fk_failure') {
      return result('failed', 'resolved person is not in this tenant', {
        candidatePersonIds: resolution.candidatePersonIds,
        claim: claimOutcome,
        failureCodes,
      });
    }

    const link = await linkContact(organizationId, contactId, matched);
    if (link.code) {
      return result('failed', 'contact identity link was rejected', {
        candidatePersonIds: resolution.candidatePersonIds,
        claim: claimOutcome,
        failureCodes: [...failureCodes, link.code],
      });
    }

    return result(link.linked ? 'linked' : 'already_linked', resolution.reason, {
      personId: matched,
      candidatePersonIds: resolution.candidatePersonIds,
      claim: claimOutcome,
      failureCodes,
    });
  } catch (e) {
    // The sub-writers absorb their own row errors, so reaching here means the
    // driver or the connection failed. Still never fatal to ingestion.
    return result('failed', 'social contact identity resolution failed', {
      failureCodes: [errCode(e) ?? 'unknown'],
    });
  }
}
