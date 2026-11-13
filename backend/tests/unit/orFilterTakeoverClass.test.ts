/**
 * BLOCKING fast-track (e1, 2026-11-13; e9 ruling, 05 review) - the interpolated PostgREST `.or()` class.
 *  1. defaultLookupClaimedCompany: TWO matching active companies made `.or().maybeSingle()` error; the error was
 *     dropped and the domain reported "not claimed" (gate bypass). Now structural `.eq()` reads; any match is
 *     CLAIMED; any read error THROWS (signup answers a retryable 503 - fail closed, never "not claimed").
 *  2. team/accept-invite: the caller's email was interpolated into `.or()` (takeover shape). Now two `.eq()` reads;
 *     a quoted local part with a comma can never add filter terms.
 *  3. super-admin free-credit request search: the term is a quoted, LIKE-escaped filter value.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockCalls: Array<{ table: string; op: string; args: unknown[] }> = [];
let mockFailTable: string | null = null;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let lim = Infinity;
  const b: any = {
    select: () => b, order: () => b, range: () => b,
    eq: (c: string, v: unknown) => { mockCalls.push({ table, op: 'eq', args: [c, v] }); tests.push((r) => r[c] === v); return b; },
    or: (f: string) => { mockCalls.push({ table, op: 'or', args: [f] }); return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    update: () => b, insert: () => b,
    then: (ok: any, ko: any) => {
      if (mockFailTable === table) return Promise.resolve({ data: null, error: { message: 'transient' } }).then(ok, ko);
      const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))).slice(0, lim);
      if (one && hit.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'multiple rows' } }).then(ok, ko);
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
/* eslint-disable @typescript-eslint/no-var-requires */
const { validateCompanyIdentity } = require('../../services/companyIdentityValidationService');
/* eslint-enable @typescript-eslint/no-var-requires */
beforeEach(() => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockCalls.length = 0; mockFailTable = null; });

const deps = {
  // reach rule 5 without network: no cache, and the probe must never be needed when the domain is claimed
  cacheGet: () => null, cacheSet: () => undefined,
  // the domain-eligibility stage is not under test here (it has its own suites): eligible, so rule 5 is reached
  checkEligibility: async () => ({ result: 'ELIGIBLE', eligible: true }),
  classifyDomainDns: async () => 'resolves',
  probeWebsite: async () => { throw new Error('probe must not run for a claimed domain'); },
};

// NOTE (05/e9 review): defaultLookupClaimedCompany has NO production caller today - signup passes
// lookupClaimedCompany: async () => null and owns the claimed check itself in §4. The LIVE signup gate is
// resolveClaimedDomainRefusal (P2, fix/p2-signup-20261113), pinned by p2ClaimedDomainLookupFailClosed.test.ts.
// These tests keep the library default fail-closed for any future caller; they are NOT evidence about signup.
describe('claimed-domain library default (defaultLookupClaimedCompany - not on the signup path)', () => {
  it('TWO active companies on the domain (one by website, one by admin email) -> CLAIMED, never "not claimed"', async () => {
    mockDb.companies = [
      { id: 'c-web', name: 'Web', status: 'active', website_domain: 'acme.com', admin_email_domain: 'other.com', created_at: '1' },
      { id: 'c-mail', name: 'Mail', status: 'active', website_domain: 'x.com', admin_email_domain: 'acme.com', created_at: '2' },
    ];
    const r = await validateCompanyIdentity('jane@acme.com', deps);
    expect(r).toMatchObject({ eligible: false, validationReason: 'CLAIMED_DOMAIN' });
    expect(mockCalls.filter((c) => c.op === 'or')).toEqual([]);
  });

  it('two companies with the SAME website_domain (duplicate) -> CLAIMED (the old maybeSingle errored and passed)', async () => {
    mockDb.companies = [
      { id: 'a1', name: 'A1', status: 'active', website_domain: 'acme.com', created_at: '1' },
      { id: 'a2', name: 'A2', status: 'active', website_domain: 'acme.com', created_at: '2' },
    ];
    const r = await validateCompanyIdentity('jane@acme.com', deps);
    expect(r).toMatchObject({ eligible: false, validationReason: 'CLAIMED_DOMAIN', existingCompany: { id: 'a1' } });
  });

  it('a companies READ ERROR throws (retryable at the caller) - never "not claimed"', async () => {
    mockFailTable = 'companies';
    await expect(validateCompanyIdentity('jane@acme.com', deps)).rejects.toThrow(/CLAIMED_DOMAIN_LOOKUP_FAILED/);
  });

  it('control: an inactive company does not claim the domain (status filter kept)', async () => {
    mockDb.companies = [{ id: 'old', name: 'Old', status: 'inactive', website_domain: 'acme.com', created_at: '1' }];
    await expect(validateCompanyIdentity('jane@acme.com', deps)).rejects.toThrow(/probe must not run/);
  });
});

describe('team/accept-invite resolves the caller structurally', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { createHash } = require('crypto');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const TOKEN = 'invite-token-123456';
  const CRAFTED = '"a,supabase_uid.eq.sb-victim"@acme.com';
  let route: any;
  beforeAll(() => {
    jest.doMock('../../services/authResolver', () => ({
      resolveAuthenticatedUser: async () => ({ user: { supabaseUid: 'sb-attacker', email: CRAFTED }, error: null }),
    }));
    jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
    jest.doMock('../../services/auditActorService', () => ({ insertAuditLogStrict: jest.fn(async () => undefined), SYSTEM_USER_ID: 'sys' }));
    route = require('../../../pages/api/team/accept-invite').default;
  });
  const call = async () => {
    const res: any = { statusCode: 0, body: null };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (x: unknown) => { res.body = x; return res; };
    await route({ method: 'POST', headers: {}, body: { token: TOKEN } }, res);
    return res;
  };
  const seedInvitation = () => {
    mockDb.invitations = [{
      id: 'inv-1', email: CRAFTED, company_id: 'co-1', role: 'CONTENT_CREATOR',
      token_hash: createHash('sha256').update(TOKEN).digest('hex'),
      accepted_at: null, revoked_at: null, expires_at: new Date(Date.now() + 86400_000).toISOString(),
    }];
  };

  it('a quoted local part with a comma NEVER reaches a filter string and never resolves another user', async () => {
    seedInvitation();
    mockDb.users = [{ id: 'u-victim', supabase_uid: 'sb-victim', email: 'victim@acme.com', status: 'active' }];
    const r = await call();
    expect(mockCalls.filter((c) => c.table === 'users' && c.op === 'or')).toEqual([]);
    expect(mockCalls.filter((c) => c.table === 'users' && c.op === 'eq')).toEqual([
      { table: 'users', op: 'eq', args: ['supabase_uid', 'sb-attacker'] },
      { table: 'users', op: 'eq', args: ['email', CRAFTED.toLowerCase()] },
    ]);
    expect(r.statusCode).toBe(401); // no row for the crafted identity - the victim row is never selected
  });

  it('a users READ ERROR fails closed with a retryable 503', async () => {
    seedInvitation();
    mockFailTable = 'users';
    expect((await call()).statusCode).toBe(503);
  });
});

// The super-admin search filter is asserted by CAPTURE in orFilterThirdSiteAndSearch.test.ts (replaces the source-text pin).

