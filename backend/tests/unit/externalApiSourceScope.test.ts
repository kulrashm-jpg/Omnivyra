/**
 * e1 2026-11-12 (HIGH, fast-track) - external API sources are own-company or platform only.
 *  READ: getPlatformConfigs / getEnabledApis / getAvailableApis / the per-platform lookups used an interpolated
 *    .or() of the company id, fell back on a read error to the SAME query with NO company filter, and read
 *    .in('id', <ids a company config row named>) unscoped - returning another company's private source.
 *  WRITE: company-config PUT and access POST stored ANY api_source_id from the request.
 *  EGRESS: a source row's headers / query_params / oauth_* (which can carry credentials) went to every viewer;
 *    now only a row's OWNER (or a platform admin) receives them.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; row: Row }> = [];
let mockFailCompanyScoped = false;
function ilike(value: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    re += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(value);
}
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row = {};
  let companyScoped = false;
  const b: any = {
    select: () => b, order: () => b, limit: () => b, neq: () => b,
    eq: (c: string, v: unknown) => { if (c === 'company_id') companyScoped = true; tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    ilike: (c: string, v: string) => { tests.push((r) => ilike(String(r[c] ?? ''), v)); return b; },
    // PostgREST .or(): only the two shapes the OLD code used
    or: (e: string) => {
      if (/name\.ilike/.test(e)) return b;
      const alts = e.split(',').map((p) => { const [col, o, ...rest] = p.split('.'); const v = rest.join('.');
        return (r: Row) => (o === 'eq' ? String(r[col]) === v : (r[col] ?? null) === null); });
      tests.push((r) => alts.some((a) => a(r))); companyScoped = true; return b;
    },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      if (op !== 'select') { mockWrites.push({ table, op, row: payload }); return Promise.resolve({ data: { ...payload }, error: null }).then(ok, ko); }
      if (table === 'external_api_sources' && companyScoped && mockFailCompanyScoped) {
        mockFailCompanyScoped = false;
        return Promise.resolve({ data: null, error: { message: 'column company_id: transient failure' } }).then(ok, ko);
      }
      const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let mockEnabled: string[] = [];
let mockRole = 'COMPANY_ADMIN';
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/externalApi/accessChecks', () => ({
  isApiSourceExecutable: () => true,
  getEnabledApiIdsFromCompanyConfig: async () => mockEnabled,
}));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'u-admin-a' }, error: null }) }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
jest.mock('../../services/rbacService', () => ({
  getUserRole: async () => ({ role: mockRole, error: null }),
  hasPermission: async () => true,
  getCompanyRoleIncludingInvited: async () => mockRole,
  isPlatformSuperAdmin: async () => false,
  isSuperAdmin: async () => false,
  Role: { ADMIN: 'ADMIN', COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' },
}));
jest.mock('../../services/companyApiConfigCache', () => ({ invalidateCompanyConfigCache: () => undefined }));
jest.mock('../../services/externalApiService', () => {
  const pc = jest.requireActual('../../services/externalApi/platformConfig');
  return {
    getSocialPostingConfigs: pc.getSocialPostingConfigs,
    getAvailableApis: jest.fn(async () => []),
    getCompanyDefaultApiIds: jest.fn(async () => []),
    getEnabledApis: jest.fn(async () => []),
    getEnabledApiIdsFromCompanyConfig: jest.fn(async () => []),
    getUserApiAccess: jest.fn(async () => []),
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { getPlatformConfigs, getPlatformConfigByPlatform } = require('../../services/externalApi/platformConfig');
const { getEnabledApis, getAvailableApis } = require('../../services/externalApi/userAccess');
const { isSourceOwnOrPlatform } = require('../../services/externalApi/sourceScope');
const { redactSourceSecretsForViewer } = require('../../security/credentialSafety');
const companyConfig = require('../../../pages/api/external-apis/company-config').default;
const accessRoute = require('../../../pages/api/external-apis/access').default;
const socialConfigs = require('../../../pages/api/social-platforms/configs').default;
/* eslint-enable @typescript-eslint/no-var-requires */
const SECRET = { headers: { Authorization: 'Bearer live-token' }, query_params: { api_key: 'k' }, oauth_client_id_encrypted: 'enc-id', oauth_client_secret_encrypted: 'enc-secret' };
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockFailCompanyScoped = false; mockEnabled = []; mockRole = 'COMPANY_ADMIN';
  mockDb.external_api_sources = [
    { id: 'src-a', company_id: A, is_active: true, is_preset: false, created_at: '1', name: 'A private', platform_type: 'social', purpose: 'post', category: 'x', ...SECRET },
    { id: 'src-b', company_id: B, is_active: true, is_preset: false, created_at: '2', name: 'B private', platform_type: 'social', purpose: 'post', category: 'linkedin', ...SECRET },
    { id: 'src-p', company_id: null, is_active: true, is_preset: true, created_at: '3', name: 'Platform preset', platform_type: 'social', purpose: 'post', category: 'y', ...SECRET },
  ];
  mockDb.external_api_health = [];
  mockDb.company_api_configs = [];
});
async function call(route: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res; res.end = () => res;
  await route({ method, headers: {}, query, body, url: '/x' }, res);
  return res;
}

describe('read path: own + platform only', () => {
  it("never returns another company's source, even when A's config rows name it", async () => {
    mockEnabled = ['src-p', 'src-b'];
    expect((await getPlatformConfigs(A)).map((c: Row) => c.id).sort()).toEqual(['src-a', 'src-p']);
  });
  it('the enabled-ids fallback (no own sources) is scoped too', async () => {
    mockDb.external_api_sources = mockDb.external_api_sources.filter((s) => s.id !== 'src-a');
    mockEnabled = ['src-b'];
    expect((await getPlatformConfigs(A)).map((c: Row) => c.id)).toEqual([]);
  });
  it('a non-uuid company id is refused, never read unfiltered', async () => {
    await expect(getPlatformConfigs('x,company_id.not.is.null')).rejects.toThrow();
  });
  it("a failed scoped read never falls back to every company's sources", async () => {
    mockFailCompanyScoped = true;
    expect(await getPlatformConfigByPlatform(A, 'linkedin')).toBeNull();
    mockFailCompanyScoped = true;
    expect((await getEnabledApis(A)).map((s: Row) => s.id)).not.toContain('src-b');
    mockFailCompanyScoped = true;
    expect((await getAvailableApis(A)).map((s: Row) => s.id)).not.toContain('src-b');
  });
  it('isSourceOwnOrPlatform: own and platform yes, foreign never', async () => {
    expect(await isSourceOwnOrPlatform(A, 'src-a')).toBe(true);
    expect(await isSourceOwnOrPlatform(A, 'src-p')).toBe(true);
    expect(await isSourceOwnOrPlatform(A, 'src-b')).toBe(false);
  });
});

describe('write path: a company stores only own or platform source ids', () => {
  it("company-config PUT refuses B's source (404) and writes nothing; own/platform still work", async () => {
    expect((await call(companyConfig, 'PUT', { companyId: A, api_source_id: 'src-b' }, { enabled: true })).statusCode).toBe(404);
    expect(mockWrites.filter((w) => w.table === 'company_api_configs')).toEqual([]);
    for (const id of ['src-a', 'src-p']) expect((await call(companyConfig, 'PUT', { companyId: A, api_source_id: id }, { enabled: true })).statusCode).not.toBe(404);
  });
  it("access POST (single id) refuses B's source (404) and writes nothing; own still works", async () => {
    const r = await call(accessRoute, 'POST', { companyId: A }, { api_source_id: 'src-b', is_enabled: true });
    expect(r.statusCode).toBe(404);
    expect(mockWrites.filter((w) => w.table === 'company_api_configs')).toEqual([]);
    const ok = await call(accessRoute, 'POST', { companyId: A }, { api_source_id: 'src-a', is_enabled: true });
    expect(ok.statusCode).not.toBe(404);
    expect(mockWrites.filter((w) => w.table === 'company_api_configs').map((w) => w.row.api_source_id)).toEqual(['src-a']);
  });
});

describe('egress: secret-bearing fields only for the owner', () => {
  it('redactSourceSecretsForViewer strips platform and foreign rows entirely; owner and platform admin keep them', () => {
    const rows = mockDb.external_api_sources;
    const out = redactSourceSecretsForViewer(rows, { companyId: A, isPlatformAdmin: false });
    const by = (id: string) => out.find((r: Row) => r.id === id);
    expect(by('src-a')).toMatchObject(SECRET);
    for (const id of ['src-p', 'src-b']) {
      for (const f of ['headers', 'query_params', 'oauth_client_id_encrypted', 'oauth_client_secret_encrypted']) expect([id, f in by(id)]).toEqual([id, false]);
    }
    expect(redactSourceSecretsForViewer(rows, { companyId: null, isPlatformAdmin: true })).toEqual(rows);
  });
  it('a tenant reading social configs sees NO headers / query_params / oauth on a platform preset; its own source keeps them', async () => {
    mockEnabled = ['src-p'];
    const r = await call(socialConfigs, 'GET', { companyId: A });
    expect(r.statusCode).toBe(200);
    const by = (id: string) => r.body.apis.find((a: Row) => a.id === id);
    expect(by('src-a')).toMatchObject({ headers: SECRET.headers, oauth_client_secret_encrypted: 'enc-secret' });
    expect(by('src-p')).toBeTruthy();
    expect(JSON.stringify(by('src-p'))).not.toMatch(/live-token|enc-secret|enc-id|api_key/);
  });
});
