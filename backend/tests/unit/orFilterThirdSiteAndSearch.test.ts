/**
 * 05/e9 review of the .or() class (2026-11-13):
 *  - THIRD SITE: POST /api/company-profile's DOMAIN_ALREADY_REGISTERED check interpolated the user-supplied domain
 *    into one .or() filter AND discarded its read error (a failed read = "available", so a tenant could register a
 *    domain already registered to another company). Now two structural .eq() reads; a read error is a 503.
 *  - Super-admin request search: the FILTER the route actually sends is captured (replaces a source-text pin).
 */
const mockCalls: Array<{ table: string; op: string; args: unknown[] }> = [];
let mockCompaniesError: { message: string } | null = null;
let mockOwnerBy: { column: string; value: string } | null = null;
jest.mock('../../db/supabaseClient', () => {
  const make = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const b: any = {};
    for (const op of ['select', 'order', 'range', 'limit', 'neq', 'maybeSingle', 'single', 'update', 'insert', 'upsert']) {
      b[op] = (...args: unknown[]) => { mockCalls.push({ table, op, args }); return b; };
    }
    b.eq = (c: string, v: unknown) => { mockCalls.push({ table, op: 'eq', args: [c, v] }); filters.push([c, v]); return b; };
    b.or = (f: string) => { mockCalls.push({ table, op: 'or', args: [f] }); return b; };
    b.then = (ok: (v: unknown) => unknown) => {
      if (table === 'companies') {
        if (mockCompaniesError) return Promise.resolve({ data: null, error: mockCompaniesError }).then(ok);
        const hit = mockOwnerBy && filters.some(([c, v]) => c === mockOwnerBy!.column && v === mockOwnerBy!.value);
        return Promise.resolve({ data: hit ? [{ id: 'co-other' }] : [], error: null }).then(ok);
      }
      return Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
    };
    return b;
  };
  return { supabase: { from: (t: string) => make(t) } };
});
const mockSave = jest.fn(async (p: any) => p);
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => ({ company_id: 'co-me', website_url: null, report_settings: null })),
  saveProfile: (p: unknown) => mockSave(p),
  calculateCompanyProfileCompleteness: jest.fn(),
  toLimitedCompanyProfile: jest.fn(() => null),
  upsertCompanyProfileGovernanceSettings: jest.fn(() => ({})),
  getCompanyProfileReviewStatus: jest.fn(() => ({})),
}));
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn(async () => ({ userId: 'u-1', role: 'COMPANY_ADMIN' })),
  isContentArchitectSession: jest.fn(() => false),
}));
jest.mock('../../security/requireCapability', () => ({ requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: 'sa-1' } })) }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
export {};
const profileRoute = require('../../../pages/api/company-profile/index').default;
const searchRoute = require('../../../pages/api/super-admin/free-credits/requests').default;
/* eslint-enable @typescript-eslint/no-var-requires */

async function call(route: any, req: Record<string, unknown>) {
  const out = { code: 0, body: null as any };
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; }, setHeader: () => res, getHeader: () => undefined, end: () => res };
  await route({ headers: {}, cookies: {}, query: {}, body: {}, ...req }, res);
  return out;
}
const saveWebsite = () => call(profileRoute, { method: 'POST', query: { companyId: 'co-me' }, body: { companyId: 'co-me', website_url: 'https://taken-example.com' } });

beforeEach(() => { mockCalls.length = 0; mockCompaniesError = null; mockOwnerBy = null; mockSave.mockClear(); });

describe('company-profile DOMAIN_ALREADY_REGISTERED check', () => {
  it('a companies READ ERROR is a 503 DOMAIN_CHECK_UNAVAILABLE and NOTHING is saved (never "available")', async () => {
    mockCompaniesError = { message: 'connection reset' };
    const r = await saveWebsite();
    expect([r.code, r.body?.code]).toEqual([503, 'DOMAIN_CHECK_UNAVAILABLE']);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each(['website_domain', 'admin_email_domain'])('a domain owned via %s by ANOTHER company is refused 400', async (column) => {
    mockOwnerBy = { column, value: 'taken-example.com' };
    const r = await saveWebsite();
    expect([r.code, r.body?.code]).toEqual([400, 'DOMAIN_ALREADY_REGISTERED']);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('the domain reaches the DB only as an .eq() value - no .or() filter string is built from it', async () => {
    await saveWebsite();
    expect(mockCalls.filter((c) => c.table === 'companies' && c.op === 'or')).toEqual([]);
    expect(mockCalls.filter((c) => c.table === 'companies' && c.op === 'eq').map((c) => c.args)).toEqual([
      ['website_domain', 'taken-example.com'], ['admin_email_domain', 'taken-example.com'],
    ]);
  });
  it('control: an unowned domain saves', async () => {
    const r = await saveWebsite();
    expect(r.code).toBe(200);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

describe('super-admin request search sends a quoted, LIKE-escaped filter (captured, not source text)', () => {
  it.each([
    ['a,b', String.raw`"%a,b%"`],
    ['50%_off', String.raw`"%50\\%\\_off%"`],
    ['x"y', String.raw`"%x\"y%"`],
  ])('search %j -> each ilike value is %s', async (term, needle) => {
    const r = await call(searchRoute, { method: 'GET', query: { search: term } });
    expect(r.code).toBe(200);
    const ors = mockCalls.filter((c) => c.table === 'access_requests' && c.op === 'or').map((c) => c.args[0]);
    expect(ors).toEqual([`email.ilike.${needle},domain.ilike.${needle},company_name.ilike.${needle}`]);
  });
});
