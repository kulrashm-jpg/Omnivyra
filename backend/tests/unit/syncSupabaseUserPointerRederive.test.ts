/**
 * sync-supabase-user re-derives users.active_company_id on login when it is empty - for BOTH the returning-user
 * (by supabase_uid) and the first-link (by email) branch. Pairs with migration 20270217000042 (e1, 2026-11-13).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; payload: Row }> = [];
const mockReads: string[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: Row = {}; let one = false;
  const b: any = {
    select: () => b, order: () => b, limit: () => b, or: () => b, ilike: () => b, in: () => b, neq: () => b, gt: () => b, lt: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      const done = (data: unknown) => Promise.resolve({ data, error: null }).then(ok, ko);
      if (op !== 'select') {
        mockWrites.push({ table, op, payload });
        if (op === 'insert') { const r = { id: `${table}-new`, ...payload }; rows.push(r); return done(one ? { id: r.id } : [r]); }
        rows.filter((r) => tests.every((t) => t(r))).forEach((r) => Object.assign(r, payload));
        return done(null);
      }
      mockReads.push(table);
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      return done(one ? hit[0] ?? null : hit);
    },
  };
  return b;
}
let mockIdentity: { supabaseUid: string; email: string; emailVerified: boolean } | null = null;
let mockResolved: Row = { error: 'USER_NOT_FOUND' };
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockTable(t), rpc: async () => ({ data: false, error: null }), auth: { admin: {} } },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/authResolver', () => ({
  extractAccessToken: () => 'tok',
  validateAuthToken: async () => mockIdentity,
  resolveAuthenticatedUser: async () => mockResolved,
}));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/authMetrics', () => ({ incrementAuthMetric: jest.fn() }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/serverValidation', () => ({ validateWorkEmail: () => true }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../services/initialFreeCreditService', () => ({ grantInitialFreeCredit: jest.fn(async () => ({ outcome: 'already_claimed' })) }));
jest.mock('../../services/emailService', () => ({ sendCompanyAdminReferral: jest.fn(), sendInboundSignupNoticeToAdmin: jest.fn(), sendInvite: jest.fn() }));
jest.mock('../../security/SessionAuthorityService', () => ({ ensureSessionForUser: jest.fn(async () => ({ minted: false, sessionId: null })) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../security/MfaIntent', () => ({ issueMfaIntent: jest.fn(), userHasVerifiedMfaFactor: jest.fn(async () => ({ hasMfa: false, totpVerified: false, webauthnCount: 0 })) }));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: jest.fn(), ensureSignupCorrelationId: jest.fn(async () => 'c'), requestIp: () => null, requestUserAgent: () => null,
}));
jest.mock('../../services/companyContextGuardService', () => ({
  requireCompanyContext: jest.fn(async () => ({ companyId: '11111111-1111-4111-8111-111111111111' })),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const sync = require('../../../pages/api/auth/sync-supabase-user').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const C1 = '11111111-1111-4111-8111-1111111111c1';
const C2 = '22222222-2222-4222-8222-2222222222c2';
async function login(uid: string, email: string) {
  mockIdentity = { supabaseUid: uid, email, emailVerified: true };
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res; res.getHeader = () => undefined; res.end = () => res;
  await sync({ method: 'POST', headers: {}, query: {}, cookies: {}, body: {} }, res);
  return res;
}
const pointerOf = (id: string) => mockDb.users.find((u) => u.id === id)?.active_company_id ?? null;
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockReads.length = 0;
  mockIdentity = null; mockResolved = { error: 'USER_NOT_FOUND' };
});

// e1 2026-11-13 (e9): migration 20270217000042 clears users.active_company_id when its membership stops being active.
// The "safe because login re-derives it" argument only held for the FIRST-LINK (by-email) branch; a RETURNING user
// (bound by supabase_uid) stayed pointer-less. Both branches now re-derive from an ACTIVE membership.
describe('sync-supabase-user re-derives a cleared current-company pointer from an ACTIVE membership', () => {
  it('RETURNING user, pointer cleared, one active membership -> re-pointed at it', async () => {
    mockDb.users = [{ id: 'u1', email: 'a@acme.com', supabase_uid: 'sb-1', is_deleted: false, active_company_id: null }];
    mockDb.user_company_roles = [{ user_id: 'u1', company_id: C1, status: 'active' }];
    const r = await login('sb-1', 'a@acme.com');
    expect(r.statusCode).toBe(200);
    expect(pointerOf('u1')).toBe(C1);
  });

  it('RETURNING user after a deactivation: the deactivated company is skipped, the other ACTIVE one is chosen', async () => {
    mockDb.users = [{ id: 'u1', email: 'a@acme.com', supabase_uid: 'sb-1', is_deleted: false, active_company_id: null }];
    mockDb.user_company_roles = [
      { user_id: 'u1', company_id: C1, status: 'inactive' },
      { user_id: 'u1', company_id: C2, status: 'active' },
    ];
    await login('sb-1', 'a@acme.com');
    expect(pointerOf('u1')).toBe(C2);
  });

  it('RETURNING user with NO active membership: the pointer stays empty (login still succeeds)', async () => {
    mockDb.users = [{ id: 'u1', email: 'a@acme.com', supabase_uid: 'sb-1', is_deleted: false, active_company_id: null }];
    mockDb.user_company_roles = [{ user_id: 'u1', company_id: C1, status: 'inactive' }];
    const r = await login('sb-1', 'a@acme.com');
    expect(r.statusCode).toBe(200);
    expect(pointerOf('u1')).toBeNull();
    expect(mockWrites.filter((w) => w.table === 'users').every((w) => !('active_company_id' in w.payload))).toBe(true);
  });

  it('CONTROL: a RETURNING user whose pointer is set keeps it (no users write touches the pointer)', async () => {
    mockDb.users = [{ id: 'u1', email: 'a@acme.com', supabase_uid: 'sb-1', is_deleted: false, active_company_id: C1 }];
    mockDb.user_company_roles = [{ user_id: 'u1', company_id: C2, status: 'active' }];
    await login('sb-1', 'a@acme.com');
    expect(pointerOf('u1')).toBe(C1);
    expect(mockWrites.filter((w) => w.table === 'users').every((w) => !('active_company_id' in w.payload))).toBe(true);
  });

  it('FIRST-LINK (by-email) branch keeps re-deriving as before', async () => {
    mockDb.users = [{ id: 'u2', email: 'b@acme.com', supabase_uid: null, is_deleted: false, active_company_id: null }];
    mockDb.user_company_roles = [{ user_id: 'u2', company_id: C2, status: 'active' }];
    await login('sb-2', 'b@acme.com');
    expect(pointerOf('u2')).toBe(C2);
  });
});
