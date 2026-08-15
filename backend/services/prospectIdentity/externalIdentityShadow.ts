/**
 * LI-5B Phase 1 — external identity lookup against `identity_claims`, in SHADOW.
 *
 * LI-5A.1 established that `identity_claims` is the canonical external-identity
 * store: `(organization_id, claim_type, platform, normalized_value)` unique
 * `NULLS NOT DISTINCT WHERE revoked_at IS NULL`, with the database enforcing
 * that `external_id` / `external_profile` carry a platform. The live resolver
 * still matches on `unified_persons.external_keys`, which has no uniqueness at
 * all — a GIN index only.
 *
 * This module computes what the claims-based lookup WOULD answer and compares it
 * with what the live lookup DID answer. It changes no decision.
 *
 * ─── STRICTLY READ-ONLY ───────────────────────────────────────────────────
 * One `select` and nothing else. It creates no claim, writes no person, records
 * no provenance, raises no duplicate candidate and touches no governance. That
 * is structural: no write helper is imported.
 *
 * ─── IT DOES NOT PROMOTE UNRESOLVED CLAIMS ────────────────────────────────
 * The query requires `person_id IS NOT NULL`. The 10 LinkedIn claims currently
 * carrying `person_id = NULL` are therefore observed by the schema but can never
 * become a shadow match — attaching them is an identity decision (LI-5A.1 Q-2)
 * that this phase may not make.
 *
 * ─── IT DOES NOT INTERPRET LEGACY VALUES ──────────────────────────────────
 * `linkedin_urns`, `external_user_keys` and `unified_person_id` are read from
 * nothing here. The shadow considers only the `{ provider: { external_id } }`
 * shape the current code writes, so a legacy array can never be mistaken for a
 * provider identity. LI-5A.1 Q-1 stays open, and stays uninfluenced.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  normalizeExternalIdentity,
  normalizePlatform,
  type ClaimType,
} from './normalization';

/** Claim types that carry a platform and therefore express an external identity. */
export const EXTERNAL_CLAIM_TYPES: readonly ClaimType[] = ['external_id', 'external_profile'] as const;

/**
 * How the live answer and the shadow answer relate. Every lookup lands in
 * exactly one of these; nothing is silently reconciled.
 */
export const SHADOW_CATEGORIES = [
  'SAME_PERSON',
  'BOTH_UNRESOLVED',
  'CURRENT_ONLY',
  'SHADOW_ONLY',
  'DISAGREEMENT',
  'MULTIPLE_SHADOW_MATCHES',
  'ERROR',
] as const;
export type ShadowCategory = typeof SHADOW_CATEGORIES[number];

/** One `(platform, value)` pair extracted from a caller's external keys. */
export interface ExternalIdentityPair {
  platform: string;
  normalizedValue: string;
}

export interface ShadowLookupResult {
  ok: boolean;
  /** Distinct persons the claims store points at. */
  personIds: string[];
  /** Which claim types actually matched — Q-3 is open, so both are observed. */
  matchedClaimTypes: ClaimType[];
  pairsProbed: number;
  error?: string;
}

export interface ShadowComparison {
  category: ShadowCategory;
  currentPersonId: string | null;
  shadowPersonIds: string[];
  pairsProbed: number;
  matchedClaimTypes: ClaimType[];
  error?: string;
}

/**
 * Extract `(platform, normalized value)` pairs from the external-keys shape the
 * current code writes: `{ apollo: { external_id: '…' } }`.
 *
 * Anything else — a string, an array, a missing `external_id` — yields nothing.
 * That is deliberate: it is exactly what keeps the legacy `linkedin_urns[]` and
 * `external_user_keys[]` arrays out of the shadow result.
 */
export function extractExternalIdentityPairs(
  externalKeys: Record<string, unknown> | null | undefined,
): ExternalIdentityPair[] {
  if (!externalKeys || typeof externalKeys !== 'object' || Array.isArray(externalKeys)) return [];

  const pairs: ExternalIdentityPair[] = [];
  const seen = new Set<string>();

  for (const [provider, value] of Object.entries(externalKeys)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const externalId = (value as Record<string, unknown>).external_id;
    if (typeof externalId !== 'string') continue;

    // Reuse the platform and identity rules the claims writer already uses.
    // A second spelling here would make the shadow disagree with the store it
    // is supposed to be validating.
    const platform = normalizePlatform('external_id', provider);
    const normalizedValue = normalizeExternalIdentity(externalId);
    if (!platform || !normalizedValue) continue;

    const key = `${platform}\u0000${normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ platform, normalizedValue });
  }
  return pairs;
}

/**
 * Ask `identity_claims` which persons these external identities point at.
 *
 * ONE query regardless of how many providers a caller supplied: the values and
 * platforms are sent as `in()` filters and the pairs are re-matched in memory.
 * A per-provider query would be N+1 on a path every ingestion runs.
 *
 * The cross-product that `in() × in()` can return is filtered back down to the
 * exact pairs asked for, so `(apollo, 123)` never matches `(linkedin, 123)`.
 */
export async function lookupExternalIdentityClaims(
  organizationId: string,
  pairs: ExternalIdentityPair[],
): Promise<ShadowLookupResult> {
  if (!organizationId?.trim()) {
    return { ok: false, personIds: [], matchedClaimTypes: [], pairsProbed: 0, error: 'organizationId is required' };
  }
  if (pairs.length === 0) {
    return { ok: true, personIds: [], matchedClaimTypes: [], pairsProbed: 0 };
  }

  const platforms = [...new Set(pairs.map((p) => p.platform))];
  const values = [...new Set(pairs.map((p) => p.normalizedValue))];

  const res = await ownedDbTable('identity_claims')
    .select('person_id, platform, normalized_value, claim_type')
    .eq('organization_id', organizationId)              // TENANT FIRST, always
    .in('claim_type', EXTERNAL_CLAIM_TYPES as unknown as string[])
    .in('platform', platforms)
    .in('normalized_value', values)
    .is('revoked_at', null)                             // a revoked claim is withdrawn
    .not('person_id', 'is', null)                       // never promote an unresolved claim
    .limit(200);

  if (res.error) {
    return { ok: false, personIds: [], matchedClaimTypes: [], pairsProbed: pairs.length, error: res.error.message };
  }

  const wanted = new Set(pairs.map((p) => `${p.platform}\u0000${p.normalizedValue}`));
  const personIds = new Set<string>();
  const claimTypes = new Set<ClaimType>();

  for (const row of (res.data ?? []) as Array<Record<string, unknown>>) {
    const platform = typeof row.platform === 'string' ? row.platform : null;
    const value = typeof row.normalized_value === 'string' ? row.normalized_value : null;
    const personId = typeof row.person_id === 'string' ? row.person_id : null;
    if (!platform || !value || !personId) continue;
    // Discard the cross-product: only the pairs actually asked for count.
    if (!wanted.has(`${platform}\u0000${value}`)) continue;
    personIds.add(personId);
    if (typeof row.claim_type === 'string') claimTypes.add(row.claim_type as ClaimType);
  }

  return {
    ok: true,
    personIds: [...personIds],
    matchedClaimTypes: [...claimTypes],
    pairsProbed: pairs.length,
  };
}

/**
 * Classify the live answer against the shadow answer.
 *
 * `MULTIPLE_SHADOW_MATCHES` is reported ahead of agreement even when the live
 * person is among them: several claims pointing at several people is a finding
 * in its own right, and collapsing it to `SAME_PERSON` would hide it.
 */
export function classifyShadow(
  currentPersonId: string | null,
  shadow: ShadowLookupResult,
): ShadowCategory {
  if (!shadow.ok) return 'ERROR';
  if (shadow.personIds.length > 1) return 'MULTIPLE_SHADOW_MATCHES';

  const shadowPersonId = shadow.personIds[0] ?? null;
  if (!currentPersonId && !shadowPersonId) return 'BOTH_UNRESOLVED';
  if (currentPersonId && !shadowPersonId) return 'CURRENT_ONLY';
  if (!currentPersonId && shadowPersonId) return 'SHADOW_ONLY';
  return currentPersonId === shadowPersonId ? 'SAME_PERSON' : 'DISAGREEMENT';
}

/**
 * Run the shadow comparison. NEVER throws.
 *
 * The caller is the live resolver, so a failure here must not fail a resolution
 * that otherwise succeeded — the shadow is an observation, not a gate. Failures
 * surface as the `ERROR` category rather than as a silent absence, so a
 * consistently-broken shadow is visible rather than looking like agreement.
 */
export async function compareExternalIdentityShadow(input: {
  organizationId: string;
  externalKeys: Record<string, unknown> | null | undefined;
  currentPersonId: string | null;
}): Promise<ShadowComparison> {
  let pairs: ExternalIdentityPair[] = [];
  try {
    pairs = extractExternalIdentityPairs(input.externalKeys);
    const shadow = await lookupExternalIdentityClaims(input.organizationId, pairs);
    return {
      category: classifyShadow(input.currentPersonId, shadow),
      currentPersonId: input.currentPersonId,
      shadowPersonIds: shadow.personIds,
      pairsProbed: shadow.pairsProbed,
      matchedClaimTypes: shadow.matchedClaimTypes,
      error: shadow.error,
    };
  } catch (e) {
    return {
      category: 'ERROR',
      currentPersonId: input.currentPersonId,
      shadowPersonIds: [],
      pairsProbed: pairs.length,
      matchedClaimTypes: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
