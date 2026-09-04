/**
 * W1 — shadow identity resolution. READ / OBSERVE ONLY.
 *
 * Answers exactly one question:
 *
 *     "Would this incoming identity resolve to a canonical person already
 *      known to this tenant — and on what evidence?"
 *
 * It does NOT resolve. It does not create, merge, link, revoke, delete or
 * rewrite anything. Every function here issues SELECTs only, and that is
 * structural rather than a promise: no write helper is imported.
 *
 * ─── WHY OBSERVE-ONLY ──────────────────────────────────────────────────────
 * `identityResolutionService.resolveUnifiedPerson` is the LIVE write path and
 * already resolves-or-creates against unified_persons. This module deliberately
 * does not call it. Running a second writer against the same spine would create
 * two sources of truth for "who is this person", and an incorrect automatic
 * merge is close to unrecoverable: once two humans share one canonical record,
 * the evidence that they were ever distinct is gone. Observation first, with
 * the verdict recorded, is what makes the eventual cutover auditable.
 *
 * ─── TENANT SCOPE ──────────────────────────────────────────────────────────
 * Every query is filtered by organization_id / company_id. The backend uses a
 * service-role client that bypasses RLS, so that filter IS the tenant boundary —
 * it is never optional and never inferred from the value being resolved.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  normalizeClaimValue,
  normalizePlatform,
  isPlatformFree,
  type ClaimType,
} from './normalization';

/** One identifier offered for resolution, before normalization. */
export interface IdentityCandidate {
  claimType: ClaimType;
  value: string | null | undefined;
  /** Required for external_* types; ignored for email/phone/domain. */
  platform?: string | null;
}

/** How a candidate was matched, or why it was not. */
export type ResolutionOutcome =
  | 'matched_claim'    // an existing identity_claims row named a person
  | 'matched_spine'    // unified_persons itself carries the identifier
  | 'unresolved'       // normalized fine, nobody in this tenant has it
  | 'ambiguous'        // more than one distinct person matched
  | 'unusable';        // did not normalize to anything

export interface CandidateVerdict {
  claimType: ClaimType;
  platform: string | null;
  normalizedValue: string | null;
  outcome: ResolutionOutcome;
  /** Distinct person ids this candidate points at. */
  personIds: string[];
  /** Human-readable justification. Persisted as claim evidence when recorded. */
  reason: string;
}

export interface ShadowResolution {
  organizationId: string;
  /** The single person all usable candidates agree on, when they do. */
  personId: string | null;
  outcome: ResolutionOutcome;
  /** Every distinct person any candidate pointed at. >1 means conflict. */
  candidatePersonIds: string[];
  verdicts: CandidateVerdict[];
  reason: string;
  evaluatedAt: string;
}

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

/**
 * Look a normalized identifier up in identity_claims. Active claims only — a
 * revoked claim is a record that we STOPPED believing something, and resolving
 * on it would resurrect exactly the belief that was withdrawn.
 */
async function matchClaims(
  organizationId: string,
  claimType: ClaimType,
  platform: string | null,
  normalizedValue: string,
): Promise<string[]> {
  let q = ownedDbTable('identity_claims')
    .select('person_id')
    .eq('organization_id', organizationId)   // tenant boundary — never optional
    .eq('claim_type', claimType)
    .eq('normalized_value', normalizedValue)
    .is('revoked_at', null)
    .not('person_id', 'is', null)
    .limit(50);

  q = platform === null ? q.is('platform', null) : q.eq('platform', platform);

  const { data, error } = await q;
  if (error) throw new Error(`identity_claims lookup failed: ${error.message}`);
  return uniq((data ?? []).map((r: { person_id: string | null }) => r.person_id as string));
}

/**
 * Fall back to the spine itself. unified_persons predates identity_claims and
 * already holds primary_email / primary_phone for 23 production rows, so a
 * claims-only resolver would report "unresolved" for people the platform
 * demonstrably knows.
 */
async function matchSpine(
  organizationId: string,
  claimType: ClaimType,
  normalizedValue: string,
): Promise<string[]> {
  if (claimType !== 'email' && claimType !== 'phone') return [];
  const column = claimType === 'email' ? 'primary_email' : 'primary_phone';

  const { data, error } = await ownedDbTable('unified_persons')
    .select('id')
    .eq('company_id', organizationId)        // tenant boundary
    .eq(column, normalizedValue)
    .limit(50);

  if (error) throw new Error(`unified_persons lookup failed: ${error.message}`);
  return uniq((data ?? []).map((r: { id: string }) => r.id));
}

/** Evaluate one candidate. Read-only. */
export async function evaluateCandidate(
  organizationId: string,
  candidate: IdentityCandidate,
): Promise<CandidateVerdict> {
  const platform = normalizePlatform(candidate.claimType, candidate.platform);
  const normalizedValue = normalizeClaimValue(candidate.claimType, candidate.value);

  const base = { claimType: candidate.claimType, platform, normalizedValue };

  if (!normalizedValue) {
    return { ...base, outcome: 'unusable', personIds: [], reason: 'value did not normalize to an identifier' };
  }
  if (!isPlatformFree(candidate.claimType) && !platform) {
    return { ...base, outcome: 'unusable', personIds: [], reason: `${candidate.claimType} requires a platform` };
  }

  const claimMatches = await matchClaims(organizationId, candidate.claimType, platform, normalizedValue);
  if (claimMatches.length === 1) {
    return { ...base, outcome: 'matched_claim', personIds: claimMatches, reason: 'active identity_claim names this person' };
  }
  if (claimMatches.length > 1) {
    return { ...base, outcome: 'ambiguous', personIds: claimMatches, reason: `${claimMatches.length} distinct persons hold this claim` };
  }

  const spineMatches = await matchSpine(organizationId, candidate.claimType, normalizedValue);
  if (spineMatches.length === 1) {
    return { ...base, outcome: 'matched_spine', personIds: spineMatches, reason: 'unified_persons carries this identifier' };
  }
  if (spineMatches.length > 1) {
    return { ...base, outcome: 'ambiguous', personIds: spineMatches, reason: `${spineMatches.length} distinct persons carry this identifier` };
  }

  return { ...base, outcome: 'unresolved', personIds: [], reason: 'no active claim or spine record in this tenant' };
}

/**
 * Evaluate a set of candidates together.
 *
 * Disagreement is reported, never averaged away: if two candidates point at two
 * different people, the result is `ambiguous` with both ids. Silently picking a
 * winner is how an automatic merge fuses two humans — the whole reason this
 * runs in shadow.
 */
export async function resolveIdentityShadow(
  organizationId: string,
  candidates: IdentityCandidate[],
  now: string = new Date().toISOString(),
): Promise<ShadowResolution> {
  if (!organizationId?.trim()) throw new Error('organizationId is required for shadow resolution');

  const verdicts: CandidateVerdict[] = [];
  for (const c of candidates) verdicts.push(await evaluateCandidate(organizationId, c));

  const candidatePersonIds = uniq(verdicts.flatMap(v => v.personIds));
  const usable = verdicts.filter(v => v.outcome !== 'unusable');

  let outcome: ResolutionOutcome;
  let personId: string | null = null;
  let reason: string;

  if (usable.length === 0) {
    outcome = 'unusable';
    reason = 'no candidate produced a usable identifier';
  } else if (candidatePersonIds.length === 0) {
    outcome = 'unresolved';
    reason = 'no candidate matched any person in this tenant';
  } else if (candidatePersonIds.length > 1) {
    outcome = 'ambiguous';
    reason = `candidates point at ${candidatePersonIds.length} distinct persons`;
  } else {
    personId = candidatePersonIds[0];
    outcome = verdicts.some(v => v.outcome === 'matched_claim') ? 'matched_claim' : 'matched_spine';
    reason = 'all matching candidates agree on one person';
  }

  return { organizationId, personId, outcome, candidatePersonIds, verdicts, reason, evaluatedAt: now };
}
