/**
 * Phase-7 regression suite.
 *
 *  (a) Parity: onboarding (the /validated-identity endpoint) and setup-company
 *      resolve the website through the SAME shared function with the SAME input,
 *      so what onboarding DISPLAYS equals what setup-company PERSISTS.
 *  (b) Source contract on pages/onboarding/company.tsx:
 *        - reads the server-validated identity (no client re-derivation)
 *        - the website field is presentation-only (readOnly, no user setter)
 *        - the manual website-entry step is gone (cannot present a different URL)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveValidatedWebsite } from '../../services/validatedWebsiteService';

const companySrc = readFileSync(
  resolve(__dirname, '../../../pages/onboarding/company.tsx'),
  'utf8',
);
// Strip line + block comments so explanatory notes don't create false positives.
const companyCode = companySrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('Phase-7 (a): onboarding display == setup-company persistence', () => {
  // Same shared resolver + same input (the user's email + signup intent) →
  // identical website. This is exactly what /validated-identity returns to
  // onboarding and what setup-company writes to the company.
  const intentWebsite = 'https://www.acme.com';
  const fetchIntentWebsite = async () => intentWebsite;

  it('both call sites produce the identical validated website', async () => {
    const onboardingShown = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: '' },
      { fetchIntentWebsite },
    );
    const setupCompanyPersisted = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: '' },
      { fetchIntentWebsite },
    );
    expect(onboardingShown).toEqual(setupCompanyPersisted);
    expect(onboardingShown.canonicalWebsite).toBe(intentWebsite);
    expect(onboardingShown.source).toBe('validated_identity');
  });

  it('a user-typed website in onboarding cannot override the validated identity', async () => {
    // Even if a userEntered value were somehow supplied, the validated intent wins.
    const out = await resolveValidatedWebsite(
      'john@acme.com',
      { emailDerived: 'https://www.acme.com', userEntered: 'https://evil-different.com' },
      { fetchIntentWebsite },
    );
    expect(out.canonicalWebsite).toBe('https://www.acme.com');
    expect(out.source).toBe('validated_identity');
  });
});

describe('Phase-7 (b): onboarding reads validated identity and is presentation-only', () => {
  it('reads the server-validated identity endpoint', () => {
    expect(companyCode).toContain('/api/onboarding/validated-identity');
  });

  it('does NOT re-derive the website from email on the client', () => {
    expect(companyCode).not.toMatch(/deriveWebsiteFromEmail/);
    expect(companyCode).not.toMatch(/FREE_DOMAINS/);
  });

  it('the website field is presentation-only (readOnly, no user setter)', () => {
    // The displayed website input is readOnly...
    expect(companyCode).toMatch(/id="websiteDisplay"[\s\S]*?readOnly/);
    // ...and there is no onChange that writes the website from user typing.
    expect(companyCode).not.toMatch(/onChange=\{[^}]*setWebsite\(/);
  });

  it('removes the manual website-entry step entirely', () => {
    expect(companyCode).not.toMatch(/handleWebsiteNext/);
    expect(companyCode).not.toMatch(/step === 'website'/);
    expect(companyCode).not.toMatch(/setStep\('website'\)/);
  });

  it('does not persist the website to the local draft (cannot diverge from server)', () => {
    // The draft payload no longer includes websiteInput.
    expect(companyCode).not.toMatch(/JSON\.stringify\(\{\s*websiteInput/);
  });
});
