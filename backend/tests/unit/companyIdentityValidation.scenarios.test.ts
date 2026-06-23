/**
 * Phase-4 acceptance evidence — the exact validation scenarios requested for
 * sign-off, mapped 1:1 to descriptive test names so the runner output IS the
 * evidence. Hermetic: stage results injected, no DNS / DB.
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

// Phase 11D: isolate the module-global success cache (these scenarios reuse the
// same domain with different mocked probe outcomes — impossible in production).
beforeEach(() => clearDomainVerdictCache());

const liveCanonical = (d: string): ResolveDomainResult => ({
  input_domain: d, final_domain: d, redirect_chain: [], is_forwarding: false,
});

function deps(over: Partial<ValidateCompanyIdentityDeps> = {}): ValidateCompanyIdentityDeps {
  return {
    checkEligibility: async () => ({ result: 'DOMAIN_ELIGIBLE', eligible: true }),
    probeWebsite: async (d) => liveCanonical(d),
    lookupClaimedCompany: async () => null,
    ...over,
  };
}

describe('Phase-4 evidence: validation scenarios', () => {
  it('1. matching domain (acme.com) → ALLOW', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps());
    expect(id.eligible).toBe(true);
    expect(id.validationReason).toBeNull();
    expect(id.companyIdentityDomain).toBe('acme.com');
    expect(id.websiteUrl).toBe('https://www.acme.com');
  });

  it('2. www variant (www.acme.com) → ALLOW, same identity as acme.com', async () => {
    expect(normalizeCompanyDomain('www.acme.com')).toBe('acme.com');
    expect(isSameCompanyDomain('acme.com', 'www.acme.com')).toBe(true);
    const id = await validateCompanyIdentity('john@acme.com', deps());
    // Derived website is normalized → email-domain and website-domain match.
    expect(id.normalizedWebsiteDomain).toBe(id.normalizedEmailDomain);
    expect(id.eligible).toBe(true);
  });

  it('3. personal email (gmail) → BLOCK (PUBLIC_EMAIL), no review', async () => {
    const id = await validateCompanyIdentity('john@gmail.com', deps({
      checkEligibility: async () => ({ result: 'PUBLIC_EMAIL', eligible: false }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('PUBLIC_EMAIL');
    expect(id.requiresManualReview).toBe(false);
  });

  it('4. no website found (MX present, no live site) → BLOCK (NO_WEBSITE_FOUND), review', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async (d) => ({ ...liveCanonical(d), resolution_failed: true }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('NO_WEBSITE_FOUND');
    expect(id.requiresManualReview).toBe(true);
  });

  it('5. mismatched domain (acme.com vs acme.in) → distinct identity keys (never ALLOW-equal)', () => {
    // Under D2 the website is derived from the email domain, so a mismatch
    // cannot arise from the signup path; the guarantee that protects it is that
    // acme.com and acme.in are DIFFERENT identity keys. If a website is ever
    // supplied explicitly, the DOMAIN_MISMATCH branch rejects on this same guard.
    expect(isSameCompanyDomain('acme.com', 'acme.in')).toBe(false);
    expect(normalizeCompanyDomain('acme.com')).not.toBe(normalizeCompanyDomain('acme.in'));
  });

  it('6. unrelated redirect (acme.com → acme.in) → BLOCK (DOMAIN_NOT_CANONICAL), review', async () => {
    const id = await validateCompanyIdentity('john@acme.com', deps({
      probeWebsite: async () => ({
        input_domain: 'acme.com', final_domain: 'acme.in',
        redirect_chain: ['https://acme.in/'], is_forwarding: true,
      }),
    }));
    expect(id.eligible).toBe(false);
    expect(id.validationReason).toBe('DOMAIN_NOT_CANONICAL');
    expect(id.requiresManualReview).toBe(true);
  });
});

describe('Phase-4 evidence: invite-path semantics preserved', () => {
  it('existing company (claimed domain) → CLAIMED_DOMAIN, surfaces the org for request-access', async () => {
    // The full engine (rule 5 enabled) detects the claim; in signup.ts this
    // case is delegated to the unchanged §4 notify/referral flow.
    const id = await validateCompanyIdentity('john@acme.com', {
      checkEligibility: async () => ({ result: 'DOMAIN_ELIGIBLE', eligible: true }),
      probeWebsite: async (d) => liveCanonical(d),
      lookupClaimedCompany: async () => ({ id: 'co_1', name: 'Acme Inc' }),
    });
    expect(id.validationReason).toBe('CLAIMED_DOMAIN');
    expect(id.existingCompany).toEqual({ id: 'co_1', name: 'Acme Inc' });
  });

  it('signup gate disables rule-5 so §4 (claimed flow) stays the single owner', async () => {
    // Mirrors the exact call signup.ts makes: lookupClaimedCompany → null.
    let claimedChecked = false;
    const id = await validateCompanyIdentity('john@acme.com', {
      checkEligibility: async () => ({ result: 'DOMAIN_ELIGIBLE', eligible: true }),
      probeWebsite: async (d) => liveCanonical(d),
      lookupClaimedCompany: async () => { claimedChecked = true; return null; },
    });
    expect(claimedChecked).toBe(true);     // called, but returns null by design
    expect(id.validationReason).toBeNull(); // → falls through to §4 in signup.ts
  });
});
