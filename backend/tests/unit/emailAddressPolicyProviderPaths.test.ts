/**
 * e1 2026-11-12 (e9 ruling, email-policy follow-ups): the auth PROVIDER can accept an address this app refuses (a
 * quoted local part may legally hold commas). Where such an identity reaches us, we create / link nothing:
 *   - sync-supabase-user: no users INSERT, no supabase_uid stamped onto a row found by email; 403 EMAIL_NOT_ACCEPTED
 *     (session-fatal -> the client signs out and explains; never a login loop, never a 500).
 *   - verify-email (first-verify path): no users INSERT; 403 EMAIL_NOT_ACCEPTED.
 *   - company/users/reinvite: refused with 400 before any read or write.
 * Controls: an acceptable address proceeds; a returning user already bound by supabase_uid is NOT locked out.
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
const verifyEmail = require('../../../pages/api/auth/verify-email').default;
const reinvite = require('../../../pages/api/company/users/reinvite').default;
const { AUTH_ERROR_CODE } = require('../../../shared/contracts/security/AuthErrorCodes');
/* eslint-enable @typescript-eslint/no-var-requires */

const QUOTED_COMMA = '"a,supabase_uid.eq.sb-victim"@acme.com';
async function call(route: any, body: Row = {}) {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res; res.getHeader = () => undefined; res.end = () => res;
  let thrown: unknown = null;
  await route({ method: 'POST', headers: {}, query: {}, cookies: {}, body }, res).catch((e: unknown) => { thrown = e; });
  return { status: res.statusCode, body: res.body, thrown };
}
const usersWrites = () => mockWrites.filter((w) => w.table === 'users');
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockReads.length = 0;
  mockIdentity = null; mockResolved = { error: 'USER_NOT_FOUND' };
});

describe('sync-supabase-user', () => {
  it('a NEW identity with a quoted-comma address creates nothing: 403 EMAIL_NOT_ACCEPTED, session-fatal', async () => {
    mockIdentity = { supabaseUid: 'sb-attacker', email: QUOTED_COMMA, emailVerified: true };
    const r = await call(sync);
    expect([r.status, r.body?.code, r.thrown]).toEqual([403, AUTH_ERROR_CODE.EMAIL_NOT_ACCEPTED, null]);
    expect(usersWrites()).toEqual([]);
  });

  it('control (05 review): a PRE-EXISTING row found by email (pending invitee / Firebase-migrated) is linked, not locked out - and the address is never written', async () => {
    mockDb.users = [{ id: 'u-invitee', email: QUOTED_COMMA.toLowerCase(), supabase_uid: null, is_deleted: false }];
    mockIdentity = { supabaseUid: 'sb-invitee', email: QUOTED_COMMA, emailVerified: true };
    const r = await call(sync);
    expect([r.status, r.body]).toEqual([200, { ok: true }]);
    expect(mockDb.users).toHaveLength(1);
    expect(mockDb.users[0].supabase_uid).toBe('sb-invitee');
    expect(usersWrites().every((w) => w.op === 'update' && !('email' in w.payload))).toBe(true);
  });

  it('control: a returning user already bound by supabase_uid is NOT locked out (the update never writes the address)', async () => {
    mockDb.users = [{ id: 'u-legacy', email: QUOTED_COMMA.toLowerCase(), supabase_uid: 'sb-legacy', is_deleted: false }];
    mockIdentity = { supabaseUid: 'sb-legacy', email: QUOTED_COMMA, emailVerified: true };
    const r = await call(sync);
    expect([r.status, r.body]).toEqual([200, { ok: true }]);
    expect(usersWrites().every((w) => !('email' in w.payload))).toBe(true);
  });

  it('control: an acceptable new address is inserted', async () => {
    mockIdentity = { supabaseUid: 'sb-new', email: 'john@acme.com', emailVerified: true };
    await call(sync);
    expect(usersWrites()).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'insert', payload: expect.objectContaining({ email: 'john@acme.com', supabase_uid: 'sb-new' }) }),
    ]));
  });
});

describe('verify-email (first-verify path creates the users row)', () => {
  it('a quoted-comma address creates no users row: 403 EMAIL_NOT_ACCEPTED, not a 500', async () => {
    mockIdentity = { supabaseUid: 'sb-attacker', email: QUOTED_COMMA, emailVerified: true };
    const r = await call(verifyEmail);
    expect([r.status, r.body?.code, r.thrown]).toEqual([403, AUTH_ERROR_CODE.EMAIL_NOT_ACCEPTED, null]);
    // the canonical envelope (sendAuthError / buildAuthErrorResponse), not a hand-rolled body
    expect(r.body).toMatchObject({ fatal: true });
    expect(usersWrites()).toEqual([]);
  });

  it('control: an acceptable address reaches the insert', async () => {
    mockIdentity = { supabaseUid: 'sb-new', email: 'john@acme.com', emailVerified: true };
    await call(verifyEmail);
    expect(usersWrites()).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'insert', payload: expect.objectContaining({ email: 'john@acme.com' }) }),
    ]));
  });
});

describe('company/users/reinvite', () => {
  const CO = '11111111-1111-4111-8111-111111111111';
  it('a quoted-comma or non-string address is refused with 400 before any read or write', async () => {
    for (const email of [QUOTED_COMMA, 42, ['john@acme.com']]) {
      mockReads.length = 0; mockWrites.length = 0;
      const r = await call(reinvite, { email, companyId: CO });
      expect([email, r.status]).toEqual([email, 400]);
      expect([email, mockReads, mockWrites]).toEqual([email, [], []]);
    }
  });

  it('control: an acceptable address gets past the policy (the route reads on)', async () => {
    mockResolved = { user: { id: 'actor-1' } };
    const r = await call(reinvite, { email: 'john@acme.com', companyId: CO });
    expect(r.status).not.toBe(400);
    expect(mockReads.length).toBeGreaterThan(0);
  });
});
