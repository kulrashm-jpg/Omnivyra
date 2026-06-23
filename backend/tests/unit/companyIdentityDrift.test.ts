/**
 * Phase 7 — Company identity drift detection regression suite.
 */

import {
  checkCompanyIdentityDrift,
  monitorCompanyIdentityDrift,
  type CompanyIdentityInput,
} from '../../services/companyIdentityDriftService';

const company = (over: Partial<CompanyIdentityInput>): CompanyIdentityInput => ({
  id: 'co_1', name: 'Test Co', website: null, website_domain: null, admin_email_domain: null, ...over,
});

describe('checkCompanyIdentityDrift — spec cases', () => {
  it('PASS: drishiq.com / drishiq.com (consistent) → no drift', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'drishiq.com', website_domain: 'drishiq.com', website: 'https://www.drishiq.com',
    }));
    expect(r.hasDrift).toBe(false);
    expect(r.driftReasons).toEqual([]);
  });

  it('PASS: afrost.org / afrost.org (consistent) → no drift', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'afrost.org', website_domain: 'afrost.org', website: 'https://www.afrost.org',
    }));
    expect(r.hasDrift).toBe(false);
  });

  it('DRIFT: embrosales.in / embrosales.com → DOMAIN_MISMATCH', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'embrosales.in', website_domain: 'embrosales.com', website: 'https://www.embrosales.com',
    }));
    expect(r.hasDrift).toBe(true);
    expect(r.driftReasons).toContain('DOMAIN_MISMATCH');
  });

  it('DRIFT: infitoo.com / NULL → MISSING_WEBSITE_DOMAIN', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'infitoo.com', website_domain: null, website: 'https://www.infitoo.com',
    }));
    expect(r.hasDrift).toBe(true);
    expect(r.driftReasons).toContain('MISSING_WEBSITE_DOMAIN');
  });

  it('DRIFT: NULL / afrost.org → MISSING_ADMIN_EMAIL_DOMAIN', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: null, website_domain: 'afrost.org', website: 'https://www.afrost.org',
    }));
    expect(r.hasDrift).toBe(true);
    expect(r.driftReasons).toContain('MISSING_ADMIN_EMAIL_DOMAIN');
  });
});

describe('checkCompanyIdentityDrift — additional coverage', () => {
  it('normalizes www / subdomain before comparing (no false mismatch)', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'mail.acme.com', website_domain: 'www.acme.com', website: 'https://www.acme.com',
    }));
    expect(r.driftReasons).not.toContain('DOMAIN_MISMATCH');
  });

  it('flags MISSING_WEBSITE for a UUID placeholder website', () => {
    const r = checkCompanyIdentityDrift(company({
      id: 'co_1', admin_email_domain: 'acme.com', website_domain: 'acme.com',
      website: '4dae7f7a-b518-4557-b8cb-5c6123ff9658',
    }));
    expect(r.driftReasons).toContain('MISSING_WEBSITE');
  });

  it('flags INVALID_WEBSITE_DOMAIN for unparseable website_domain', () => {
    const r = checkCompanyIdentityDrift(company({
      admin_email_domain: 'acme.com', website_domain: 'not-a-domain', website: 'https://www.acme.com',
    }));
    expect(r.driftReasons).toContain('INVALID_WEBSITE_DOMAIN');
  });

  it('MISSING_BOTH-style: all three null → three missing reasons', () => {
    const r = checkCompanyIdentityDrift(company({}));
    expect(r.driftReasons).toEqual(expect.arrayContaining([
      'MISSING_ADMIN_EMAIL_DOMAIN', 'MISSING_WEBSITE_DOMAIN', 'MISSING_WEBSITE',
    ]));
    expect(r.hasDrift).toBe(true);
  });

  it('returns the full payload shape', () => {
    const r = checkCompanyIdentityDrift(company({ id: 'co_9', name: 'Acme', admin_email_domain: 'acme.com', website_domain: 'acme.com', website: 'https://www.acme.com' }));
    expect(r).toMatchObject({
      hasDrift: false, companyId: 'co_9', companyName: 'Acme',
      adminEmailDomain: 'acme.com', websiteDomain: 'acme.com', website: 'https://www.acme.com', driftReasons: [],
    });
  });
});

describe('monitorCompanyIdentityDrift — telemetry, never throws', () => {
  it('emits only on drift and returns the result', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const clean = monitorCompanyIdentityDrift(company({ admin_email_domain: 'acme.com', website_domain: 'acme.com', website: 'https://www.acme.com' }));
      expect(clean?.hasDrift).toBe(false);
      const before = warn.mock.calls.length;
      const drift = monitorCompanyIdentityDrift(company({ admin_email_domain: 'acme.com', website_domain: 'other.com', website: 'https://www.other.com' }));
      expect(drift?.hasDrift).toBe(true);
      expect(warn.mock.calls.length).toBeGreaterThan(before); // warned on drift
    } finally {
      warn.mockRestore();
    }
  });

  it('never throws on malformed input', () => {
    expect(() => monitorCompanyIdentityDrift({} as any)).not.toThrow();
    expect(() => monitorCompanyIdentityDrift({ website: 123 } as any)).not.toThrow();
  });
});
