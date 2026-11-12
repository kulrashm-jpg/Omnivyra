/**
 * e1 (2026-11-12): findMatchingCompany reports WHAT proves a match (evidence) so callers disclose only
 * on a verified email-domain match, and its name match is EXACT (case-insensitive) - the former
 * first-word `%word%` fallback is gone. The fake models PostgREST (`*` -> `%`) and SQL ILIKE.
 */
export {};
type Row = Record<string, any>;
function ilikeMatch(value: string, pattern: string): boolean {
  const p = pattern.replace(/\*/g, '%');
  let re = '^';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) { re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%') re += '.*'; else if (c === '_') re += '.'; else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(value);
}
const mockCompanies: Row[] = [];
function mockTable() {
  const tests: Array<(r: Row) => boolean> = []; let cap = Infinity;
  const b: any = {
    select: () => b,
    limit: (n: number) => { cap = n; return b; },
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    ilike: (c: string, v: string) => { tests.push((r) => ilikeMatch(String(r[c] ?? ''), v)); return b; },
    then: (ok: any, ko: any) => Promise.resolve({ data: mockCompanies.filter((r) => tests.every((t) => t(r))).slice(0, cap), error: null }).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => mockTable() }));
/* eslint-disable @typescript-eslint/no-var-requires */
const { findMatchingCompany } = require('../../services/companyMatchService');
/* eslint-enable @typescript-eslint/no-var-requires */
beforeEach(() => {
  mockCompanies.length = 0;
  mockCompanies.push(
    { id: 'c-acme', name: 'Acme Corporation', status: 'active', website_domain: 'acme.com', admin_email_domain: 'acme.com' },
    { id: 'c-zeta', name: 'Zeta Labs', status: 'active', website_domain: 'zeta.io', admin_email_domain: null },
  );
});

it('the verified corporate email domain -> evidence verified_email_domain', async () => {
  const m = await findMatchingCompany({ companyName: 'x', userEmail: 'p@acme.com' });
  expect(m).toMatchObject({ company_id: 'c-acme', evidence: 'verified_email_domain' });
});
it('a TYPED website that is not the user email domain -> evidence entered_website', async () => {
  const m = await findMatchingCompany({ companyName: 'x', website: 'https://zeta.io', userEmail: 'p@acme.com' });
  expect(m).toMatchObject({ company_id: 'c-zeta', evidence: 'entered_website' });
});
it('a typed website that IS the user email domain -> verified', async () => {
  const m = await findMatchingCompany({ companyName: 'x', website: 'https://acme.com', userEmail: 'p@acme.com' });
  expect(m).toMatchObject({ company_id: 'c-acme', evidence: 'verified_email_domain' });
});
it('the exact name (any case) matches with evidence name', async () => {
  const m = await findMatchingCompany({ companyName: 'zeta labs', userEmail: 'p@gmail.com' });
  expect(m).toMatchObject({ company_id: 'c-zeta', evidence: 'name' });
});
it('a first word, prefix or wildcard probe never matches a name', async () => {
  for (const probe of ['Acme', 'Zeta', 'Acme%', 'Acme*', 'Zeta_Labs', '%Labs', 'Acme Corporation Ltd']) {
    const m = await findMatchingCompany({ companyName: probe, userEmail: 'p@gmail.com' });
    expect([probe, m]).toEqual([probe, null]);
  }
});
