/**
 * Closure-015H — F-5 (super-admin/users DELETE) and the company-membership
 * lifecycle rules G-3 / G-5.
 *
 * F-5 before: handleUsersDelete bound identity.admin.delete to the TARGET company
 * (organizationId: companyId) → a platform SA who is not a member of it got 403
 * NOT_ORG_MEMBER; Route 1 (companyId) deleted ANY membership unconditionally,
 * SUPER_ADMIN rows included; Route 2 (whole user) deactivated every membership,
 * SUPER_ADMIN rows included; audit rows carried actorUserId null; the UI sent no
 * Idempotency-Key (400 before authorization — see the .dom suite).
 *
 * After: no org binding (platform-tier capability; platform write authority and
 * step-up unchanged); Route 1 reads the target, refuses SUPER_ADMIN (any status),
 * deletes conditionally on id + role + status (409 when stale), 404 / 503 / 500
 * truthful; Route 2 refuses a user holding any SUPER_ADMIN membership before
 * touching auth / users / memberships, and never deactivates SUPER_ADMIN rows;
 * audit rows carry the acting principal.
 *
 * G-3: /api/company/users DELETE is conditional on id + role + status.
 * G-5: /api/company/users PUT never sets an INVITED or EXPIRED membership active.
 *
 * REAL: both routes (super-admin/users, company/users), withIdempotency (Idempotency-Key
 * required; replay of a completed key), mayAttemptCapability, requireSuperAdminAccess,
 * requireCapability → IdentityResolver → CapabilityService → step-up, handleUsersDelete,
 * requireCompanyContext / ensureCompanyAdminAccess, the governed admin/revoke-super-admin
 * route — over the routeAuthHarness in-memory tables.
 * FAKED (I/O only): identity provider + session (x-test-user), legacy bridge, security-audit
 * sink, admin rate limiter, Supabase Auth admin deleteUser (a spy), auth-event log; and — for
 * race / failure cases only — hooks on the in-memory builder between the route's read and write.
 * In-memory: not Postgres, not a real WebAuthn ceremony.
 */
import { seed, rows, calls, invoke, CO_A, CO_B } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
const mockAuthDeleteUser = jest.fn(async () => ({ data: {}, error: null }));
const mockHooks: { beforeWrite: ((op: 'update' | 'delete') => void) | null; failWrite: 'update' | 'delete' | null; failSelect: string | null } = { beforeWrite: null, failWrite: null, failSelect: null };

function mockFailing(): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'forced failure' } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  if (table !== 'user_company_roles') return builder;
  const origSelect = builder.select as (cols?: string) => Record<string, unknown>;
  builder.select = (cols?: string) => (mockHooks.failSelect !== null && cols === mockHooks.failSelect ? mockFailing() : origSelect(cols));
  for (const op of ['update', 'delete'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockHooks.beforeWrite) mockHooks.beforeWrite(op);
      const next = orig(p);
      return mockHooks.failWrite === op ? mockFailing() : next;
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  const wrapped = {
    ...fake,
    from: (t: string) => mockWrap(fake.from(t), t),
    auth: { ...fake.auth, admin: { ...fake.auth.admin, deleteUser: (...a: unknown[]) => mockAuthDeleteUser(...(a as [])) } },
  };
  return { supabase: wrapped, default: wrapped, getSupabase: () => wrapped, supabaseAdmin: wrapped };
});
jest.mock('../../db/writeOwner', () => {
  const base = require('../helpers/routeAuthHarness').writeOwnerModule();
  return { ownedDbTable: (t: string) => mockWrap(base.ownedDbTable(t), t) };
});
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' };
  },
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async (req: { headers?: Record<string, unknown> }) => {
    const user = req?.headers?.['x-test-user'];
    if (typeof user !== 'string' || !user) return { ok: false, reason: 'NO_SESSION' };
    const now = new Date().toISOString();
    return { ok: true, session: { id: `sess-${user}`, user_id: user, created_at: now, last_seen_at: now } };
  },
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({ resolveLegacyCookieSuperAdminPrincipal: async () => null }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { mockSecurityAudit.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import superAdminUsersRoute from '../../../pages/api/super-admin/users';
import companyUsersRoute from '../../../pages/api/company/users';
import revokeSuperAdminRoute from '../../../pages/api/admin/revoke-super-admin';
import { IDENTITY_ADMIN_DELETE, IDENTITY_ADMIN_REVOKE } from '../../../shared/contracts/security';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const PSA = 'u-psa';               // active platform SA (row in P only — NOT a member of CO_A / CO_B); passkey + trusted
const PSA_NOSTEP = 'u-psa-nostep'; // active platform SA, no step-up
const CADMIN = 'u-cadmin';         // active COMPANY_ADMIN of CO_A; passkey + trusted
const GRANTEE = 'u-grantee';       // VIEW_ONLY of CO_A with a DIRECT identity.admin.delete grant; passkey + trusted
const TARGET = 'u-target';         // ordinary member of CO_A (and of CO_B)
const SA_IN_A = 'u-sa-in-a';       // a SUPER_ADMIN whose membership row resides in CO_A
const LONER = 'u-loner';           // a user with ordinary memberships only (Route 2 target)
const STEPPED = [PSA, CADMIN, GRANTEE];

function world(opts: { sa?: { role?: string; status?: string } | null; loner?: Array<{ role: string; status: string }> } = {}) {
  const sa = opts.sa === undefined ? { role: 'SUPER_ADMIN', status: 'active' } : opts.sa;
  const loner = opts.loner ?? [{ role: 'CONTENT_CREATOR', status: 'active' }];
  seed({
    user_company_roles: [
      { id: 'r-psa', user_id: PSA, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-psa-n', user_id: PSA_NOSTEP, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-cadmin', user_id: CADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-grantee', user_id: GRANTEE, company_id: CO_A, role: 'VIEW_ONLY', status: 'active' },
      { id: 'r-target-a', user_id: TARGET, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
      { id: 'r-target-b', user_id: TARGET, company_id: CO_B, role: 'CONTENT_REVIEWER', status: 'active' },
      ...(sa ? [{ id: 'r-sa-a', user_id: SA_IN_A, company_id: CO_A, role: 'SUPER_ADMIN', status: 'active', ...sa }] : []),
      ...loner.map((m, i) => ({ id: `r-loner-${i}`, user_id: LONER, company_id: i === 0 ? CO_A : CO_B, ...m })),
    ],
    users: [
      { id: LONER, supabase_uid: 'sb-loner', email: 'loner@example.test' },
      { id: SA_IN_A, supabase_uid: 'sb-sa', email: 'sa@example.test', role: 'SUPER_ADMIN' },
    ],
    capability_assignments: [{ user_id: GRANTEE, capability: IDENTITY_ADMIN_DELETE, organization_id: null, expires_at: null, revoked_at: null }],
    stepup_sessions: STEPPED.map((u) => ({ id: `su-${u}`, user_id: u, auth_session_id: `sess-${u}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null })),
    trusted_devices: [PSA, PSA_NOSTEP, CADMIN, GRANTEE].map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null })),
    api_idempotency_keys: [],
    audit_logs: [],
  });
}
let keySeq = 0;
const freshKey = () => `c15h-${++keySeq}`;
const saDelete = (who: string | null, body: Record<string, unknown>, key: string | null = freshKey()) =>
  invoke(superAdminUsersRoute as never, {
    method: 'DELETE',
    body,
    headers: { ...(who ? { 'x-test-user': who } : {}), ...(key ? { 'idempotency-key': key } : {}) },
  });
const mem = (userId: string, companyId = CO_A) => rows('user_company_roles').find((r) => r.user_id === userId && r.company_id === companyId);
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && (c.op === 'update' || c.op === 'delete'));
const audits = (action: string) => rows('audit_logs').filter((a) => a.action === action);

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockAuthDeleteUser.mockClear();
  mockHooks.beforeWrite = null;
  mockHooks.failWrite = null;
  mockHooks.failSelect = null;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const SA_STATES: Array<[string, { role?: string; status?: string }]> = [
  ['active', { status: 'active' }],
  ['invited', { status: 'invited' }],
  ['inactive (revoked by deactivation)', { status: 'inactive' }],
  ['expired', { status: 'expired' }],
  ['active, legacy lower-case role', { role: 'super_admin', status: 'active' }],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('F-5 Route 1 (companyId) — authorization', () => {
  it('a stepped-up platform SA who is NOT a member of the target company removes an ordinary member → 200 (was 403 NOT_ORG_MEMBER)', async () => {
    world();
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toBeUndefined();
    expect(mem(TARGET, CO_B)).toMatchObject({ role: 'CONTENT_REVIEWER', status: 'active' }); // other company untouched
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_DELETE, decision: 'elevated_route_accessed', actorUserId: PSA }));
    expect(mockSecurityAudit.some((e) => String(e.reason ?? '').includes('NOT_ORG_MEMBER'))).toBe(false);
    expect(audits('SUPER_ADMIN_USER_DELETE')).toEqual([expect.objectContaining({ actor_user_id: PSA, target_user_id: TARGET, company_id: CO_A })]);
  });

  it('active platform SA WITHOUT step-up → STEP_UP_REQUIRED; nothing deleted', async () => {
    world();
    const r = await saDelete(PSA_NOSTEP, { userId: TARGET, companyId: CO_A });
    expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(mem(TARGET)).toBeTruthy();
    expect(membershipWrites()).toHaveLength(0);
  });

  it.each([
    ['an active COMPANY_ADMIN of the company (passkey + trusted)', CADMIN],
    ['a VIEW_ONLY member with a DIRECT identity.admin.delete grant (passkey + trusted)', GRANTEE],
  ])('%s → refused (403); nothing deleted', async (_d, who) => {
    world();
    const r = await saDelete(who, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(403);
    expect(mem(TARGET)).toBeTruthy();
    expect(membershipWrites()).toHaveLength(0);
  });

  it('unauthenticated → 401; nothing deleted', async () => {
    world();
    expect((await saDelete(null, { userId: TARGET, companyId: CO_A })).status).toBe(401);
    expect(mem(TARGET)).toBeTruthy();
  });
});

describe('F-5 Route 1 — idempotency', () => {
  it('missing Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED before authorization; nothing deleted', async () => {
    world();
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A }, null);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(mem(TARGET)).toBeTruthy();
    expect(mockSecurityAudit).toHaveLength(0);
  });

  it('a valid key → 200; replaying the SAME key replays the 200 without a second delete', async () => {
    world();
    const key = freshKey();
    expect((await saDelete(PSA, { userId: TARGET, companyId: CO_A }, key)).status).toBe(200);
    const writesAfterFirst = membershipWrites().length;
    const replay = await saDelete(PSA, { userId: TARGET, companyId: CO_A }, key);
    expect(replay.status).toBe(200);
    expect(membershipWrites()).toHaveLength(writesAfterFirst);
    expect(audits('SUPER_ADMIN_USER_DELETE')).toHaveLength(1);
  });
});

describe('F-5 Route 1 — SUPER_ADMIN memberships are never deleted (governed revoke is the only path)', () => {
  it.each(SA_STATES)('%s SUPER_ADMIN membership → 403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE; preserved; no write; audited with the actor', async (_d, sa) => {
    world({ sa });
    const before = { ...mem(SA_IN_A) };
    const r = await saDelete(PSA, { userId: SA_IN_A, companyId: CO_A });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' });
    expect(mem(SA_IN_A)).toEqual(before);
    expect(membershipWrites()).toHaveLength(0);
    expect(audits('PRIVILEGED_MEMBERSHIP_DELETE_DENIED')).toEqual([expect.objectContaining({ actor_user_id: PSA, target_user_id: SA_IN_A, company_id: CO_A })]);
  });
});

describe('F-5 Route 1 — truthful statuses and stale conditional writes', () => {
  it('missing membership → 404; nothing deleted', async () => {
    world();
    const r = await saDelete(PSA, { userId: 'u-nobody', companyId: CO_A });
    expect(r.status).toBe(404);
    expect(membershipWrites()).toHaveLength(0);
  });

  it('target lookup failure → 503 MEMBERSHIP_LOOKUP_FAILED; nothing deleted', async () => {
    world();
    mockHooks.failSelect = 'id, role, status';
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'MEMBERSHIP_LOOKUP_FAILED' });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('write failure → 500; membership intact; no success audit', async () => {
    world();
    mockHooks.failWrite = 'delete';
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(500);
    expect(mem(TARGET)).toBeTruthy();
    expect(audits('SUPER_ADMIN_USER_DELETE')).toHaveLength(0);
  });

  it('STALE: promoted to SUPER_ADMIN between the read and the delete → 409; NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(TARGET) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'STALE_MEMBERSHIP' });
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('STALE: status changed between the read and the delete → 409; NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(TARGET) as Record<string, unknown>).status = 'inactive'; };
    const r = await saDelete(PSA, { userId: TARGET, companyId: CO_A });
    expect(r.status).toBe(409);
    expect(mem(TARGET)).toMatchObject({ status: 'inactive' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F-5 Route 2 (no companyId: whole-user delete) — never removes SUPER_ADMIN authority', () => {
  it.each(SA_STATES)('a user holding a %s SUPER_ADMIN membership → 403 before anything is touched (no auth delete, no soft-delete, no deactivation)', async (_d, sa) => {
    world({ sa });
    const r = await saDelete(PSA, { userId: SA_IN_A });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' });
    expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    expect(rows('users').find((u) => u.id === SA_IN_A)?.is_deleted ?? false).toBe(false);
    expect(membershipWrites()).toHaveLength(0);
    expect(audits('PRIVILEGED_MEMBERSHIP_DELETE_DENIED')).toEqual([expect.objectContaining({ actor_user_id: PSA, target_user_id: SA_IN_A })]);
  });

  it('an ordinary user → 200: auth deleted, users row soft-deleted, memberships deactivated; audit carries the actor', async () => {
    world({ loner: [{ role: 'CONTENT_CREATOR', status: 'active' }, { role: 'VIEW_ONLY', status: 'invited' }] });
    const r = await saDelete(PSA, { userId: LONER });
    expect(r.status).toBe(200);
    expect(mockAuthDeleteUser).toHaveBeenCalledWith('sb-loner');
    expect(rows('users').find((u) => u.id === LONER)).toMatchObject({ is_deleted: true });
    expect(rows('user_company_roles').filter((m) => m.user_id === LONER).every((m) => m.status === 'inactive')).toBe(true);
    expect(audits('SUPER_ADMIN_USER_DELETE_UNASSIGNED')).toEqual([expect.objectContaining({ actor_user_id: PSA, target_user_id: LONER })]);
  });

  it('membership lookup failure → 503; nothing touched', async () => {
    world();
    mockHooks.failSelect = 'id, role, status';
    const r = await saDelete(PSA, { userId: LONER });
    expect(r.status).toBe(503);
    expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    expect(membershipWrites()).toHaveLength(0);
  });

  it('backstop: a membership promoted to SUPER_ADMIN after the check is NOT deactivated by the bulk deactivation', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'update') (mem(LONER) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await saDelete(PSA, { userId: LONER });
    expect(r.status).toBe(200);
    expect(mem(LONER)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });
});

describe('governed revoke / downgrade path — regression', () => {
  const revoke = (who: string) => invoke(revokeSuperAdminRoute as never, { method: 'POST', body: { userId: SA_IN_A }, headers: { 'x-test-user': who } });

  it('stepped-up platform SA → 200; the SUPER_ADMIN membership is downgraded (not deleted)', async () => {
    world();
    const r = await revoke(PSA);
    expect(r.status).toBe(200);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_REVOKE, decision: 'elevated_route_accessed' }));
  });

  it('without step-up → STEP_UP_REQUIRED; company admin → 403; SA intact', async () => {
    world();
    expect((await revoke(PSA_NOSTEP)).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect((await revoke(CADMIN)).status).toBe(403);
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G-5 — /api/company/users PUT never activates an invited / expired membership', () => {
  const put = (body: Record<string, unknown>) => invoke(companyUsersRoute as never, {
    method: 'PUT', query: { companyId: CO_A }, body: { companyId: CO_A, ...body },
    headers: { 'x-test-user': CADMIN, 'idempotency-key': freshKey() },
  });

  it.each(['invited', 'expired'])('%s membership → status active → 409 INVITATION_ACCEPTANCE_REQUIRED; unchanged; no write', async (status) => {
    world();
    (mem(TARGET) as Record<string, unknown>).status = status;
    const r = await put({ userId: TARGET, role: 'CONTENT_CREATOR', status: 'active' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'INVITATION_ACCEPTANCE_REQUIRED' });
    expect(mem(TARGET)).toMatchObject({ status });
    expect(membershipWrites()).toHaveLength(0);
  });

  it('an invited membership: role change WITHOUT a status → 200; still invited (not activated)', async () => {
    world();
    (mem(TARGET) as Record<string, unknown>).status = 'invited';
    const r = await put({ userId: TARGET, role: 'CONTENT_REVIEWER' });
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_REVIEWER', status: 'invited' });
  });

  it('an invited membership can still be deactivated (status inactive) → 200', async () => {
    world();
    (mem(TARGET) as Record<string, unknown>).status = 'invited';
    expect((await put({ userId: TARGET, role: 'CONTENT_CREATOR', status: 'inactive' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ status: 'inactive' });
  });

  it('an active member: role change and deactivation still work (unchanged)', async () => {
    world();
    expect((await put({ userId: TARGET, role: 'VIEW_ONLY' })).status).toBe(200);
    expect((await put({ userId: TARGET, role: 'VIEW_ONLY', status: 'inactive' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY', status: 'inactive' });
  });

  it('H-1 (decided in Closure-015I): inactive → active → 409 REACTIVATION_REQUIRES_GOVERNED_PATH; unchanged', async () => {
    world();
    (mem(TARGET) as Record<string, unknown>).status = 'inactive';
    const r = await put({ userId: TARGET, role: 'CONTENT_CREATOR', status: 'active' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'REACTIVATION_REQUIRES_GOVERNED_PATH' });
    expect(mem(TARGET)).toMatchObject({ status: 'inactive' });
  });
});

describe('G-3 — /api/company/users DELETE is conditional on id + role + status', () => {
  const del = (userId: string) => invoke(companyUsersRoute as never, {
    method: 'DELETE', query: { companyId: CO_A }, body: { companyId: CO_A, userId },
    headers: { 'x-test-user': CADMIN, 'idempotency-key': freshKey() },
  });

  it('status changed between the read and the delete → 409; the membership is NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(TARGET) as Record<string, unknown>).status = 'inactive'; };
    const r = await del(TARGET);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(mem(TARGET)).toMatchObject({ status: 'inactive' });
  });

  it('role changed between the read and the delete → 409; NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(TARGET) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    expect((await del(TARGET)).status).toBe(409);
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('unchanged membership → 200; deleted', async () => {
    world();
    expect((await del(TARGET)).status).toBe(200);
    expect(mem(TARGET)).toBeUndefined();
  });
});
