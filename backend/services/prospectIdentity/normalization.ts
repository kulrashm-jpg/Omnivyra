/**
 * W1 — normalization for identity claims.
 *
 * This module DELEGATES. It defines no new normalization rule, because the
 * repository already has the ones that matter and a second implementation
 * would drift from the first:
 *
 *   email / phone → backend/services/identityResolutionService.ts
 *                   The live resolver already matches unified_persons on these
 *                   exact forms. A claim normalized differently from the spine
 *                   it points at would never resolve.
 *   domain        → lib/shared/domain/companyDomain.ts (normalizeCompanyDomain)
 *                   Already the documented single source of truth for company
 *                   identity keys, including multi-part TLDs (co.uk, com.au…).
 *
 * The only rule authored here is for external platform identities, which had no
 * existing normalizer. It is deliberately CONSERVATIVE: trim, lowercase, and —
 * for profile URLs only — reduce to the path. Nothing else. Aggressive
 * canonicalisation is how two different people become one, and a claim that
 * merges distinct humans is worse than a claim that misses a match.
 *
 * Every rule here is deterministic and total: same input, same output, no clock,
 * no I/O, no randomness.
 */

import { normalizeEmail, normalizePhone } from '../identityResolutionService';
import { normalizeCompanyDomain } from '../../../lib/shared/domain/companyDomain';

/** Claim vocabulary. Mirrors the identity_claims_type_valid CHECK constraint. */
export type ClaimType = 'email' | 'phone' | 'domain' | 'external_profile' | 'external_id';

export const CLAIM_TYPES: readonly ClaimType[] = [
  'email', 'phone', 'domain', 'external_profile', 'external_id',
] as const;

/** Types that are provider-agnostic and therefore carry NO platform. */
export const PLATFORM_FREE_CLAIM_TYPES: readonly ClaimType[] = ['email', 'phone', 'domain'] as const;

export const isClaimType = (v: unknown): v is ClaimType =>
  typeof v === 'string' && (CLAIM_TYPES as readonly string[]).includes(v);

/** True when this claim type must NOT carry a platform. */
export const isPlatformFree = (t: ClaimType): boolean =>
  (PLATFORM_FREE_CLAIM_TYPES as readonly string[]).includes(t);

/**
 * Normalize an external platform identity.
 *
 * A profile URL is reduced to its path so that
 * `https://www.linkedin.com/in/Jane-Doe/` and `linkedin.com/in/jane-doe`
 * agree — but a bare handle is only trimmed and lowercased. We do NOT strip
 * punctuation, unify separators, or drop suffixes: on most platforms
 * `jane.doe`, `jane-doe` and `janedoe` are three different accounts.
 */
export function normalizeExternalIdentity(value?: string | null): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;

  // Looks like a URL → keep scheme-less host+path, drop query/fragment and a
  // single trailing slash. Host is kept: the same path on two platforms is two
  // identities.
  if (/^[a-z][a-z0-9+\-.]*:\/\//.test(raw) || raw.includes('/')) {
    const withoutScheme = raw.replace(/^[a-z][a-z0-9+\-.]*:\/\//, '');
    const withoutQuery = withoutScheme.split('?')[0].split('#')[0];
    const trimmed = withoutQuery.replace(/\/+$/, '').replace(/^www\./, '');
    return trimmed || null;
  }

  // Bare handle — strip a single leading '@' and nothing else.
  return raw.replace(/^@/, '') || null;
}

/** Normalize a domain claim. Delegates to the canonical company-domain rule. */
export function normalizeDomainClaim(value?: string | null): string | null {
  const normalized = normalizeCompanyDomain(value ?? undefined);
  return normalized || null;
}

/**
 * Normalize any claim value by type. Returns null when the value cannot yield a
 * usable identifier — callers must treat null as "no claim", never as a claim
 * whose value is empty.
 */
export function normalizeClaimValue(claimType: ClaimType, value?: string | null): string | null {
  switch (claimType) {
    case 'email':  return normalizeEmail(value);
    case 'phone':  return normalizePhone(value);
    case 'domain': return normalizeDomainClaim(value);
    case 'external_profile':
    case 'external_id':
      return normalizeExternalIdentity(value);
    default: {
      // Exhaustiveness guard: adding a ClaimType without a rule fails to compile.
      const never: never = claimType;
      return never;
    }
  }
}

/**
 * Normalize a platform name. NULL for platform-free types, so the value written
 * always satisfies identity_claims_platform_rule.
 */
export function normalizePlatform(claimType: ClaimType, platform?: string | null): string | null {
  if (isPlatformFree(claimType)) return null;
  const p = String(platform ?? '').trim().toLowerCase();
  return p || null;
}

// Re-exported so callers have ONE import for identity normalization and are not
// tempted to reach for a different email/phone rule.
export { normalizeEmail, normalizePhone, normalizeCompanyDomain };
