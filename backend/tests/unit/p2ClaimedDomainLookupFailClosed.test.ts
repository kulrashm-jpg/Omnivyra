/**
 * P2 (e1, 2026-11-13). resolveClaimedDomainRefusal is signup's ONLY claimed-domain check before the intent is
 * minted (rule 5 is disabled inside the identity gate). It used to (a) discard both read errors - a transient error
 * read as "unclaimed" - and (b) match only the raw email host, so jane@bot1.example.com passed when example.com was
 * claimed. Now it matches raw host AND registrable domain, any match is claimed (oldest first), and a read error
 * throws (callers answer a retryable 503).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockFailCompanies = false;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let lim = Infinity; let order: string | null = null;
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    order: (c: string) => { order = c; return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    insert: () => b, update: () => b,
    then: (ok: any, ko: any) => {
      if (table === 'companies' && mockFailCompanies) return Promise.resolve({ data: null, error: { message: 'transient' } }).then(ok, ko);
      let hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      if (order) hit = hit.sort((x, y) => String(x[order!]).localeCompare(String(y[order!])));
      hit = hit.slice(0, lim);
      if (one && hit.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(ok, ko);
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/claimedDomainNotifyService', () => ({ notifyAdminAndProspectOfClaimedDomain: jest.fn(async () => ({})) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
/* eslint-disable @typescript-eslint/no-var-requires */
const { resolveClaimedDomainRefusal, ClaimedDomainLookupError } = require('../../services/signupIntentMint');
/* eslint-enable @typescript-eslint/no-var-requires */
const call = (email: string) => resolveClaimedDomainRefusal({ normalizedEmail: email, domain: email.split('@')[1], correlationId: 'c' });
beforeEach(() => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockFailCompanies = false; });

it('a SUBDOMAIN signup is refused when the registrable domain is claimed (bot1.example.com vs example.com)', async () => {
  mockDb.companies = [{ id: 'co-ex', name: 'Example', website_domain: 'example.com', created_at: '1' }];
  expect(await call('jane@bot1.example.com')).toMatchObject({ companyId: 'co-ex' });
});

it('the raw host is still matched (a company stored with a subdomain admin_email_domain)', async () => {
  mockDb.companies = [{ id: 'co-sub', name: 'Sub', admin_email_domain: 'mail.acme.com', created_at: '1' }];
  expect(await call('jane@mail.acme.com')).toMatchObject({ companyId: 'co-sub' });
});

it('TWO companies on the domain (the old maybeSingle errored and read "unclaimed") -> claimed by the OLDEST', async () => {
  mockDb.companies = [
    { id: 'co-new', name: 'N', website_domain: 'acme.com', created_at: '2' },
    { id: 'co-old', name: 'O', website_domain: 'acme.com', created_at: '1' },
  ];
  expect(await call('jane@acme.com')).toMatchObject({ companyId: 'co-old' });
});

it('a companies READ ERROR throws ClaimedDomainLookupError - never "unclaimed"', async () => {
  mockFailCompanies = true;
  await expect(call('jane@acme.com')).rejects.toBeInstanceOf(ClaimedDomainLookupError);
});

it('control: an unclaimed domain is null', async () => {
  mockDb.companies = [{ id: 'other', name: 'X', website_domain: 'other.com', created_at: '1' }];
  expect(await call('jane@acme.com')).toBeNull();
});
