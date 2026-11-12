/**
 * S2 tenant seam (e1) - pages/api/domain/{regenerate-token,verify}.ts.
 * The domain row is looked up by its domain name, the caller is authorized against
 * the row's OWNING company, and every company_domains write is pinned (by the seam)
 * to that authorized company - including a SUPER_ADMIN force override.
 *
 * Cross-tenant cases:
 *   - an admin of A only, regenerating / verifying B's domain -> 403, nothing written;
 *   - every write carries the tenant predicate company_id = the authorized company
 *     (the pre-S2 writes filtered by row id alone).
 * The fake applies every filter and records each update's filters.
 */
export {};
process.env.VERIFICATION_SECRET = 'x'.repeat(32); // obviously fake; the service requires >= 32 chars (public repo: no realistic secrets)
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockUpdates: Array<{ table: string; filters: Row; patch: Row }> = [];

function mockTable(table: string) {
  const filters: Row = {};
  const tests: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let mode: 'many' | 'one' = 'many';
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (patch) {
      mockUpdates.push({ table, filters: { ...filters }, patch });
      for (const r of hit) Object.assign(r, patch);
      return { data: null, error: null };
    }
    return { data: mode === 'one' ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => { mode = 'one'; return b; },
    single: () => { mode = 'one'; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIp: () => '1.2.3.4' }));
jest.mock('../../services/authResolver', () => ({ resolveAuthenticatedUser: async () => ({ user: { supabaseUid: 'sb-a' }, error: null }) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: async () => undefined }));
jest.mock('../../services/domainEventLogger', () => ({ logDomainEvent: async () => undefined }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));
jest.mock('../../services/domainVerificationService', () => ({
  verifyDomain: async (domain: string) => {
    const row = (require('./s2DomainRoutesTenant.test').__db.company_domains as Row[]).find((r) => r.final_domain === domain);
    return row ? { ok: true, row, outcome: { verified: true, method: 'dns', attempted: { dns: {}, http: {} } } } : { ok: false, error: 'NOT_FOUND' };
  },
}));
export const __db = mockDb;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
/* eslint-disable @typescript-eslint/no-var-requires */
const regenerate = require('../../../pages/api/domain/regenerate-token').default;
const verify = require('../../../pages/api/domain/verify').default;
/* eslint-enable @typescript-eslint/no-var-requires */

async function post(handler: any, body: Row) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockUpdates.length = 0;
  mockDb.users = [{ id: 'user-a', supabase_uid: 'sb-a', active_company_id: A }];
  mockDb.user_company_roles = [{ user_id: 'user-a', company_id: A, role: 'COMPANY_ADMIN', status: 'active' }];
  mockDb.company_domains = [
    { id: 'dom-a', company_id: A, final_domain: 'a.example', verification_status: 'pending', is_primary: true },
    { id: 'dom-b', company_id: B, final_domain: 'b.example', verification_status: 'pending', is_primary: true },
  ];
});

const domainWrites = () => mockUpdates.filter((u) => u.table === 'company_domains');

describe('regenerate-token', () => {
  it("own domain: the write carries company_id = the authorized company (seam predicate)", async () => {
    const r = await post(regenerate, { domain: 'a.example' });
    expect(r.statusCode).toBe(200);
    expect(domainWrites()).toHaveLength(1);
    expect(domainWrites()[0].filters).toMatchObject({ company_id: A, id: 'dom-a' });
  });

  it("another tenant's domain: 403, nothing written", async () => {
    const r = await post(regenerate, { domain: 'b.example' });
    expect(r.statusCode).toBe(403);
    expect(domainWrites()).toHaveLength(0);
  });
});

describe('verify', () => {
  it("own domain: verified, the write is pinned to company A", async () => {
    const r = await post(verify, { domain: 'a.example' });
    expect(r.statusCode).toBe(200);
    expect(domainWrites()[0].filters).toMatchObject({ company_id: A, id: 'dom-a' });
  });

  it("another tenant's domain: 403, nothing written", async () => {
    const r = await post(verify, { domain: 'b.example' });
    expect(r.statusCode).toBe(403);
    expect(domainWrites()).toHaveLength(0);
  });

  it('SUPER_ADMIN force override writes ONLY the looked-up row\'s own tenant (company B for B\'s domain)', async () => {
    // verify.ts reads platform SUPER_ADMIN from user_company_roles itself
    mockDb.user_company_roles.push({ id: 'sa-1', user_id: 'user-a', company_id: A, role: 'SUPER_ADMIN', status: 'active' });
    const r = await post(verify, { domain: 'b.example', force: true });
    expect(r.statusCode).toBe(200);
    expect(domainWrites()[0].filters).toMatchObject({ company_id: B, id: 'dom-b' });
  });
});
