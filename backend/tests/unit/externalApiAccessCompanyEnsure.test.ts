/**
 * BLOCKING fix (e1, 2026-11-12; 05 finding, e9 ruling) - external-apis/access POST "ensure company exists".
 * It used to UPSERT companies on id (ON CONFLICT DO UPDATE) whenever the read errored OR found nothing, so a
 * transient read error against a live company overwrote name/website and forced status = 'active' (reactivating a
 * disabled company; status is an authorization signal - TenantGuard ORG_INACTIVE).
 * Pinned: a read error writes NOTHING and answers 503; a missing row is INSERTED (never upserted, no website);
 * 23505 on that insert is success; an existing row is never written.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; payload: any }> = [];
let mockCompanyReadError: { code: string; message: string } | null = null;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: any = null; let one = false;
  const b: any = {
    select: () => b, order: () => b, limit: () => b, in: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      const done = (data: unknown, error: unknown = null) => Promise.resolve({ data, error }).then(ok, ko);
      if (op !== 'select') {
        mockWrites.push({ table, op, payload });
        if (table === 'companies' && op === 'insert') {
          if (rows.some((r) => r.id === payload.id)) return done(null, { code: '23505', message: 'duplicate key' });
          rows.push({ ...payload });
        }
        return done(null);
      }
      if (table === 'companies' && mockCompanyReadError) return done(null, mockCompanyReadError);
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      return done(one ? hit[0] ?? null : hit);
    },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/externalApiService', () => ({
  getAvailableApis: jest.fn(async () => []),
  getCompanyDefaultApiIds: jest.fn(async () => []),
  getEnabledApis: jest.fn(async () => []),
  getEnabledApiIdsFromCompanyConfig: jest.fn(async () => []),
  getUserApiAccess: jest.fn(async () => []),
}));
jest.mock('../../services/companyApiConfigCache', () => ({ invalidateCompanyConfigCache: jest.fn(), getCompanyConfigRows: jest.fn(async () => []) }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: 'admin-1' }, error: null })) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/rbacService', () => ({
  getUserRole: jest.fn(async () => ({ role: 'COMPANY_ADMIN', error: null })),
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  hasPermission: jest.fn(async () => true),
  isPlatformSuperAdmin: jest.fn(async () => false),
  isSuperAdmin: jest.fn(async () => false),
  Role: {},
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/external-apis/access').default;
/* eslint-enable @typescript-eslint/no-var-requires */
const CO = '11111111-1111-4111-8111-111111111111';
async function post() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'POST', headers: {}, query: { companyId: CO }, body: { companyId: CO, company_default_api_ids: [] } }, res);
  return res;
}
const companyWrites = () => mockWrites.filter((w) => w.table === 'companies');
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockCompanyReadError = null;
});

it('a transient READ error on a live, DISABLED company writes nothing and answers 503 (no reactivation)', async () => {
  mockDb.companies = [{ id: CO, name: 'Acme', website: 'https://acme.com', status: 'inactive' }];
  mockCompanyReadError = { code: '08006', message: 'connection failure' };
  const r = await post();
  expect(r.statusCode).toBe(503);
  expect(companyWrites()).toEqual([]);
  expect(mockDb.companies[0]).toEqual({ id: CO, name: 'Acme', website: 'https://acme.com', status: 'inactive' });
});

it('an existing company is never written', async () => {
  mockDb.companies = [{ id: CO, name: 'Acme', website: 'https://acme.com', status: 'suspended' }];
  await post();
  expect(companyWrites()).toEqual([]);
  expect(mockDb.companies[0].status).toBe('suspended');
});

it('a genuinely missing company is INSERTED (never upserted) with no fabricated website', async () => {
  mockDb.company_profiles = [{ company_id: CO, name: 'Profile Name' }];
  const r = await post();
  expect(r.statusCode).not.toBe(500);
  expect(companyWrites()).toEqual([{ table: 'companies', op: 'insert', payload: { id: CO, name: 'Profile Name', status: 'active' } }]);
});

it('a concurrent create (23505 on the insert) is success, not a 500, and updates nothing', async () => {
  // the read sees no row; the row appears before the insert lands
  const realFrom = mockTable;
  mockDb.companies = [];
  const original = mockDb.companies;
  let reads = 0;
  Object.defineProperty(mockDb, 'companies', {
    configurable: true,
    get: () => { reads += 1; if (reads === 2) original.push({ id: CO, name: 'Raced', status: 'inactive' }); return original; },
    set: () => undefined,
  });
  const r = await post();
  void realFrom;
  expect(r.statusCode).not.toBe(500);
  expect(companyWrites().map((w) => w.op)).toEqual(['insert']);
  expect(original.find((x) => x.id === CO)).toMatchObject({ name: 'Raced', status: 'inactive' });
  delete (mockDb as any).companies;
});
