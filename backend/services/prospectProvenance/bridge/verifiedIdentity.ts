/**
 * VERIFIED IDENTITY — the one rule both the Lead Intelligence adoption port and
 * the provenance bridge use to decide whether a social author may be joined to,
 * or create, a canonical person (`unified_persons` / `identity_claims`).
 *
 * Owner decision (2026-10-30): a bare, unverified social handle NEVER creates a
 * person. The handle, platform and contact id are kept as SOURCE EVIDENCE (the
 * contribution's `evidence` and `source_records.raw_payload`); a person is
 * linked only after identity is verified.
 *
 * ─── WHAT "VERIFIED" MEANS (reused, not invented) ────────────────────────
 * 1. CONTACT EVIDENCE — a normalised email or phone. That is the existing W1
 *    rule (`identityResolutionService.resolveUnifiedPerson`, email → phone →
 *    keys) and the existing B1 statement of what a handle LACKS
 *    (`prospectIdentity/socialContactResolution.ts` header: "a bare provider
 *    identifier with no email, no phone and no verified name"). Such an identity
 *    still goes through W1, which may create — exactly as before.
 * 2. A LINKED, ACTIVE identity claim — `identity_claims` row of type
 *    `external_id` on this platform, with `person_id IS NOT NULL` and
 *    `revoked_at IS NULL`, in this tenant. That is the read the B1 resolver uses
 *    (`prospectIdentity/shadowResolver.ts` `matchClaims`), and B1 links a social
 *    contact ONLY on it ("the shadow resolver deliberately ignores unlinked
 *    claims — resolving on an observation nobody attributed would invent the
 *    attribution"). Exactly one person ⇒ verified; zero ⇒ unverified; more than
 *    one ⇒ ambiguous ⇒ unverified (never pick one).
 *
 * Nothing else verifies a handle: not `unified_persons.external_keys`
 * containment (that is exactly where handle-minted "ghost" persons live), not a
 * name, title, company or profile URL, and not `attested_engagement_identities`
 * (which is NEGATIVE evidence — "this identity is the tenant's own" — never a
 * statement that a prospect is who they claim to be).
 *
 * This module only READS (the shadow resolver imports no write helper).
 */
import { normalizeEmail, normalizePhone } from '../../identityResolutionService';
import { normalizeExternalIdentity, normalizePlatform } from '../../prospectIdentity/normalization';

/** Bumped when the verification rule changes; stamped on evidence. */
export const VERIFIED_IDENTITY_RULE_VERSION = 'rb.identity.1';

export type IdentityVerificationStatus = 'verified' | 'unverified';

export interface SocialIdentityVerdict {
  status: IdentityVerificationStatus;
  /** The single linked person, only when `verified`. */
  personId: string | null;
  /** Stable, loggable (no identifiers). */
  reason:
    | 'linked_identity_claim'
    | 'unresolved'
    | 'ambiguous'
    | 'unusable';
  candidateCount: number;
}

/** Minimal shape of `shadowResolver.resolveIdentityShadow` (injectable for tests). */
export type ShadowLookup = (
  organizationId: string,
  candidates: Array<{ claimType: 'external_id'; value: string; platform: string }>,
) => Promise<{ personId: string | null; outcome: string; candidatePersonIds: string[] }>;

async function defaultShadowLookup(
  organizationId: string,
  candidates: Array<{ claimType: 'external_id'; value: string; platform: string }>,
) {
  const { resolveIdentityShadow } = await import('../../prospectIdentity/shadowResolver');
  return resolveIdentityShadow(organizationId, candidates);
}

/** True when the identity carries a contact fact W1 resolves on (email or phone). */
export function hasContactEvidence(email?: string | null, phone?: string | null): boolean {
  return Boolean(normalizeEmail(email) || normalizePhone(phone));
}

/** `<platform>:user` — the key shape Lead Intelligence adoption and the bridge build for a social author. */
const SOCIAL_USER_KEY = /^([a-z0-9_.-]+):user$/i;

/**
 * The social-handle identifiers in an external-keys bag: every `<platform>:user`
 * string value. `contact_id` is a social-contacts row id and is also a
 * social-only identifier (it is not returned as a pair; see `isSocialOnlyKeys`).
 */
export function socialHandlePairs(externalKeys: Record<string, unknown> | null | undefined): Array<{ platform: string; platformUserId: string }> {
  if (!externalKeys || typeof externalKeys !== 'object' || Array.isArray(externalKeys)) return [];
  const out: Array<{ platform: string; platformUserId: string }> = [];
  for (const [k, v] of Object.entries(externalKeys)) {
    const m = SOCIAL_USER_KEY.exec(k);
    if (!m || typeof v !== 'string' || !v.trim()) continue;
    out.push({ platform: m[1], platformUserId: v.trim() });
  }
  return out;
}

/** Does this key bag carry a social-author identifier (a handle or a social contact id)? */
export function hasSocialIdentifier(externalKeys: Record<string, unknown> | null | undefined): boolean {
  if (socialHandlePairs(externalKeys).length > 0) return true;
  const contactId = externalKeys && typeof externalKeys === 'object' ? (externalKeys as Record<string, unknown>).contact_id : null;
  return typeof contactId === 'string' && contactId.trim() !== '';
}

/** The normalised `(platform, handle)` the bridge anchors an unresolved prospect on. Same rules as identity_claims. */
export function normalizedSocialIdentity(platform: string | null | undefined, platformUserId: string | null | undefined): { platform: string; platformUserId: string } | null {
  const p = normalizePlatform('external_id', platform ?? null);
  const v = normalizeExternalIdentity(platformUserId ?? null);
  return p && v ? { platform: p, platformUserId: v } : null;
}

/**
 * Is this social author VERIFIED in this tenant? Read-only. Throws only when the
 * lookup itself fails (callers decide their failure posture).
 */
export async function resolveVerifiedSocialPerson(
  organizationId: string,
  handles: Array<{ platform: string; platformUserId: string }>,
  lookup: ShadowLookup = defaultShadowLookup,
): Promise<SocialIdentityVerdict> {
  const candidates = handles
    .map((h) => normalizedSocialIdentity(h.platform, h.platformUserId))
    .filter((h): h is { platform: string; platformUserId: string } => h !== null)
    .map((h) => ({ claimType: 'external_id' as const, value: h.platformUserId, platform: h.platform }));
  if (candidates.length === 0) return { status: 'unverified', personId: null, reason: 'unusable', candidateCount: 0 };

  const r = await lookup(organizationId, candidates);
  const ids = [...new Set((r.candidatePersonIds ?? []).filter(Boolean))];
  if (ids.length > 1 || r.outcome === 'ambiguous') {
    return { status: 'unverified', personId: null, reason: 'ambiguous', candidateCount: ids.length };
  }
  // Only a CLAIM match verifies a handle. `matched_spine` is unreachable for
  // external_id (the spine fallback is email/phone only) and is refused here so
  // that stays true even if the resolver changes.
  if (r.outcome === 'matched_claim' && r.personId && ids.length === 1) {
    return { status: 'verified', personId: r.personId, reason: 'linked_identity_claim', candidateCount: 1 };
  }
  return { status: 'unverified', personId: null, reason: 'unresolved', candidateCount: ids.length };
}
