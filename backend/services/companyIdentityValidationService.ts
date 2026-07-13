/**
 * companyIdentityValidationService.ts
 *
 * THE single authoritative company-eligibility engine. Decides — once, at
 * signup — whether a company may self-register on Omnivyra. Onboarding and
 * setup-company CONSUME this verdict and never re-derive it.
 *
 * Business rule (authoritative):
 *   1. Email is not from a personal/free provider.
 *   2. Email domain has valid email capability (MX, not disposable/blocked/forwarding).
 *   3. A live website exists at the email domain.
 *   4. Website domain matches email domain.
 *   5. Company domain is not already claimed by another organization.
 *
 * Website source (per product decision D2): the website is DERIVED from the
 * email domain (`https://www.<normalizedEmailDomain>`), so rule 4 is satisfied
 * by construction and the meaningful website gate is rule 3 (a live, canonical,
 * non-forwarding site at that domain). The DOMAIN_MISMATCH branch is retained
 * for correctness should a caller ever pass an explicit website.
 *
 * Invite carve-out (decision D1): personal-email teammates join via invite /
 * approved access-request and enter through magic-link → sync-supabase-user,
 * NOT through the self-serve signup gate that calls this engine. This engine
 * therefore blocks personal email for self-serve without affecting invites.
 *
 * Composition (no new validation logic — wraps the existing, hardened stages):
 *   A,B  personal/MX/disposable/forwarding-MX  → checkDomainEligibility
 *   C,D,F website existence/reachability/canonical/forwarding → resolveDomain
 *   E    normalization                          → normalizeCompanyDomain
 *   G    existing-company check                 → companies website/admin domain
 */

import { supabase } from '../db/supabaseClient';
import { checkDomainEligibility } from './domainEligibilityService';
import { resolveDomain, type ResolveDomainResult } from './domainCanonicalService';
import { detectParkedDomain, type ParkedDomainVerdict } from './parkedDomainDetectionService';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';
import type { DomainEligibilityResult } from '../../lib/auth/domainEligibilityModel';
import {
  getCachedDomainVerdict,
  setCachedDomainVerdict,
  type CachedDomainVerdict,
} from './companyIdentityValidationCache';

/** Bump when the validation semantics change; stored alongside the verdict. */
export const COMPANY_IDENTITY_VALIDATION_VERSION = 'company-identity-v1';

export interface CompanyIdentity {
  eligible: boolean;

  emailDomain: string;
  normalizedEmailDomain: string;

  websiteUrl: string;
  websiteDomain: string;
  normalizedWebsiteDomain: string;

  /** Canonical identity key = registrable domain + TLD. */
  companyIdentityDomain: string;

  /** Null when eligible; otherwise a canonical result code explaining the block. */
  validationReason: DomainEligibilityResult | null;

  /** True when the user should be routed to the manual-review queue, not hard-rejected. */
  requiresManualReview: boolean;

  /**
   * Validation diagnostics (AUTH-001 §7) — structured detail for operators;
   * never surfaced to end users. Currently carries the parked-domain marker.
   */
  diagnostics?: { parkedMarker?: string } | null;

  /** Set when rule 5 matched — the org that already owns this domain. */
  existingCompany?: { id: string; name: string | null } | null;
}

/** Injectable seams — defaults wire to the real, hardened implementations. */
export interface ValidateCompanyIdentityDeps {
  checkEligibility?: (email: string) => Promise<{ result: DomainEligibilityResult; eligible: boolean }>;
  probeWebsite?: (domain: string) => Promise<ResolveDomainResult>;
  /** AUTH-001 §7 — parked/expired-lander content check (defaults to the real detector). */
  probeParked?: (finalDomain: string) => Promise<ParkedDomainVerdict>;
  lookupClaimedCompany?: (normalizedDomain: string) => Promise<{ id: string; name: string | null } | null>;
  /** Phase 11D cache seams (defaults wire to the in-memory success cache). */
  now?: () => number;
  cacheGet?: (domain: string, nowMs: number) => CachedDomainVerdict | null;
  cacheSet?: (domain: string, verdict: CachedDomainVerdict) => void;
}

/** Default rule-5 lookup: an active company already owning this domain. */
async function defaultLookupClaimedCompany(
  normalizedDomain: string,
): Promise<{ id: string; name: string | null } | null> {
  if (!normalizedDomain) return null;
  const { data } = await supabase
    .from('companies')
    .select('id, name')
    .eq('status', 'active')
    .or(`website_domain.eq.${normalizedDomain},admin_email_domain.eq.${normalizedDomain}`)
    .maybeSingle();
  return data ? { id: (data as any).id, name: (data as any).name ?? null } : null;
}

function block(
  base: Omit<CompanyIdentity, 'eligible' | 'validationReason' | 'requiresManualReview' | 'existingCompany'>,
  reason: DomainEligibilityResult,
  requiresManualReview: boolean,
  existingCompany: { id: string; name: string | null } | null = null,
): CompanyIdentity {
  return { ...base, eligible: false, validationReason: reason, requiresManualReview, existingCompany };
}

/**
 * Authoritative company-identity validation. Pure decision flow over three
 * injectable stages; no side effects (does not write the review queue or any
 * verdict — callers persist as appropriate).
 */
export async function validateCompanyIdentity(
  email: string,
  deps: ValidateCompanyIdentityDeps = {},
): Promise<CompanyIdentity> {
  const checkEligibility = deps.checkEligibility ?? (async (e: string) => {
    const r = await checkDomainEligibility(e);
    return { result: r.result, eligible: r.eligible };
  });
  const probeWebsite = deps.probeWebsite ?? resolveDomain;
  const probeParked = deps.probeParked ?? detectParkedDomain;
  const lookupClaimedCompany = deps.lookupClaimedCompany ?? defaultLookupClaimedCompany;
  const now = deps.now ?? Date.now;
  const cacheGet = deps.cacheGet ?? getCachedDomainVerdict;
  const cacheSet = deps.cacheSet ?? setCachedDomainVerdict;

  const rawEmailDomain = String(email || '').trim().toLowerCase().split('@')[1]?.trim() ?? '';
  const normalizedEmailDomain = normalizeCompanyDomain(email);

  // Website is derived from the (normalized) email domain — see D2.
  const websiteDomain = normalizedEmailDomain;
  const websiteUrl = normalizedEmailDomain ? `https://www.${normalizedEmailDomain}` : '';
  const normalizedWebsiteDomain = normalizeCompanyDomain(websiteUrl);

  const base = {
    emailDomain: rawEmailDomain,
    normalizedEmailDomain,
    websiteUrl,
    websiteDomain,
    normalizedWebsiteDomain,
    companyIdentityDomain: normalizedEmailDomain,
  } as const;

  // Malformed / missing domain.
  if (!normalizedEmailDomain) return block(base, 'BLOCKED', false);

  // ── Phase 11D cache: a recent SUCCESSFUL verdict for this domain lets us skip
  // the expensive eligibility + DNS/website probe. The claimed-domain check (DB
  // state, changes over time) is ALWAYS re-run on a hit, so the cache can never
  // let a now-claimed domain through. Only clean successes are ever cached, so a
  // hit is always eligible=true. Validation policy is unchanged.
  const cached = cacheGet(normalizedEmailDomain, now());
  if (cached) {
    const claimedOnHit = await lookupClaimedCompany(normalizedEmailDomain);
    if (claimedOnHit) return block(base, 'CLAIMED_DOMAIN', false, claimedOnHit);
    return {
      ...base,
      websiteUrl: cached.websiteUrl,
      websiteDomain: cached.websiteDomain,
      normalizedWebsiteDomain: cached.normalizedWebsiteDomain,
      companyIdentityDomain: cached.companyIdentityDomain,
      eligible: true,
      validationReason: null,
      requiresManualReview: false,
      existingCompany: null,
    };
  }

  // ── A,B: personal / MX / disposable / blocked / forwarding-MX ──────────────
  const eligibility = await checkEligibility(email);
  if (!eligibility.eligible) {
    // PUBLIC_EMAIL / DISPOSABLE_EMAIL / NO_EMAIL_CAPABILITY / BLOCKED → hard block.
    // FORWARDING_DOMAIN → manual-review path.
    const review = eligibility.result === 'FORWARDING_DOMAIN';
    return block(base, eligibility.result, review);
  }

  // ── Rule 4: derived website must match email domain (always true under D2) ──
  if (normalizedWebsiteDomain && normalizedWebsiteDomain !== normalizedEmailDomain) {
    return block(base, 'DOMAIN_MISMATCH', false);
  }

  // ── Rule 5: domain already claimed by another organization ─────────────────
  const claimed = await lookupClaimedCompany(normalizedEmailDomain);
  if (claimed) return block(base, 'CLAIMED_DOMAIN', false, claimed);

  // ── C,D,F: live website existence / reachability / canonical / forwarding ──
  const resolution = await probeWebsite(normalizedEmailDomain);
  if (resolution.resolution_blocked) {
    // SSRF / private-IP — hard block, never a review candidate.
    return block(base, 'BLOCKED', false);
  }
  if (resolution.resolution_failed) {
    // No reachable site (incl. fail-closed DNS/timeout) → manual review.
    return block(base, 'NO_WEBSITE_FOUND', true);
  }
  if (resolution.input_domain !== resolution.final_domain) {
    return block(base, 'DOMAIN_NOT_CANONICAL', true);
  }
  if (resolution.is_forwarding) {
    return block(base, 'FORWARDING_DOMAIN', true);
  }

  // ── AUTH-001 §7: parked / expired-lander content check ─────────────────────
  // Runs ONLY when every prior rule passed (one bounded extra GET on the
  // account-creating path). Fail-open: an unchecked probe never blocks.
  // A positive match routes to manual review, mirroring NO_WEBSITE_FOUND.
  const parkedVerdict = await probeParked(resolution.final_domain);
  if (parkedVerdict.parked) {
    return {
      ...block(base, 'PARKED_DOMAIN', true),
      diagnostics: { parkedMarker: parkedVerdict.marker },
    };
  }

  // All five rules satisfied — cache the SUCCESSFUL domain verdict (clean success
  // only; every block()/review-required path above returned without caching, so
  // failures, timeouts, DNS errors, blocks, and review outcomes are never cached).
  cacheSet(normalizedEmailDomain, {
    websiteUrl: base.websiteUrl,
    websiteDomain: base.websiteDomain,
    normalizedWebsiteDomain: base.normalizedWebsiteDomain,
    companyIdentityDomain: base.companyIdentityDomain,
    reviewRequired: false,
    cachedAt: now(),
  });

  return {
    ...base,
    eligible: true,
    validationReason: null,
    requiresManualReview: false,
    existingCompany: null,
  };
}
