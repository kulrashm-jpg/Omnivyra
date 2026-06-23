/**
 * Phase 11A — canonical company identity writer guard tests.
 */

import {
  prepareCompanyIdentityWrite,
  createCompanyIdentity,
  updateCompanyIdentity,
  CompanyIdentityInvariantError,
} from '../../services/companyIdentityWriter';

describe('prepareCompanyIdentityWrite — invariants A/B/C/D', () => {
  it('PASS: website + website_domain (both set, consistent)', () => {
    const cols = prepareCompanyIdentityWrite({
      website: 'https://www.acme.com', websiteDomain: 'acme.com', adminEmailDomain: 'acme.com',
    });
    expect(cols).toEqual({ website: 'https://www.acme.com', website_domain: 'acme.com', admin_email_domain: 'acme.com' });
  });

  it('PASS: website NULL + website_domain NULL', () => {
    const cols = prepareCompanyIdentityWrite({ website: null, websiteDomain: null });
    expect(cols).toEqual({ website: null, website_domain: null, admin_email_domain: null });
  });

  it('PASS: empty strings are treated as NULL (both empty → ok)', () => {
    const cols = prepareCompanyIdentityWrite({ website: '   ', websiteDomain: '' });
    expect(cols).toEqual({ website: null, website_domain: null, admin_email_domain: null });
  });

  it('FAIL: website set + website_domain NULL (Invariant B/D)', () => {
    expect(() => prepareCompanyIdentityWrite({ website: 'https://www.acme.com', websiteDomain: null }))
      .toThrow(CompanyIdentityInvariantError);
  });

  it('FAIL: website_domain set + website NULL (Invariant A/D)', () => {
    expect(() => prepareCompanyIdentityWrite({ website: null, websiteDomain: 'acme.com' }))
      .toThrow(CompanyIdentityInvariantError);
  });

  it('Invariant C: normalizes website_domain (strips www/scheme/subdomain)', () => {
    const cols = prepareCompanyIdentityWrite({ website: 'https://www.acme.com', websiteDomain: 'https://www.acme.com' });
    expect(cols.website_domain).toBe('acme.com');
  });

  it('Invariant C: rejects an unparseable website_domain', () => {
    expect(() => prepareCompanyIdentityWrite({ website: 'https://www.acme.com', websiteDomain: 'not-a-domain' }))
      .toThrow(CompanyIdentityInvariantError);
  });

  it('normalizes admin_email_domain independently (not part of the pair)', () => {
    const cols = prepareCompanyIdentityWrite({ website: null, websiteDomain: null, adminEmailDomain: 'mail.acme.com' });
    expect(cols.admin_email_domain).toBe('acme.com');
  });
});

describe('createCompanyIdentity — governs columns, rejects partial', () => {
  it('inserts governed identity columns + passes through the rest', async () => {
    let written: Record<string, unknown> | null = null;
    const out = await createCompanyIdentity(
      { name: 'Acme', status: 'active', website: 'https://www.acme.com', websiteDomain: 'acme.com', adminEmailDomain: 'acme.com' },
      { insertCompany: async (rec) => { written = rec; return { id: 'co_1' }; } },
    );
    expect(out).toEqual({ id: 'co_1' });
    expect(written).toMatchObject({ name: 'Acme', status: 'active', website: 'https://www.acme.com', website_domain: 'acme.com', admin_email_domain: 'acme.com' });
    // camelCase inputs must not leak as columns
    expect(written).not.toHaveProperty('websiteDomain');
    expect(written).not.toHaveProperty('adminEmailDomain');
  });

  it('throws and does NOT write on a partial identity', async () => {
    let called = false;
    await expect(createCompanyIdentity(
      { name: 'Acme', website: 'https://www.acme.com', websiteDomain: null },
      { insertCompany: async () => { called = true; return { id: 'x' }; } },
    )).rejects.toThrow(CompanyIdentityInvariantError);
    expect(called).toBe(false);
  });
});

describe('updateCompanyIdentity — atomic triple', () => {
  it('updates all three governed columns', async () => {
    let patch: Record<string, unknown> | null = null;
    await updateCompanyIdentity('co_1', { website: 'https://www.acme.com', websiteDomain: 'acme.com', adminEmailDomain: 'acme.com' },
      { updateCompany: async (_id, p) => { patch = p; } });
    expect(patch).toEqual({ website: 'https://www.acme.com', website_domain: 'acme.com', admin_email_domain: 'acme.com' });
  });

  it('rejects a partial update without writing', async () => {
    let called = false;
    await expect(updateCompanyIdentity('co_1', { website: null, websiteDomain: 'acme.com' },
      { updateCompany: async () => { called = true; } })).rejects.toThrow(CompanyIdentityInvariantError);
    expect(called).toBe(false);
  });

  it('requires a companyId', async () => {
    await expect(updateCompanyIdentity('', { website: null, websiteDomain: null })).rejects.toThrow(CompanyIdentityInvariantError);
  });
});
