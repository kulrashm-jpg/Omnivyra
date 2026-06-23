/**
 * Phase-8 regression guard for setup-company.
 *
 *  (a) Behavioural: the company-creation website is resolved by CONSUMING the
 *      identity validated at signup — with NO domain-validation call.
 *  (b) Source contract: the setup-company route no longer imports or invokes any
 *      legitimacy validator, so it can never again emit NO_WEBSITE_FOUND /
 *      DOMAIN_NOT_CANONICAL / FORWARDING_DOMAIN / DOMAIN_RESOLUTION_FAILED.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveValidatedWebsite } from '../../services/validatedWebsiteService';

describe('Phase-8: setup-company consumes the validated signup identity', () => {
  it('uses the website validated at signup, performing NO domain validation', async () => {
    let probeCalls = 0;
    const out = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: '' },
      {
        fetchIntentWebsite: async () => {
          probeCalls += 1;            // the ONLY lookup — a plain intent read
          return 'https://www.acme.com';
        },
      },
    );
    expect(out.canonicalWebsite).toBe('https://www.acme.com');
    expect(out.source).toBe('validated_identity');
    expect(probeCalls).toBe(1);       // one intent read, zero domain probes
  });

  it('falls back to the pure email-derived value when no intent exists (still no probe)', async () => {
    const out = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: '' },
      { fetchIntentWebsite: async () => null },
    );
    expect(out.canonicalWebsite).toBe('https://www.acme.com');
    expect(out.source).toBe('email_derived');
  });

  it('falls back to user-entered value for public-email/no-derivation paths', async () => {
    const out = await resolveValidatedWebsite(
      'someone@gmail.com',
      { emailDerived: null, userEntered: '  https://typed.example  ' },
      { fetchIntentWebsite: async () => null },
    );
    expect(out.canonicalWebsite).toBe('https://typed.example');
    expect(out.source).toBe('user_input');
  });

  it('never throws if the intent read fails (creation must not be blocked)', async () => {
    const out = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: '' },
      { fetchIntentWebsite: async () => { throw new Error('db down'); } },
    );
    expect(out.canonicalWebsite).toBe('https://www.acme.com');
    expect(out.source).toBe('email_derived');
  });
});

describe('Phase-8 source contract: no legitimacy validator remains', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../pages/api/onboarding/setup-company.ts'),
    'utf8',
  );
  // Strip line comments so the explanatory Phase-8 notes (which name the codes)
  // don't create false positives — we assert on executable code only.
  const code = src.replace(/^\s*\/\/.*$/gm, '');

  it('does not import any domain-validation service', () => {
    expect(code).not.toMatch(/domainCanonicalService/);
    expect(code).not.toMatch(/domainEligibilityService/);
    expect(code).not.toMatch(/domainEventLogger/);
    expect(code).not.toMatch(/from '\.\.\/\.\.\/\.\.\/lib\/auth\/rateLimit'/);
  });

  it('does not call resolveDomain / checkDomainEligibility / validatePublicWebsite', () => {
    expect(code).not.toMatch(/\bresolveDomain\s*\(/);
    expect(code).not.toMatch(/\bcheckDomainEligibility\s*\(/);
    expect(code).not.toMatch(/\bvalidatePublicWebsite\s*\(/);
  });

  it('can no longer emit the four legitimacy error codes', () => {
    for (const c of ['NO_WEBSITE_FOUND', 'DOMAIN_NOT_CANONICAL', 'FORWARDING_DOMAIN', 'DOMAIN_RESOLUTION_FAILED']) {
      expect(code).not.toContain(`'${c}'`);
      expect(code).not.toContain(`"${c}"`);
    }
  });
});
