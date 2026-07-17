/**
 * Authoritative company-identity validation — Phase 10 regression suite.
 *
 * Two layers:
 *   1. normalizeCompanyDomain — the pure identity-key normalizer (Phase 3).
 *   2. validateCompanyIdentity — the decision flow (Phase 2), exercised
 *      hermetically via injected stage results (no DNS, no DB).
 */

import {
  normalizeCompanyDomain,
  isSameCompanyDomain,
} from '../../../lib/shared/domain/companyDomain';
import {
  validateCompanyIdentity,
  type ValidateCompanyIdentityDeps,
} from '../../services/companyIdentityValidationService';
import type { ResolveDomainResult } from '../../services/domainCanonicalService';
import { clearDomainVerdictCache } from '../../services/companyIdentityValidationCache';

// Phase 11D: validateCompanyIdentity now caches successful verdicts in a
// module-global cache. These cases reuse the same domain with different mocked
// probe outcomes (impossible in production), so isolate the cache per test.
beforeEach(() => clearDomainVerdictCache());

// ── Test helpers ──────────────────────────────────────────────────────────────

const LIVE_CANONICAL = (domain: string): ResolveDomainResult => ({
  input_domain: domain,
  final_domain: domain,
  redirect_chain: [],
  is_forwarding: false,
});

/** Build deps where every stage is a happy-path stub unless overridden. */
function deps(over: Partial<ValidateCompanyIdentityDeps> = {}): ValidateCompanyIdentityDeps {
  return {
    checkEligibility: async () => ({ result: 'DOMAIN_ELIGIBLE', eligible: true }),
    probeWebsite: async (d) => LIVE_CANONICAL(d),
    // AUTH-001 §7: stub the parked-domain probe so unit tests stay
    // deterministic (the default implementation performs a real fetch).
    probeParked: async () => ({ parked: false, checked: true }),
    lookupClaimedCompany: async () => null,
    ...over,
  };
}

// ── 1. normalizeCompanyDomain (Phase 3) ────────────────────────────────────────

describe('normalizeCompanyDomain — identity key = registrable domain + TLD', () => {
  it('treats acme.com, www.acme.com, and URLs as the same key', () => {
    expect(normalizeCompanyDomain('acme.com')).toBe('acme.com');
    expect(normalizeCompanyDomain('www.acme.com')).toBe('acme.com');
    expect(normalizeCompanyDomain('https://acme.com')).toBe('acme.com');
    expect(normalizeCompanyDomain('https://www.acme.com/pricing?x=1')).toBe('acme.com');
  });

  it('extracts the domain from an email address', () => {
    expect(normalizeCompanyDomain('john@acme.com')).toBe('acme.com');
    expect(normalizeCompanyDomain('JOHN@ACME.COM')).toBe('acme.com');
  });

  it('collapses subdomains to the registrable root', () => {
    expect(normalizeCompanyDomain('john@mail.acme.com')).toBe('acme.com');
    expect(normalizeCompanyDomain('careers.acme.com')).toBe('acme.com');
  });

  it('honours known multi-part TLDs', () => {
    expect(normalizeCompanyDomain('john@team.acme.co.uk')).toBe('acme.co.uk');
    expect(normalizeCompanyDomain('acme.co.in')).toBe('acme.co.in');
  });

  it('does NOT treat different TLDs as equal', () => {
    expect(isSameCompanyDomain('acme.com', 'acme.in')).toBe(false);
    expect(isSameCompanyDomain('acme.com', 'acme.net')).toBe(false);
    expect(isSameCompanyDomain('acme.com', 'acme.org')).toBe(false);
  });

  it('treats www / scheme / email variants as equal', () => {
    expect(isSameCompanyDomain('john@acme.com', 'https://www.acme.com')).toBe(true);
    expect(isSameCompanyDomain('acme.com', 'www.acme.com')).toBe(true);
  });

  it('returns empty for junk input', () => {
    expect(normalizeCompanyDomain('')).toBe('');
    expect(normalizeCompanyDomain('notadomain')).toBe('');
    expect(normalizeCompanyDomain(null)).toBe('');
  });
});

// ── 2. validateCompanyIdentity decision flow (Phase 2) ──────────────────────────

describe('validateCompanyIdentity — authoritative verdict', () => {
  it('ALLOWS a work email whose domain hosts a live canonical site', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps());
    expect(id.eligible).toBe(true);
    expect(id.validationReason).toBeNull();
    expect(id.requiresManualReview).toBe(false);
    expect(id.companyIdentityDomain).toBe('acme.com');
    expect(id.websiteUrl).toBe('https://www.acme.com');
    // Derived website always matches the email domain (rule 4 holds by construction).
    expect(id.normalizedWebsiteDomain).toBe(id.normalizedEmailDomain);
  });

  it('derives website from the registrable root for subdomain emails (audit-bug fix)', async () => {
    const id = await validateCompanyIdentity('john@careers.acme.com', deps());
    expect(id.eligible).toBe(true);
    expect(id.websiteUrl).toBe('https://www.acme.com');
    expect(id.companyIdentityDomain).toBe('acme.com');
  });

  it('BLOCKS personal/free email (PUBLIC_EMAIL), no review', async () => {
    const id = await validateCompanyIdentity('john@gmail.com', deps({
      checkEligibility: async () => ({ result: 'PUBLIC_EMAIL', eligible: false }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('PUBLIC_EMAIL');
    expect(id.requiresManualReview).toBe(false);
  });

  const PROBE_FAILED = (d: string): ResolveDomainResult => ({
    input_domain: d, final_domain: d, redirect_chain: [], is_forwarding: false,
    resolution_failed: true,
  });

  it('HARD-REJECTS a domain with no website (definitive: no DNS records) → NO_WEBSITE_FOUND', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => PROBE_FAILED(d),
      classifyDomainDns: async () => 'no_records',
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('NO_WEBSITE_FOUND');
    // Bible: definitive no-website is a HARD reject, not a review dead-end.
    expect(id.requiresManualReview).toBe(false);
  });

  it('AUTO-APPROVABLE review when the web host resolves but the site was unreachable (never rejects)', async () => {
    // DNS knows the web host (has_records) + MX proven by eligibility, only the
    // website was unreachable from our egress → routed to review AND flagged
    // auto-approvable (§6). Must NOT be a hard reject and must NOT throw.
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => PROBE_FAILED(d),
      classifyDomainDns: async () => 'has_records',
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('NO_WEBSITE_FOUND');
    expect(id.requiresManualReview).toBe(true);
    expect(id.autoApprovable).toBe(true);
  });

  it('AUTO-APPROVABLE when only MX/NS exist (registered_no_web) — MX proven by eligibility ⇒ real org', async () => {
    // MX was proven by the eligibility stage, so a domain that publishes MX/NS
    // but whose web host we could not resolve from our egress is still a real,
    // active organisation. It must NOT be hard-rejected (PROD-CX-004 §6).
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => PROBE_FAILED(d),
      classifyDomainDns: async () => 'registered_no_web',
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('NO_WEBSITE_FOUND');
    expect(id.requiresManualReview).toBe(true);
    expect(id.autoApprovable).toBe(true);
  });

  it('does NOT reject on a transient DNS failure → "try again" (throws)', async () => {
    await expect(
      validateCompanyIdentity('john@acme.com', deps({
        probeWebsite: async (d) => PROBE_FAILED(d),
        classifyDomainDns: async () => 'transient',
      })),
    ).rejects.toThrow(/WEBSITE_PROBE_TRANSIENT/);
  });

  it('routes a cross-domain redirect to DOMAIN_NOT_CANONICAL (review)', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async () => ({
        input_domain: 'acme.com', final_domain: 'acmecorp.io',
        redirect_chain: [], is_forwarding: true,
      }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('DOMAIN_NOT_CANONICAL');
    expect(id.requiresManualReview).toBe(true);
  });

  it('routes a web-forwarding domain to FORWARDING_DOMAIN (review)', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => ({
        input_domain: d, final_domain: d, redirect_chain: [], is_forwarding: true,
      }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('FORWARDING_DOMAIN');
    expect(id.requiresManualReview).toBe(true);
  });

  it('hard-BLOCKS an SSRF/private-IP resolution (no review)', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => ({
        input_domain: d, final_domain: d, redirect_chain: [], is_forwarding: false,
        resolution_blocked: true,
      }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('BLOCKED');
    expect(id.requiresManualReview).toBe(false);
  });

  it('BLOCKS when the domain is already claimed (rule 5), surfaces the org', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      lookupClaimedCompany: async () => ({ id: 'co_1', name: 'Acme Inc' }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('CLAIMED_DOMAIN');
    expect(id.existingCompany).toEqual({ id: 'co_1', name: 'Acme Inc' });
    expect(id.requiresManualReview).toBe(false);
  });

  it('does not probe the website when the domain is already claimed', async () => {
    let probed = false;
    await validateCompanyIdentity('john@acme.com', deps({
      lookupClaimedCompany: async () => ({ id: 'co_1', name: 'Acme Inc' }),
      probeWebsite: async (d) => { probed = true; return LIVE_CANONICAL(d); },
    }));
    expect(probed).toBe(false);
  });

  it('BLOCKS malformed email with no domain', async () => {
    const id = await validateCompanyIdentity('notanemail', deps());
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('BLOCKED');
  });
});
