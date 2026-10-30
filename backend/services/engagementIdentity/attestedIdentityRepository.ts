/**
 * Attested engagement identities — the SOLE writer and reader of the registry.
 *
 * Storage, and nothing else. What an attestation MEANS lives in
 * `attestedIdentityContract.ts`; who is allowed to make one lives in the route
 * that authorizes an administrator; neither is restated here. What this module
 * owns is the narrow question "is this identity registered, already registered,
 * or not registrable", and it answers it against the database constraints of
 * `20270106000000_pi_attested_engagement_identities.sql` rather than against a
 * second copy of the policy.
 *
 * ─── UNREADABLE IS NOT EMPTY. THIS IS THE WHOLE POINT ─────────────────────
 * The registry carries NEGATIVE evidence: an active row means "never admit this
 * identity's words as a prospect's own statement". So a failed read must never
 * be rendered as "this tenant owns nobody" — that answer re-admits a tenant's
 * own marketing copy as a prospect's statement, which is exactly how
 * `engagementThreadService.getOrgAuthorIds` fails today (it discards the
 * `error` on all three of its reads). Every read here therefore returns a
 * `legible` flag ALONGSIDE the result, and `findOwnedIdentities` returns
 * `legible: false` with an empty set rather than a legible empty set. Those two
 * are different answers and the type refuses to let them share a value.
 *
 * ─── NO SECOND NORMALISER ─────────────────────────────────────────────────
 * `normalizeEngagementPlatform`, `normalizeEngagementIdentity` and
 * `engagementIdentityKey` are imported from the contract and are the only
 * normalisation performed anywhere in this file. In particular
 * `platform_user_id` is TRIMMED AND NOT CASE-FOLDED, on the way in and on the
 * way out: folding would produce a string that is not the identity received and
 * would stop the row matching the `engagement_authors` row it is about. The
 * platform is lower-cased and NEVER aliased, because an author row may
 * legitimately hold 'x' or 'li'.
 *
 * ─── TENANT IS A PREDICATE, AND THEN RE-ASSERTED ──────────────────────────
 * `organizationId` is a required argument on every entry point, is the FIRST
 * predicate of every query, and is RE-ASSERTED ON THE RETURNED ROWS. There is
 * no all-tenants form. The re-assertion follows the convention stated at
 * `prospectIdentity/relationshipRepository.ts:324-329`: one tenant's
 * attestation silencing another tenant's prospect would be invisible, so a
 * foreign row must be incapable of reaching a caller even if a query above were
 * later edited wrongly.
 *
 * ─── NO OAUTH PATH ────────────────────────────────────────────────────────
 * This module reads and writes ONE relation. It never opens `social_accounts`,
 * never compares an engagement identity with an OAuth provider id, and performs
 * no backfill. The relation has no column reachable from one, and the
 * migration's postconditions prove it.
 *
 * ─── IDEMPOTENCY IS A CONSTRAINT, NOT A LOOKUP ────────────────────────────
 * The insert is attempted and a 23505 is a SUCCESS carrying
 * `alreadyActive: true` — the pattern at
 * `prospectIdentity/ingestionBoundary.ts:377-418`. There is no
 * SELECT-then-INSERT: that is a race dressed as a guarantee. The only read on
 * the conflict path happens AFTER the database has already decided, purely to
 * recover the identifier of the row that won.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { isRelationIllegible } from '../prospectIdentity/relationshipRepository';
import {
  ATTESTED_AS_TENANT_OWN,
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
  normalizeEngagementIdentity,
  normalizeEngagementPlatform,
  type AttestIdentityInput,
  type AttestIdentityResult,
  type AttestedEngagementIdentity,
  type AttestationFailure,
  type OwnedIdentityLookup,
  type RevokeIdentityResult,
} from './attestedIdentityContract';

/** Columns a read returns. Narrow and explicit: nothing selects `*`. */
const SELECT_COLS = [
  'id',
  'organization_id',
  'platform',
  'platform_user_id',
  'attested_as',
  'statement',
  'attested_by_user_id',
  'attested_at',
  'revoked_at',
  'revoked_by_user_id',
  'revoked_reason',
].join(', ');

/** Reads are bounded. A caller may ask for fewer, never for more. */
export const ATTESTED_IDENTITY_READ_LIMIT_DEFAULT = 100;
export const ATTESTED_IDENTITY_READ_LIMIT_MAX = 500;

/**
 * The most identities one `findOwnedIdentities` call may ask about.
 *
 * Over the cap the call FAILS CLOSED rather than reading the first 500 and
 * answering about those. A silent truncation would report an identity the
 * tenant HAS attested as unattested, which is the one direction of error this
 * registry exists to prevent.
 */
export const ATTESTED_IDENTITY_LOOKUP_MAX = 500;

/** One identity to ask about: the pair, exactly as `engagement_authors` holds it. */
export interface EngagementIdentityRef {
  readonly platform: string;
  readonly platformUserId: string;
}

export interface RevokeIdentityInput {
  readonly organizationId: string;
  readonly id: string;
  readonly revokedByUserId: string;
  readonly reason: string;
}

export interface ActiveAttestedIdentityQuery {
  readonly organizationId: string;
  /** Lower-cased and trimmed by the shared normaliser. Omit for every platform. */
  readonly platform?: string;
  /** Clamped to ATTESTED_IDENTITY_READ_LIMIT_MAX. */
  readonly limit?: number;
}

/**
 * The active registry for one tenant, or the reason it could not be read.
 *
 * `legible: false` is NOT an empty registry, and the union is what stops a
 * caller spelling the two the same way. See the file header.
 */
export type ActiveAttestedIdentityRead =
  | {
    readonly legible: true;
    readonly detail: null;
    readonly identities: readonly AttestedEngagementIdentity[];
  }
  | {
    readonly legible: false;
    readonly detail: string;
    readonly identities: readonly AttestedEngagementIdentity[];
  };

export interface OwnedIdentityQuery {
  readonly organizationId: string;
  /** BOUNDED. At most ATTESTED_IDENTITY_LOOKUP_MAX identities per call. */
  readonly keys: readonly EngagementIdentityRef[];
}

type DbError = { code?: string; message?: string; details?: string } | null;

/** The raw row shape, before it is mapped onto the published contract. */
interface IdentityRow {
  id?: string;
  organization_id?: string;
  platform?: string;
  platform_user_id?: string;
  attested_as?: string;
  statement?: string;
  attested_by_user_id?: string;
  attested_at?: string;
  revoked_at?: string | null;
  revoked_by_user_id?: string | null;
  revoked_reason?: string | null;
}

const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

function requireTenant(organizationId: string, fn: string): void {
  if (blank(organizationId)) {
    throw new Error(`${fn}: organizationId is required — an attestation without a tenant is never valid`);
  }
}

// "The relation could not be read or written AS A RELATION" — absent, a column
// absent, or a PostgREST schema cache that does not know it yet (42P01 / 42703 /
// PGRST205). `isRelationIllegible` is REUSED from the existing repository rather
// than restated: a second spelling of "this table is not there" would drift from
// the first, and the entire distinction depends on every reader answering
// "unreadable" and "empty" the same way.

/** One refusal, in the closed vocabulary the contract publishes. */
const refusal = (
  reason: AttestationFailure,
  detail: string,
): { ok: false; reason: AttestationFailure; detail: string } => ({ ok: false, reason, detail });

/** The published row shape, or null when a row fails its own invariants. */
function toAttested(row: IdentityRow, organizationId: string): AttestedEngagementIdentity | null {
  if (!row || blank(row.id)) return null;
  // TENANT RE-ASSERTED ON THE ROW, not only in the query. See the file header.
  if (row.organization_id !== organizationId) return null;
  if (blank(row.platform) || blank(row.platform_user_id) || blank(row.statement)) return null;
  if (blank(row.attested_by_user_id) || blank(row.attested_at)) return null;

  return {
    id: row.id as string,
    organizationId,
    // Returned exactly as stored. No folding on the way out either: a caller
    // comparing this with an `engagement_authors` row must get the same string
    // the author row holds.
    platform: row.platform as string,
    platformUserId: row.platform_user_id as string,
    attestedAs: typeof row.attested_as === 'string' ? row.attested_as : ATTESTED_AS_TENANT_OWN,
    statement: row.statement as string,
    attestedByUserId: row.attested_by_user_id as string,
    attestedAt: row.attested_at as string,
    revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    revokedByUserId: typeof row.revoked_by_user_id === 'string' ? row.revoked_by_user_id : null,
    revokedReason: typeof row.revoked_reason === 'string' ? row.revoked_reason : null,
  };
}

/**
 * Record one attestation.
 *
 * Never throws for a database condition; a thrown error means a caller passed
 * something that cannot be a request at all (no tenant).
 *
 * THE ONLY WRITE PATH FOR THIS RELATION. A second writer would be a second
 * answer to "is a replay already active", and the active key only holds because
 * every insert normalises the identity the same way.
 *
 * `evidence` is deliberately NOT a parameter. The column exists with a `{}`
 * default so a later gate can record the basis an administrator gave, and the
 * published `AttestIdentityInput` does not carry one — accepting a free-form
 * object through an input shape that does not declare it would let a caller
 * write an unreviewed payload into the registry.
 */
export async function attestIdentity(input: AttestIdentityInput): Promise<AttestIdentityResult> {
  requireTenant(input?.organizationId, 'attestIdentity');

  // ── Shape refusals the storage CHECKs would make anyway ─────────────────
  // Restated here only so the caller gets a named refusal instead of a 23514
  // it has to decode. The CHECKs remain the guarantee.
  const platform = normalizeEngagementPlatform(input.platform);
  const platformUserId = normalizeEngagementIdentity(input.platformUserId);
  const statement = typeof input.statement === 'string' ? input.statement.trim() : '';
  const attestedByUserId = typeof input.attestedByUserId === 'string'
    ? input.attestedByUserId.trim()
    : '';

  if (platform === null) {
    return refusal('invalid_input', 'platform is required and may not be blank');
  }
  if (platformUserId === null) {
    return refusal('invalid_input', 'platformUserId is required and may not be blank');
  }
  if (statement === '') {
    return refusal('invalid_input', 'an attestation must state something — a blank statement is not a record');
  }
  // The actor is MANDATORY and is checked here because the relation carries no
  // CHECK on it: pairing the actor column's nullity with a CHECK would re-arm
  // DEFECT-008 the moment anyone added the obvious `users` foreign key. The
  // column's NOT NULL is the storage guarantee; this is the legible refusal.
  if (attestedByUserId === '') {
    return refusal('invalid_input', 'attestedByUserId is required — an anonymous attestation is not a record');
  }

  const row = {
    organization_id: input.organizationId,
    platform,
    platform_user_id: platformUserId,
    attested_as: ATTESTED_AS_TENANT_OWN,
    statement,
    attested_by_user_id: attestedByUserId,
  };

  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .insert(row)
      .select('id, organization_id')
      .single();
  } catch (e) {
    return refusal('store_unavailable', `write threw: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error === null) {
    const written = (res.data as IdentityRow | null) ?? null;
    if (written === null || blank(written.id)) {
      return refusal('store_unavailable', 'the write returned no row identity');
    }
    // Re-asserted on the DATA, not only in the query.
    if (written.organization_id !== input.organizationId) {
      return refusal('store_unavailable', 'the written row reported another tenant');
    }
    return { ok: true, id: written.id as string, alreadyActive: false };
  }

  if (isRelationIllegible(error)) {
    return refusal('store_unavailable', `the relation could not be written: ${error.message ?? error.code}`);
  }

  // A REPLAY IS A SUCCESS. `uq_aei_active_identity` has already decided; the
  // read below only recovers the identifier of the row that won, and is
  // therefore not the SELECT-then-INSERT race the constraint exists to avoid.
  //
  // The conflicting constraint is identified by RECOVERING THE ROW rather than
  // by matching a constraint name in the error text: if an active row exists on
  // this exact key then the active key is what conflicted, and if none does then
  // whatever conflicted is not something this module can report as a replay.
  if (error.code === '23505') {
    const existing = await readActiveIdByKey(input.organizationId, platform, platformUserId);
    if (existing.ok === false) {
      return refusal('store_unavailable',
        `the identity is already attested but its record could not be read: ${existing.detail}`);
    }
    return { ok: true, id: existing.id, alreadyActive: true };
  }

  // A CHECK refused the row. Named so a caller fixes one record rather than
  // guessing which rule it broke.
  if (error.code === '23514') {
    return refusal('invalid_input',
      `the storage layer refused the row: ${error.details ?? error.message ?? '23514'}`);
  }

  // Anything else — including 23503 on the tenant key, and any code this module
  // has never seen — is fail-closed. It is NEVER "nothing is attested".
  return refusal('store_unavailable', `write failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`);
}

/**
 * The identifier of the ACTIVE row holding this identity, under its tenant.
 *
 * Keyed exactly on `uq_aei_active_identity` — tenant, platform, identity, and
 * `revoked_at IS NULL` — so it can match at most one row by construction. A
 * read keyed any more loosely would answer a different question: without the
 * revocation predicate it could recover a REVOKED sibling's identifier and
 * report a withdrawn attestation as the active one.
 */
async function readActiveIdByKey(
  organizationId: string,
  platform: string,
  platformUserId: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .select('id, organization_id')
      .eq('organization_id', organizationId)       // tenant boundary — never optional
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId)
      .is('revoked_at', null)
      .maybeSingle();
  } catch (e) {
    return { ok: false, detail: `read threw: ${(e as Error)?.message ?? 'unknown'}` };
  }
  if (res && res.error) {
    return { ok: false, detail: res.error.message ?? String(res.error.code ?? 'unknown') };
  }
  const found = (res.data as IdentityRow | null) ?? null;
  if (found === null || blank(found.id)) {
    return { ok: false, detail: 'the conflicting row could not be located' };
  }
  // Re-asserted on the DATA.
  if (found.organization_id !== organizationId) {
    return { ok: false, detail: 'the conflicting row reported another tenant' };
  }
  return { ok: true, id: found.id as string };
}

/**
 * Withdraw one attestation. The row is KEPT.
 *
 * ─── HISTORY IS NEVER REWRITTEN ───────────────────────────────────────────
 * The update sets `revoked_at`, `revoked_by_user_id` and `revoked_reason` and
 * NOTHING ELSE — no `statement`, no `attested_*`, no `attested_as`. It is
 * filtered on the tenant FIRST, then on the identifier, and then on
 * `revoked_at IS NULL`, so a row that is already revoked matches nothing and
 * its original revoker, reason and instant survive untouched. A second
 * revocation is therefore not an overwrite; it is `already_revoked`.
 *
 * ─── WHY THE OUTCOME NEEDS A SECOND READ ──────────────────────────────────
 * "No row matched" has two causes which the caller must be able to tell apart:
 * the attestation does not exist in this tenant (`not_found`) or it exists and
 * was already withdrawn (`already_revoked`). PostgREST reports an empty update
 * result for both, so the distinction is made by ONE tenant-scoped read of that
 * identifier, performed only on the empty path. If that read itself cannot be
 * made the answer is `store_unavailable` — never a guess between the two.
 */
export async function revokeIdentity(input: RevokeIdentityInput): Promise<RevokeIdentityResult> {
  requireTenant(input?.organizationId, 'revokeIdentity');

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id === '') {
    return refusal('invalid_input', 'id is required — there is nothing to withdraw');
  }
  const revokedByUserId = typeof input.revokedByUserId === 'string'
    ? input.revokedByUserId.trim()
    : '';
  if (revokedByUserId === '') {
    return refusal('invalid_input', 'revokedByUserId is required — an anonymous withdrawal is not a record');
  }
  // A BLANK REASON IS A REFUSAL, not a stored empty string. `aei_revocation_coherent`
  // would refuse it too; this is the legible form of the same rule.
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '') {
    return refusal('invalid_input', 'a withdrawal must state a reason');
  }

  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .update({
        // `revoked_at` is the application clock, because PostgREST has no way to
        // send `now()` as an expression. `aei_revocation_not_before_attestation`
        // allows equality, so only a clock running BEHIND the database's would
        // be refused — reported below as `invalid_input` carrying the constraint
        // name, rather than silently "corrected" by shifting the instant.
        revoked_at: new Date().toISOString(),
        revoked_by_user_id: revokedByUserId,
        revoked_reason: reason,
      })
      .eq('organization_id', input.organizationId)   // tenant boundary — always FIRST
      .eq('id', id)
      .is('revoked_at', null)                        // an already-revoked row is untouched
      .select('id, organization_id, revoked_at');
  } catch (e) {
    return refusal('store_unavailable', `write threw: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error !== null) {
    if (isRelationIllegible(error)) {
      return refusal('store_unavailable', `the relation could not be written: ${error.message ?? error.code}`);
    }
    if (error.code === '23514') {
      return refusal('invalid_input',
        `the storage layer refused the withdrawal: ${error.details ?? error.message ?? '23514'}`);
    }
    return refusal('store_unavailable', `write failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`);
  }

  const rows = Array.isArray(res.data) ? (res.data as IdentityRow[]) : [];
  // Tenant RE-ASSERTED ON THE ROW: an update that reported another tenant's row
  // is not a successful withdrawal, it is a reason to stop.
  const mine = rows.filter((r) => r && r.organization_id === input.organizationId && !blank(r.id));
  if (mine.length !== rows.length) {
    return refusal('store_unavailable', 'the updated row reported another tenant');
  }
  if (mine.length > 0) {
    return { ok: true, revoked: true };
  }

  return classifyMissedRevocation(input.organizationId, id);
}

/**
 * Why `revokeIdentity` matched no active row: already withdrawn, or absent.
 *
 * Reads only the two columns needed to tell those apart, and only after the
 * update has already decided that nothing matched.
 */
async function classifyMissedRevocation(
  organizationId: string,
  id: string,
): Promise<RevokeIdentityResult> {
  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .select('id, organization_id, revoked_at')
      .eq('organization_id', organizationId)       // tenant boundary — never optional
      .eq('id', id)
      .maybeSingle();
  } catch (e) {
    return refusal('store_unavailable',
      `the withdrawal matched nothing and the reason could not be read: read threw: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error !== null) {
    return refusal('store_unavailable',
      `the withdrawal matched nothing and the reason could not be read: ${error.message ?? error.code ?? 'unknown'}`);
  }

  const found = (res.data as IdentityRow | null) ?? null;
  if (found === null || blank(found.id)) {
    return refusal('not_found', 'no such attestation in this tenant');
  }
  // Re-asserted on the DATA. A row from another tenant is not an answer.
  if (found.organization_id !== organizationId) {
    return refusal('store_unavailable', 'the located row reported another tenant');
  }
  if (typeof found.revoked_at === 'string' && found.revoked_at.trim() !== '') {
    return refusal('already_revoked', 'this attestation was already withdrawn — its original record stands');
  }
  // The row exists, is active, and the update still matched nothing: the two
  // statements disagree, so neither answer is reportable.
  return refusal('store_unavailable',
    'the attestation is active but the withdrawal matched no row');
}

/**
 * Every ACTIVE attestation for one tenant, newest first.
 *
 * Bounded, active-only, and `legible: false` when the question could not be
 * asked. A caller that renders that as "this tenant has attested nothing" is
 * stating something the data never said — which is why the flag is in the
 * return type rather than expressed as an empty array.
 */
export async function listActiveAttestedIdentities(
  query: ActiveAttestedIdentityQuery,
): Promise<ActiveAttestedIdentityRead> {
  requireTenant(query?.organizationId, 'listActiveAttestedIdentities');

  // A platform that was SUPPLIED but normalises to nothing is a caller error,
  // not an empty result: silently dropping the filter would widen the read to
  // every platform, and silently returning nothing would hide the mistake.
  let platform: string | null = null;
  if (query.platform !== undefined && query.platform !== null) {
    platform = normalizeEngagementPlatform(query.platform);
    if (platform === null) {
      throw new Error('listActiveAttestedIdentities: a supplied platform may not be blank');
    }
  }

  const requested = typeof query.limit === 'number' && query.limit > 0
    ? Math.floor(query.limit)
    : ATTESTED_IDENTITY_READ_LIMIT_DEFAULT;
  const limit = Math.min(requested, ATTESTED_IDENTITY_READ_LIMIT_MAX);

  let res: { data?: unknown; error?: DbError };
  try {
    let q = ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .select(SELECT_COLS)
      .eq('organization_id', query.organizationId)   // tenant boundary — always FIRST
      .is('revoked_at', null);                       // ACTIVE only
    if (platform !== null) q = q.eq('platform', platform);
    res = await q
      .order('attested_at', { ascending: false })
      .limit(limit);
  } catch (e) {
    return {
      legible: false,
      detail: `read threw: ${(e as Error)?.message ?? 'unknown'}`,
      identities: [],
    };
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error !== null) {
    const detail = isRelationIllegible(error)
      ? `the relation could not be read: ${error.message ?? error.code}`
      : `read failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`;
    return { legible: false, detail, identities: [] };
  }

  const rows = Array.isArray(res.data) ? (res.data as IdentityRow[]) : [];
  const identities: AttestedEngagementIdentity[] = [];
  for (const raw of rows) {
    const mapped = toAttested(raw, query.organizationId);
    if (mapped === null) continue;
    // ACTIVE re-asserted on the row, not only in the query. A revoked row
    // reaching a caller here would be read as a live claim.
    if (mapped.revokedAt !== null) continue;
    if (platform !== null && mapped.platform !== platform) continue;
    identities.push(mapped);
  }

  return { legible: true, detail: null, identities };
}

/**
 * "Which of THESE identities does this tenant actively claim?"
 *
 * ─── ONE READ, BOUNDED TO WHAT WAS ASKED ──────────────────────────────────
 * The query carries the tenant, `revoked_at IS NULL`, and an `.in` on each half
 * of the identity. It never reads the tenant's whole registry to filter in
 * memory, and it never reads one row per supplied identity.
 *
 * ─── WHY THE PAIRS ARE RE-MATCHED IN MEMORY ───────────────────────────────
 * `.in('platform', ...)` AND `.in('platform_user_id', ...)` is a CROSS PRODUCT,
 * not a list of pairs. Asked about `linkedin:A` and `twitter:B`, it also matches
 * a stored `linkedin:B` — so a tenant that attested its LinkedIn profile would
 * appear to own a Twitter id it never claimed, and that identity's statements
 * would be permanently inadmissible as prospect evidence. The `.in` pair is
 * therefore a PREFILTER only; membership is decided by re-matching each returned
 * row's own `engagementIdentityKey` against the requested set.
 *
 * ─── AND WHY FAILURE IS NOT AN EMPTY SET ──────────────────────────────────
 * Any error returns `legible: false` with an empty `ownedKeys`. The flag is the
 * answer; the empty set is only what accompanies it. A caller must read the
 * flag, because "we could not ask" and "nothing is owned" lead to opposite
 * admissions.
 */
export async function findOwnedIdentities(
  query: OwnedIdentityQuery,
): Promise<OwnedIdentityLookup> {
  requireTenant(query?.organizationId, 'findOwnedIdentities');

  const unreadable = (detail: string): OwnedIdentityLookup => ({
    legible: false,
    detail,
    ownedKeys: new Set<string>(),
  });

  const asked = Array.isArray(query.keys) ? query.keys : [];
  if (asked.length > ATTESTED_IDENTITY_LOOKUP_MAX) {
    // FAIL CLOSED rather than answer about a prefix. See the constant.
    return unreadable(
      `at most ${ATTESTED_IDENTITY_LOOKUP_MAX} identities may be looked up at once, asked ${asked.length}`,
    );
  }

  const wanted = new Set<string>();
  const platforms = new Set<string>();
  const identifiers = new Set<string>();
  for (const ref of asked) {
    const key = engagementIdentityKey(ref?.platform, ref?.platformUserId);
    if (key === null) continue;   // a half-blank pair can never match a stored row
    const platform = normalizeEngagementPlatform(ref.platform);
    const identity = normalizeEngagementIdentity(ref.platformUserId);
    if (platform === null || identity === null) continue;
    wanted.add(key);
    platforms.add(platform);
    identifiers.add(identity);
  }

  // NOTHING WAS ASKED, so nothing is owned — and the question WAS answerable.
  // This is the one legible empty set in this function, and it costs no read.
  if (wanted.size === 0) {
    return { legible: true, detail: null, ownedKeys: new Set<string>() };
  }

  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .select('organization_id, platform, platform_user_id, revoked_at')
      .eq('organization_id', query.organizationId)   // tenant boundary — always FIRST
      .is('revoked_at', null)                        // ACTIVE only
      .in('platform', Array.from(platforms))
      .in('platform_user_id', Array.from(identifiers))
      .limit(ATTESTED_IDENTITY_LOOKUP_MAX);
  } catch (e) {
    return unreadable(`read threw: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error !== null) {
    return unreadable(isRelationIllegible(error)
      ? `the relation could not be read: ${error.message ?? error.code}`
      : `read failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`);
  }

  const rows = Array.isArray(res.data) ? (res.data as IdentityRow[]) : [];
  const ownedKeys = new Set<string>();
  for (const raw of rows) {
    if (!raw) continue;
    // Tenant AND active state re-asserted on the ROW, not only in the query.
    if (raw.organization_id !== query.organizationId) continue;
    if (typeof raw.revoked_at === 'string' && raw.revoked_at.trim() !== '') continue;
    // THE PAIR RE-MATCH. This is what collapses the `.in` cross product back to
    // the identities that were actually asked about.
    const key = engagementIdentityKey(raw.platform, raw.platform_user_id);
    if (key === null) continue;
    if (!wanted.has(key)) continue;
    ownedKeys.add(key);
  }

  return { legible: true, detail: null, ownedKeys };
}
