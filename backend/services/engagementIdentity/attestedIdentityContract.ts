/**
 * Attested engagement identities — the shared contract.
 *
 * ─── WHAT AN ATTESTATION IS ───────────────────────────────────────────────
 * An authorized organization administrator stating that one ENGAGEMENT-NAMESPACE
 * identity — a `(platform, platform_user_id)` pair exactly as
 * `engagement_authors` holds it — belongs to their own organization. It is a
 * RECORD, not a proof: an administrator can attest an identity that is not
 * theirs, and this contract claims nothing stronger.
 *
 * ─── NEGATIVE EVIDENCE ONLY ───────────────────────────────────────────────
 * An active attestation means "never admit this as a prospect's own statement".
 * It never means the opposite:
 *   · an UNREGISTERED identity is NOT thereby proven external, and must still
 *     pass every positive authorship, tenant, subject and timestamp check;
 *   · an UNREADABLE registry is NOT an empty registry. A failed read is
 *     fail-closed — `store_unavailable` — never "nothing is owned, carry on".
 * Both of those confusions are how the predecessor failed, and both are the
 * reason this file exists rather than a boolean.
 *
 * ─── WHY NOT THE OAUTH TABLES ─────────────────────────────────────────────
 * `engagementThreadService.getOrgAuthorIds` compares
 * `engagement_authors.platform_user_id` (a profile URL, a handle, or an
 * `anon_*` / `extension_author_*` fallback) against
 * `social_accounts.platform_user_id` (an OAuth-native opaque id). Those are
 * different namespaces for every live writer, so the comparison is true only by
 * accident — and because that function also discards the `error` on all three of
 * its reads, a failure reads as "the workspace owns nobody". This registry
 * replaces that decision with an explicit, revocable, tenant-scoped statement,
 * and deliberately has NO column, key or join reachable from an OAuth table, so
 * no backfill from one has a target to aim at.
 */

/** The relation. Named once, so a reader and the repository cannot drift. */
export const ATTESTED_ENGAGEMENT_IDENTITY_RELATION = 'attested_engagement_identities';

/** What is attested. A closed set of one: a second role arrives by migration. */
export const ATTESTED_AS_TENANT_OWN = 'tenant_own';

/**
 * Lower-case and trim the platform. NOTHING ELSE.
 *
 * ─── DO NOT USE `backend/constants/platforms.ts` HERE ──────────────────────
 * That helper ALIASES — `x` → `twitter`, `li` → `linkedin`, `tw` → `twitter`,
 * `meta` → `facebook`. `engagement_authors.platform` was written by
 * `engagementNormalizationService`, which lower-cases and does not alias, so a
 * stored row may legitimately hold `'x'` or `'li'`. A registry that aliased on
 * the way in would store `'twitter'`, never equality-match the `'x'` author row
 * it was about, and silently protect nothing — a registry that looks correct and
 * matches nothing. This function therefore mirrors the WRITER's semantics, not
 * the display layer's, and a test pins that `'x'` stays `'x'`.
 */
export function normalizeEngagementPlatform(platform: string | null | undefined): string | null {
  if (typeof platform !== 'string') return null;
  const value = platform.trim().toLowerCase();
  return value === '' ? null : value;
}

/**
 * Trim the identity. **CASE IS PRESERVED.**
 *
 * The value is frequently a profile URL whose path is case-significant, and it
 * can also be an opaque `anon_*` / `extension_author_*` token. Lower-casing
 * would produce a string that is not the identity received, and would stop the
 * row equality-matching the author row it describes — which is the registry's
 * entire purpose. `resolveAuthor` trims and nothing more; so does this.
 */
export function normalizeEngagementIdentity(identity: string | null | undefined): string | null {
  if (typeof identity !== 'string') return null;
  const value = identity.trim();
  return value === '' ? null : value;
}

/**
 * The comparison key: a normalised platform and a verbatim identity.
 *
 * `null` when either half is absent, so a blank identity can never match a
 * blank attestation. The predecessor had to patch exactly that collapse.
 */
export function engagementIdentityKey(
  platform: string | null | undefined,
  identity: string | null | undefined,
): string | null {
  const p = normalizeEngagementPlatform(platform);
  const i = normalizeEngagementIdentity(identity);
  return p === null || i === null ? null : `${p}\u0000${i}`;
}

/** One stored attestation, active or revoked. */
export interface AttestedEngagementIdentity {
  readonly id: string;
  readonly organizationId: string;
  readonly platform: string;
  readonly platformUserId: string;
  readonly attestedAs: string;
  readonly statement: string;
  readonly attestedByUserId: string;
  readonly attestedAt: string;
  readonly revokedAt: string | null;
  readonly revokedByUserId: string | null;
  readonly revokedReason: string | null;
}

/** What a caller supplies to attest. The tenant and the actor are server-derived. */
export interface AttestIdentityInput {
  readonly organizationId: string;
  readonly platform: string;
  /** Stored verbatim after an outer trim. Never case-folded. */
  readonly platformUserId: string;
  readonly statement: string;
  readonly attestedByUserId: string;
}

export type AttestIdentityResult =
  | { readonly ok: true; readonly id: string; readonly alreadyActive: boolean }
  | { readonly ok: false; readonly reason: AttestationFailure; readonly detail: string };

export type RevokeIdentityResult =
  | { readonly ok: true; readonly revoked: boolean }
  | { readonly ok: false; readonly reason: AttestationFailure; readonly detail: string };

/**
 * Why a registry operation did not happen.
 *
 * `store_unavailable` is the fail-closed answer and is NEVER "nothing is
 * owned". Callers that treat it as an empty set reintroduce the defect.
 */
export type AttestationFailure =
  | 'invalid_input'
  | 'not_found'
  | 'already_revoked'
  | 'store_unavailable';

/**
 * The answer to "are any of these identities owned by this tenant?".
 *
 * `legible: false` means THE QUESTION COULD NOT BE ASKED. It is deliberately a
 * separate field rather than an empty `ownedKeys`, because an empty set and an
 * unanswerable read must not be representable by the same value.
 */
export interface OwnedIdentityLookup {
  readonly legible: boolean;
  readonly detail: string | null;
  /** Keys from `engagementIdentityKey`, for identities with an ACTIVE attestation. */
  readonly ownedKeys: ReadonlySet<string>;
}
