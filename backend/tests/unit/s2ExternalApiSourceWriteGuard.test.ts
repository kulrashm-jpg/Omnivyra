/**
 * S2 (e1) - a company may store (company_api_configs) only its OWN external API sources or PLATFORM sources.
 * company-config PUT and access POST wrote any api_source_id from the request; with getPlatformConfigs then
 * returning whatever source a config row named, a company admin who knew another company's private source id could
 * enable it and read that company's source configuration. isSourceOwnOrPlatform now gates both writes (404).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockUpserts: Row[] = [];
function parseOr(expr: string): (r: Row) => boolean {
  const alts = expr.split(',').map((p) => {
    const [col, op, ...rest] = p.split('.'); const v = rest.join('.');
    return (r: Row) => (op === 'eq' ? String(r[col]) === v : op === 'is' && v === 'null' ? (r[col] ?? null) === null : false);
  });
  return (r) => alts.some((a) => a(r));
}
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row = {};
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    or: (e: string) => { tests.push(parseOr(e)); return b; },
    upsert: (p: Row) => { op = 'upsert'; payload = p; mockUpserts.push(p); return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      if (op === 'upsert') return Promise.resolve({ data: { ...payload }, error: null }).then(ok, ko);
      const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'u-admin-a' }, error: null }) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/rbacService', () => ({
  getUserRole: async () => ({ role: 'COMPANY_ADMIN', error: null }),
  hasPermission: async () => true,
  getCompanyRoleIncludingInvited: async () => 'COMPANY_ADMIN',
  Role: { ADMIN: 'ADMIN', COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' },
}));
jest.mock('../../services/companyApiConfigCache', () => ({ invalidateCompanyConfigCache: () => undefined }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/external-apis/company-config').default;
const { isSourceOwnOrPlatform } = require('../../services/externalApi/accessChecks');
const { tenantContextFor } = require('../../db/tenantTable');
/* eslint-enable @typescript-eslint/no-var-requires */
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockUpserts.length = 0;
  mockDb.external_api_sources = [
    { id: 'src-a', company_id: A }, { id: 'src-b', company_id: B }, { id: 'src-p', company_id: null },
  ];
  mockDb.company_api_configs = [];
});
async function put(apiSourceId: string) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await route({ method: 'PUT', headers: {}, query: { companyId: A, api_source_id: apiSourceId }, body: { enabled: true } }, res);
  return res;
}

it('isSourceOwnOrPlatform: own and platform sources yes, another company’s private source never', async () => {
  const t = tenantContextFor({ userId: 'u-admin-a' }, A);
  expect(await isSourceOwnOrPlatform(t, 'src-a')).toBe(true);
  expect(await isSourceOwnOrPlatform(t, 'src-p')).toBe(true);
  expect(await isSourceOwnOrPlatform(t, 'src-b')).toBe(false);
  expect(await isSourceOwnOrPlatform(t, 'missing')).toBe(false);
});

it("company-config PUT refuses another company's source (404) and writes nothing", async () => {
  const r = await put('src-b');
  expect(r.statusCode).toBe(404);
  expect(mockUpserts).toEqual([]);
});

it('company-config PUT still configures an own or platform source', async () => {
  for (const id of ['src-a', 'src-p']) {
    const r = await put(id);
    expect([id, r.statusCode]).not.toEqual([id, 404]);
  }
  expect(mockUpserts.map((u) => u.api_source_id)).toEqual(['src-a', 'src-p']);
});
