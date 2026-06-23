/**
 * Phase 11C — setup-company adoption of companyIdentityWriter.
 *
 * Behavioral tests exercise the exact payload setup-company now passes to
 * createCompanyIdentity; source-contract tests lock in that the manual identity
 * construction is gone and the surrounding handler logic is preserved.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createCompanyIdentity, CompanyIdentityInvariantError } from '../../services/companyIdentityWriter';

const SETUP = readFileSync(resolve(__dirname, '../../../pages/api/onboarding/setup-company.ts'), 'utf8');
const CODE = SETUP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Mirrors the record setup-company builds at the insert site.
function setupCompanyRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'co_123', name: 'Drishiq',
    website: 'https://www.drishiq.com', websiteDomain: 'drishiq.com', adminEmailDomain: 'drishiq.com',
    industry: 'Technology', size: '2-10', status: 'active',
    domain_claimed_at: '2026-06-23T00:00:00Z', created_at: '2026-06-23T00:00:00Z',
    ...over,
  };
}

describe('Phase 11C — behavioral: identity flows through the writer', () => {
  it('1+4. successful creation: governed identity columns + passthrough unchanged', async () => {
    let written: Record<string, unknown> | null = null;
    const out = await createCompanyIdentity(setupCompanyRecord(), { insertCompany: async (r) => { written = r; return { id: 'co_123' }; } });
    expect(out).toEqual({ id: 'co_123' });
    expect(written).toMatchObject({
      id: 'co_123', name: 'Drishiq', industry: 'Technology', size: '2-10', status: 'active',
      domain_claimed_at: '2026-06-23T00:00:00Z', created_at: '2026-06-23T00:00:00Z',
      website: 'https://www.drishiq.com', website_domain: 'drishiq.com', admin_email_domain: 'drishiq.com',
    });
    // camelCase identity inputs must not leak as columns
    expect(written).not.toHaveProperty('websiteDomain');
    expect(written).not.toHaveProperty('adminEmailDomain');
  });

  it('dropped placeholder: empty canonicalWebsite → website NULL + website_domain NULL (consistent, no throw)', async () => {
    let written: Record<string, unknown> | null = null;
    await createCompanyIdentity(setupCompanyRecord({ website: null, websiteDomain: null, adminEmailDomain: 'drishiq.com' }),
      { insertCompany: async (r) => { written = r; return { id: 'co_123' }; } });
    expect(written).toMatchObject({ website: null, website_domain: null, admin_email_domain: 'drishiq.com' });
    // never the old UUID-as-website placeholder
    expect(written!.website).not.toBe('co_123');
  });

  it('5. writer invariants enforced: a partial pair throws and does NOT insert', async () => {
    let called = false;
    await expect(createCompanyIdentity(setupCompanyRecord({ website: 'https://www.drishiq.com', websiteDomain: null }),
      { insertCompany: async () => { called = true; return { id: 'x' }; } })).rejects.toThrow(CompanyIdentityInvariantError);
    expect(called).toBe(false);
  });

  it('3. race: insert error code (23505) propagates so the handler can recover', async () => {
    const err = await createCompanyIdentity(setupCompanyRecord(), {
      insertCompany: async () => { const e = new Error('duplicate') as Error & { code?: string }; e.code = '23505'; throw e; },
    }).catch((e) => e);
    expect((err as { code?: string }).code).toBe('23505');
  });
});

describe('Phase 11C — source contract on setup-company.ts', () => {
  it('imports + uses createCompanyIdentity from companyIdentityWriter', () => {
    expect(CODE).toMatch(/from '\.\.\/\.\.\/\.\.\/backend\/services\/companyIdentityWriter'/);
    expect(CODE).toMatch(/\bcreateCompanyIdentity\s*\(/);
  });

  it('5. no manual companies-identity construction (no companies.insert({ … website_domain: … }))', () => {
    expect(CODE).not.toMatch(/from\(['"]companies['"]\)[\s\S]{0,150}\.insert\(\{[\s\S]{0,600}(website_domain|admin_email_domain)\s*:/);
  });

  it('2+3. duplicate + race recovery preserved', () => {
    expect(CODE).toContain("companyErr?.code === '23505'");
    expect(CODE).toMatch(/companyExists:\s*true/);
    expect(CODE).toContain('if (companyErr) throw companyErr;');
  });

  it('credit / referral / role logic preserved', () => {
    expect(CODE).toMatch(/grantInitialFreeCredit/);
    expect(CODE).toMatch(/SELF_REGISTERED_JOIN_SOURCE/);
    expect(CODE).toMatch(/referral/i);
  });
});
