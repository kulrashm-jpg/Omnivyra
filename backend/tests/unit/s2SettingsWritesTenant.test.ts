/**
 * S2 tenant seam (e1) - three settings writes:
 *   - pages/api/admin/autonomous.ts POST: company_settings upsert stamped by the seam with the
 *     authorized company (a body company_id of another tenant cannot be stamped);
 *   - pages/api/settings/intelligence-access.ts PUT (company mode): unit overrides written through
 *     the seam; GLOBAL mode (platform default profile, sentinel id) stays a platform write under the
 *     allow-listed marker `intelligence-access-global-defaults`;
 *   - pages/api/accounts/[platform].ts DELETE: the deactivation is pinned to the tenant of the row
 *     the principal owns, and to that user.
 * The fake applies every filter and records each write with its filters and payload.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; filters: Row; payload: any }> = [];
let mockFailWrite: string | null = null;
function mockTable(table: string) {
  const filters: Row = {}; const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: any = null; let one = false; let maybe = false;
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    if (op === 'upsert' || op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      // FAITHFUL (schema): company_intelligence_config.company_id is uuid (FK companies) - a
      // non-uuid value is refused by Postgres with 22P02, as the sentinel always was in prod.
      if (table === 'company_intelligence_config' && list.some((r) => !/^[0-9a-f-]{36}$/i.test(String(r.company_id)))) {
        return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
      }
      if (mockFailWrite === table) return { data: null, error: { code: 'XX000', message: 'down' } };
      mockWrites.push({ table, op, filters: {}, payload }); list.forEach((r: Row) => rows.push({ ...r })); return { data: null, error: null };
    }
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (op === 'update' || op === 'delete') { mockWrites.push({ table, op, filters: { ...filters }, payload }); if (op === 'update') hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (one) return hit.length ? { data: hit[0], error: null } : { data: null, error: maybe ? null : { message: 'none' } };
    return { data: hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; maybe = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../middleware/authMiddleware', () => ({
  requireAuth: async () => ({ user: { id: 'user-a', email: 'a@x' } }),
  requireCompanyAccess: async (_u: string, companyId: string, res: any) => (companyId === '11111111-1111-4111-8111-111111111111' ? true : (res.status(403).json({ e: 1 }), false)),
}));
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: async () => undefined }));
jest.mock('../../services/rbacService', () => ({ Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' }, isPlatformSuperAdmin: async () => false, getUserRole: async () => ({ role: 'COMPANY_ADMIN' }) }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'user-a' }, error: null }) }));
jest.mock('../../services/intentExecutionService', () => ({ __esModule: true }), { virtual: false });
jest.mock('../../services/intelligenceUnitService', () => ({ listIntelligenceUnits: async () => [{ id: 'iu-1', name: 'U1', category: 'c', report_tiers: [] }], listCompanyIntelligenceUnits: async () => [] }));
jest.mock('../../services/platformIntelligenceService', () => ({ getPlatformRules: async (p: string) => ({ platform: { canonical_key: p } }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const autonomous = require('../../../pages/api/admin/autonomous').default;
const intelligence = require('../../../pages/api/settings/intelligence-access').default;
const accounts = require('../../../pages/api/accounts/[platform]').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function call(h: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method, headers: {}, query, body }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0;
  mockFailWrite = null;
  mockDb.user_company_roles = [{ user_id: 'user-a', company_id: A, role: 'COMPANY_ADMIN', status: 'active' }];
  mockDb.social_accounts = [
    { id: 'sa-a', user_id: 'user-a', company_id: A, platform: 'linkedin', is_active: true },
    { id: 'sa-b', user_id: 'user-b', company_id: B, platform: 'linkedin', is_active: true },
  ];
});
const writes = (t: string) => mockWrites.filter((w) => w.table === t);

describe('admin/autonomous POST', () => {
  it('the company_settings upsert is stamped with the authorized company A', async () => {
    const r = await call(autonomous, 'POST', {}, { company_id: A, autonomous_mode: true });
    expect(r.statusCode).toBe(200);
    expect(writes('company_settings')[0].payload).toMatchObject({ company_id: A, autonomous_mode: true });
  });
  it("a company the caller is not a member of is refused; nothing written", async () => {
    const r = await call(autonomous, 'POST', {}, { company_id: B, autonomous_mode: true });
    expect(r.statusCode).toBe(403);
    expect(writes('company_settings')).toHaveLength(0);
  });
});

describe('settings/intelligence-access PUT', () => {
  it("company mode: an A-only admin's overrides are stamped with A; requesting B is refused (uniform 404), never written to B", async () => {
    const ok = await call(intelligence, 'PUT', {}, { units: [{ id: 'iu-1', enabled: false }] });
    expect(ok.statusCode).toBe(200);
    expect(writes('company_intelligence_config')[0].payload).toEqual([expect.objectContaining({ company_id: A, iu_id: 'iu-1' })]);
    const toB = await call(intelligence, 'PUT', {}, { companyId: B, units: [{ id: 'iu-1', enabled: false }] });
    expect(toB.statusCode).toBe(404);
    expect(writes('company_intelligence_config')).toHaveLength(1);
  });
});

describe('accounts/[platform] DELETE', () => {
  it("deactivates the caller's own account, pinned to its tenant and the user", async () => {
    const r = await call(accounts, 'DELETE', { platform: 'linkedin' });
    expect(r.statusCode).toBe(200);
    expect(writes('social_accounts')[0].filters).toMatchObject({ id: 'sa-a', company_id: A, user_id: 'user-a' });
    expect(mockDb.social_accounts.find((x) => x.id === 'sa-b')!.is_active).toBe(true);
  });
});

describe('e9 follow-up fixes (intelligence-access)', () => {
  const C = '33333333-3333-4333-8333-333333333333';
  const units = (body: Row) => (body?.intelligence ?? []) as Row[];

  it('GLOBAL unit write (super admin) is REFUSED 409 - never a faked success; nothing written (the sentinel cannot be stored: uuid column)', async () => {
    mockDb.user_company_roles = [{ user_id: 'user-a', company_id: A, role: 'SUPER_ADMIN', status: 'active' }];
    const put = await call(intelligence, 'PUT', {}, { mode: 'global', units: [{ id: 'iu-1', enabled: false }], insights: { market_trends: false } });
    expect(put.statusCode).toBe(409);
    expect(put.body.code).toBe('GLOBAL_UNIT_DEFAULTS_UNSUPPORTED');
    expect(mockWrites).toHaveLength(0); // refused before ANY write (no partial apply of the flags)
    const get = await call(intelligence, 'GET', { mode: 'global' });
    expect(get.statusCode).toBe(200);
    expect(units(get.body).find((u) => u.id === 'iu-1')).toMatchObject({ enabled: true }); // built-in default
  });

  it('a FAILED company-mode unit write is an error (500), never a silent success', async () => {
    mockFailWrite = 'company_intelligence_config';
    const r = await call(intelligence, 'PUT', {}, { units: [{ id: 'iu-1', enabled: false }] });
    expect(r.statusCode).toBe(500);
  });

  it('an admin of A AND B edits B when B is requested (was always their first company)', async () => {
    mockDb.user_company_roles = [
      { user_id: 'user-a', company_id: A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: 'user-a', company_id: B, role: 'COMPANY_ADMIN', status: 'active' },
    ];
    const r = await call(intelligence, 'PUT', {}, { companyId: B, units: [{ id: 'iu-1', enabled: false }] });
    expect(r.statusCode).toBe(200);
    expect(writes('company_intelligence_config')[0].payload).toEqual([expect.objectContaining({ company_id: B, iu_id: 'iu-1' })]);
  });

  it('a requested company where the caller is NOT an active admin is the uniform 404; nothing written', async () => {
    mockDb.user_company_roles = [
      { user_id: 'user-a', company_id: A, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: 'user-a', company_id: C, role: 'COMPANY_ADMIN', status: 'inactive' },
    ];
    const r = await call(intelligence, 'PUT', {}, { companyId: C, units: [{ id: 'iu-1', enabled: false }] });
    const unknown = await call(intelligence, 'PUT', {}, { companyId: '44444444-4444-4444-8444-444444444444', units: [{ id: 'iu-1', enabled: false }] });
    expect(r.statusCode).toBe(404);
    expect(JSON.stringify(r.body)).toBe(JSON.stringify(unknown.body));
    expect(writes('company_intelligence_config')).toHaveLength(0);
  });
});
