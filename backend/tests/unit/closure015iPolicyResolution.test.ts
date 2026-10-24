/**
 * Closure-015I — policy resolution (H-1, H-2, H-4, H-5, F-3) and the consolidated-review fix R-1.
 *
 *   H-1  /api/company/users PUT never ACTIVATES a non-active membership (invited, expired or
 *        inactive); reactivation goes through governed paths (invitation acceptance / reinvite,
 *        or the platform super-admin PATCH with identity.admin.assign + step-up).
 *   H-2  PUT status is validated against the user_company_roles_status_check vocabulary
 *        (invited | active | inactive | expired) BEFORE any read or write → 400 INVALID_STATUS.
 *   R-1  /api/super-admin/users PATCH never changes a SUPER_ADMIN membership (status or role);
 *        conditional update on id + role + status; audit carries the actor.
 *   H-4  no wildcard on the role-management permissions (CREATE_USER, ASSIGN_ROLE): refused on
 *        write (400), dropped on read (fail closed); the 30 s cache narrows on expiry.
 *   H-5  whole-user deletion: failure at every step is reported accurately (partial + completed
 *        steps) and recorded; no step bypasses the SUPER_ADMIN guard.
 *   F-3  POST /api/users/invite is retired (410, authenticated, no mutation).
 *
 * REAL: the routes (company/users, super-admin/users, super-admin/rbac, users/invite),
 * withIdempotency, requireCompanyContext / ensureCompanyAdminAccess / hasPermission /
 * getRbacConfig / saveRbacConfig, requireCapability → IdentityResolver → CapabilityService →
 * step-up — over the routeAuthHarness in-memory tables.
 * FAKED (I/O only): identity provider + session (x-test-user), legacy bridge, security-audit
 * sink, admin rate limiter, admin-audit recorder, Supabase Auth deleteUser (spy), auth-event log;
 * and, for failure cases only, hooks that fail a specific in-memory operation.
 * In-memory: not Postgres, not a real WebAuthn ceremony.
 */
import { seed, rows, calls, invoke, CO_A } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
const mockAuthDeleteUser = jest.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: {}, error: null }));
/** Failure hooks: `${table}:${op}` (op = select-cols | update | delete | insert). */
const mockFail = new Set<string>();
/** Race hook: runs when a write on `table` is issued (between the route's read and its write). */
const mockBeforeWrite: { fn: ((table: string, op: string) => void) | null } = { fn: null };

function mockFailing(): Record<string, unknown> {
  const failing: Record<string, unknown> = {};
  const chain = () => failing;
  for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order', 'maybeSingle', 'single']) failing[m] = chain;
  failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'forced failure' } }).then(ok);
  failing.maybeSingle = async () => ({ data: null, error: { message: 'forced failure' } });
  failing.single = async () => ({ data: null, error: { message: 'forced failure' } });
  return failing;
}
function mockWrap(builder: Record<string, unknown>, table: string) {
  const origSelect = builder.select as (cols?: string) => Record<string, unknown>;
  builder.select = (cols?: string) => (mockFail.has(`${table}:select:${cols}`) ? mockFailing() : origSelect(cols));
  for (const op of ['update', 'delete', 'insert'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockBeforeWrite.fn) mockBeforeWrite.fn(table, op);
      return mockFail.has(`${table}:${op}`) ? mockFailing() : orig(p);
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  // Closure-015L: models the CURRENT deployment — save_rbac_config (proposal 03) is not
  // deployed, so saveRbacConfig takes its legacy append path.
  const rpc = (fn: string, args?: unknown) => (fn === 'save_rbac_config'
    ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_rbac_config' } })
    : fake.rpc(fn, args));
  const wrapped = {
    ...fake,
    rpc,
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
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: jest.fn(async () => undefined) }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// No invitation or email ever leaves the test: the invitation service and domain I/O are spies.
const mockCreateInvitation = jest.fn(async () => ({ id: 'inv-test', inviteLink: 'http://localhost/accept', expiresAt: '2026-10-22T00:00:00.000Z', replayed: false }));
jest.mock('../../services/invitationService', () => ({ createAndSendInvitation: (...a: unknown[]) => mockCreateInvitation(...(a as [])), createInvitation: jest.fn() }));
jest.mock('../../services/domainEligibilityService', () => ({ isNonWorkEmailDomain: async () => false }));
jest.mock('../../services/domainRecordService', () => ({ saveDomainRecord: jest.fn(async () => ({ ok: true })), reassignDomain: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../services/domainVerificationService', () => ({ logDomainUnverifiedUsageForCompany: jest.fn(async () => undefined) }));

import companyUsersRoute from '../../../pages/api/company/users';
import superAdminUsersRoute from '../../../pages/api/super-admin/users';
import rbacRoute from '../../../pages/api/super-admin/rbac';
import retiredInviteRoute from '../../../pages/api/users/invite';
import {
  hasPermission, saveRbacConfig, clearRbacCache, RbacConfigValidationError, ROLE_MANAGEMENT_PERMISSIONS,
} from '../../services/rbacService';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const PSA = 'u-psa';               // active platform SA (row in P), passkey + trusted device
const PSA_NOSTEP = 'u-psa-nostep'; // active platform SA, no step-up
const CADMIN = 'u-cadmin';         // active COMPANY_ADMIN of CO_A
const TARGET = 'u-target';         // ordinary member of CO_A
const SA_IN_A = 'u-sa-in-a';       // SUPER_ADMIN row residing in CO_A
const LONER = 'u-loner';           // Route 2 (whole-user delete) target

function world(target: Record<string, unknown> = { role: 'CONTENT_CREATOR', status: 'active' }, sa: Record<string, unknown> = { status: 'active' }) {
  seed({
    user_company_roles: [
      { id: 'r-psa', user_id: PSA, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-psa-n', user_id: PSA_NOSTEP, company_id: P, role: 'SUPER_ADMIN', status: 'active' },
      { id: 'r-cadmin', user_id: CADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
      { id: 'r-target', user_id: TARGET, company_id: CO_A, accepted_at: '2026-01-01T00:00:00.000Z', ...target },
      { id: 'r-sa-a', user_id: SA_IN_A, company_id: CO_A, role: 'SUPER_ADMIN', ...sa },
      { id: 'r-loner', user_id: LONER, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
    ],
    users: [{ id: LONER, supabase_uid: 'sb-loner', email: 'loner@example.test' }, { id: SA_IN_A, email: 'sa-in-a@example.test' }],
    stepup_sessions: [{ id: 'su-psa', user_id: PSA, auth_session_id: `sess-${PSA}`, factor: 'webauthn', expires_at: FUTURE(), consumed_at: null, revoked_at: null }],
    trusted_devices: [PSA, PSA_NOSTEP].map((u) => ({ id: `dev-${u}`, user_id: u, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null })),
    api_idempotency_keys: [],
    audit_logs: [],
    rbac_config: [],
  });
  clearRbacCache();
}
let keySeq = 0;
const key = () => `c15i-${++keySeq}`;
const mem = (userId: string) => rows('user_company_roles').find((r) => r.user_id === userId && r.company_id === CO_A);
const membershipWrites = () => calls().filter((c) => c.table === 'user_company_roles' && (c.op === 'update' || c.op === 'delete'));
const companyPut = (body: Record<string, unknown>) => invoke(companyUsersRoute as never, {
  method: 'PUT', query: { companyId: CO_A }, body: { companyId: CO_A, ...body }, headers: { 'x-test-user': CADMIN, 'idempotency-key': key() },
});
const saPatch = (who: string, body: Record<string, unknown>) => invoke(superAdminUsersRoute as never, {
  method: 'PATCH', body: { companyId: CO_A, ...body }, headers: { 'x-test-user': who, 'idempotency-key': key() },
});
const saDelete = (body: Record<string, unknown>) => invoke(superAdminUsersRoute as never, {
  method: 'DELETE', body, headers: { 'x-test-user': PSA, 'idempotency-key': key() },
});

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockFail.clear();
  mockBeforeWrite.fn = null;
  mockCreateInvitation.mockClear();
  mockAuthDeleteUser.mockReset();
  mockAuthDeleteUser.mockImplementation(async () => ({ data: {}, error: null }));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('H-2 — PUT status validated against the DB vocabulary before any mutation', () => {
  it.each(['invited', 'active', 'inactive', 'expired'])('accepted status %j on an active member → not a 400', async (status) => {
    world();
    const r = await companyPut({ userId: TARGET, role: 'CONTENT_CREATOR', status });
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ status });
  });

  it.each([['deactivated', 'deactivated'], ['upper-case', 'ACTIVE'], ['empty string', ''], ['unknown', 'pending'], ['number', 1], ['object', { s: 'active' }], ['array', ['active']]])(
    'invalid status (%s) → 400 INVALID_STATUS; no read-for-write, no write',
    async (_d, status) => {
      world();
      const r = await companyPut({ userId: TARGET, role: 'CONTENT_CREATOR', status });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: 'INVALID_STATUS', allowed: ['invited', 'active', 'inactive', 'expired'] });
      expect(membershipWrites()).toHaveLength(0);
      expect(mem(TARGET)).toMatchObject({ status: 'active', role: 'CONTENT_CREATOR' });
    },
  );

  it('no status (role change only) is unaffected', async () => {
    world();
    expect((await companyPut({ userId: TARGET, role: 'VIEW_ONLY' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY', status: 'active' });
  });
});

describe('H-1 — company-scoped PUT never activates a non-active membership', () => {
  it.each([['invited', 'INVITATION_ACCEPTANCE_REQUIRED'], ['expired', 'INVITATION_ACCEPTANCE_REQUIRED'], ['inactive', 'REACTIVATION_REQUIRES_GOVERNED_PATH']])(
    '%s → active → 409 %s; unchanged; no write',
    async (from, code) => {
      world({ role: 'CONTENT_CREATOR', status: from });
      const r = await companyPut({ userId: TARGET, role: 'CONTENT_CREATOR', status: 'active' });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: code });
      expect(mem(TARGET)).toMatchObject({ status: from });
      expect(membershipWrites()).toHaveLength(0);
    },
  );

  it('status active on an already-active member is a no-op and does NOT rewrite accepted_at', async () => {
    world();
    expect((await companyPut({ userId: TARGET, role: 'CONTENT_CREATOR', status: 'active' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ status: 'active', accepted_at: '2026-01-01T00:00:00.000Z' });
  });

  it('deactivation and role changes of non-active members still work', async () => {
    world({ role: 'CONTENT_CREATOR', status: 'invited' });
    expect((await companyPut({ userId: TARGET, role: 'VIEW_ONLY', status: 'inactive' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY', status: 'inactive' });
  });

  it('the governed reactivation path exists: platform SA PATCH status active (identity.admin.assign + step-up) → 200', async () => {
    world({ role: 'CONTENT_CREATOR', status: 'inactive' });
    const r = await saPatch(PSA, { userId: TARGET, status: 'active' });
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ status: 'active' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-1 — super-admin/users PATCH never changes a SUPER_ADMIN membership', () => {
  it.each(['active', 'invited', 'inactive', 'expired'])('a %s SUPER_ADMIN membership: deactivate / re-role → 403; unchanged; audited with the actor', async (status) => {
    for (const body of [{ status: 'inactive' }, { status: 'active' }, { role: 'VIEW_ONLY' }]) {
      world(undefined, { status });
      const r = await saPatch(PSA, { userId: SA_IN_A, ...body });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
      expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status });
      expect(membershipWrites()).toHaveLength(0);
      expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED', actor_user_id: PSA, target_user_id: SA_IN_A }));
    }
  });

  it('ordinary member: role / status change → 200; audit carries the actor (was null)', async () => {
    world();
    expect((await saPatch(PSA, { userId: TARGET, role: 'VIEW_ONLY' })).status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: 'VIEW_ONLY' });
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'SUPER_ADMIN_USER_UPDATE', actor_user_id: PSA, target_user_id: TARGET }));
  });

  it('without step-up → STEP_UP_REQUIRED; unchanged', async () => {
    world();
    expect((await saPatch(PSA_NOSTEP, { userId: TARGET, role: 'VIEW_ONLY' })).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('STALE: status changed between the read and the conditional update → 409; the concurrent change stands', async () => {
    world();
    mockBeforeWrite.fn = (table, op) => { if (table === 'user_company_roles' && op === 'update') (mem(TARGET) as Record<string, unknown>).status = 'inactive'; };
    const r = await saPatch(PSA, { userId: TARGET, role: 'VIEW_ONLY' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'STALE_MEMBERSHIP' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'inactive' });
  });

  it('missing → 404; lookup failure → 503; write failure → 500 (unchanged)', async () => {
    world();
    expect((await saPatch(PSA, { userId: 'u-nobody', role: 'VIEW_ONLY' })).status).toBe(404);
    mockFail.add('user_company_roles:select:id, role, status');
    expect((await saPatch(PSA, { userId: TARGET, role: 'VIEW_ONLY' })).status).toBe(503);
    mockFail.clear();
    mockFail.add('user_company_roles:update');
    expect((await saPatch(PSA, { userId: TARGET, role: 'VIEW_ONLY' })).status).toBe(500);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('H-4 — no wildcard on role-management permissions; fail closed; cache narrows', () => {
  it('the role-management permissions are exactly CREATE_USER and ASSIGN_ROLE', () => {
    expect([...ROLE_MANAGEMENT_PERMISSIONS].sort()).toEqual(['ASSIGN_ROLE', 'CREATE_USER']);
  });

  it.each(['ASSIGN_ROLE', 'CREATE_USER', 'assign role'])('saveRbacConfig with %j: [\'*\'] → RbacConfigValidationError; nothing stored', async (permKey) => {
    world();
    await expect(saveRbacConfig({ roles: [], permissions: { [permKey]: ['*'] } as never })).rejects.toBeInstanceOf(RbacConfigValidationError);
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('POST /api/super-admin/rbac with a wildcard ASSIGN_ROLE → 400 RBAC_WILDCARD_NOT_ALLOWED; nothing stored', async () => {
    world();
    const r = await invoke(rbacRoute as never, { method: 'POST', body: { roles: [], permissions: { ASSIGN_ROLE: ['*'], VIEW_DASHBOARD: ['*'] } }, headers: { 'x-test-user': PSA, 'idempotency-key': key() } });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'RBAC_WILDCARD_NOT_ALLOWED', permission: 'ASSIGN_ROLE' });
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('an ordinary permission may still use a wildcard; role-management with explicit roles is accepted', async () => {
    world();
    // roles must be declared: normalizeRoles([]) keeps only SUPER_ADMIN (pre-existing behaviour, noted in the report).
    const r = await invoke(rbacRoute as never, { method: 'POST', body: { roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'], permissions: { VIEW_DASHBOARD: ['*'], ASSIGN_ROLE: ['COMPANY_ADMIN'] } }, headers: { 'x-test-user': PSA, 'idempotency-key': key() } });
    expect(r.status).toBe(200);
    expect(await hasPermission('VIEW_ONLY', 'VIEW_DASHBOARD')).toBe(true);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });

  it('authorization failure: a company admin cannot change the config (403); nothing stored', async () => {
    world();
    const r = await invoke(rbacRoute as never, { method: 'POST', body: { permissions: { ASSIGN_ROLE: ['COMPANY_ADMIN'] } }, headers: { 'x-test-user': CADMIN, 'idempotency-key': key() } });
    expect(r.status).toBe(403);
    expect(rows('rbac_config')).toHaveLength(0);
  });

  it('a STORED wildcard on ASSIGN_ROLE is dropped on read (fail closed): only explicitly listed roles keep it', async () => {
    world();
    rows('rbac_config').push({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'], permissions: { ASSIGN_ROLE: ['*', 'COMPANY_ADMIN'], CREATE_USER: ['*'] }, updated_at: '2026-10-15T00:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(true);
    expect(await hasPermission('VIEW_ONLY', 'CREATE_USER')).toBe(false);
    expect(await hasPermission('COMPANY_ADMIN', 'CREATE_USER')).toBe(false); // wildcard-only → no one
  });

  it('malformed stored permissions (not an object) → deny-all (Closure-015K; was: the built-in defaults)', async () => {
    world();
    rows('rbac_config').push({ roles: 'garbage', permissions: 'garbage', updated_at: '2026-10-15T00:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
    // Closure-015K (C): an untrusted stored document no longer falls back to the
    // (possibly wider) built-in defaults — nothing is granted until a valid save.
    expect(await hasPermission('COMPANY_ADMIN', 'ASSIGN_ROLE')).toBe(false);
  });

  it('cache: a narrowing stored by ANOTHER instance takes effect after the 30 s TTL (not before)', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-15T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world();
    rows('rbac_config').push({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'], permissions: { ASSIGN_ROLE: ['COMPANY_ADMIN', 'VIEW_ONLY'] }, updated_at: '2026-10-15T11:00:00.000Z' });
    clearRbacCache();
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
    // another instance narrows (a newer row); this process still holds its cache
    rows('rbac_config').push({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], permissions: { ASSIGN_ROLE: ['COMPANY_ADMIN'] }, updated_at: '2026-10-15T11:30:00.000Z' });
    jest.setSystemTime(Date.parse('2026-10-15T12:00:29.000Z'));
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
    jest.setSystemTime(Date.parse('2026-10-15T12:00:30.001Z'));
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });

  it('cache: a narrowing saved in THIS process applies immediately (save clears the cache)', async () => {
    // Deterministic clock: getRbacConfig picks the newest row by updated_at alone, so two saves in the
    // same millisecond could tie (latent ordering finding, reported); the saves here are 1 s apart.
    jest.useFakeTimers({ now: Date.parse('2026-10-15T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world();
    await saveRbacConfig({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'] as never, permissions: { ASSIGN_ROLE: ['COMPANY_ADMIN', 'VIEW_ONLY'] } as never });
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(true);
    jest.setSystemTime(Date.parse('2026-10-15T12:00:01.000Z'));
    await saveRbacConfig({ roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] as never, permissions: { ASSIGN_ROLE: ['COMPANY_ADMIN'] } as never });
    expect(await hasPermission('VIEW_ONLY', 'ASSIGN_ROLE')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('H-5 — whole-user deletion: every step fails safely and reports accurately', () => {
  const softDeleted = () => rows('users').find((u) => u.id === LONER)?.is_deleted === true;
  const lonerActive = () => mem(LONER)?.status === 'active';

  it('privilege check failure (membership lookup) → 503; nothing touched', async () => {
    world();
    mockFail.add('user_company_roles:select:id, role, status');
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(503);
    expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    expect(softDeleted()).toBe(false);
    expect(lonerActive()).toBe(true);
  });

  it('user lookup failure → 500; nothing touched (no auth delete)', async () => {
    world();
    mockFail.add('users:select:id, supabase_uid');
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(500);
    expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    expect(softDeleted()).toBe(false);
    expect(lonerActive()).toBe(true);
  });

  it('auth-provider deletion failure → 500 FAILED_TO_DELETE_FROM_AUTH; no DB change', async () => {
    world();
    mockAuthDeleteUser.mockImplementation(async () => ({ data: null, error: { message: 'provider down' } }));
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'FAILED_TO_DELETE_FROM_AUTH' });
    expect(softDeleted()).toBe(false);
    expect(lonerActive()).toBe(true);
  });

  it('soft-delete failure AFTER the auth deletion → 500, partial: true, completed [auth_account_deleted]; recovery audit written', async () => {
    world();
    mockFail.add('users:update');
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'FAILED_TO_DELETE_USER', partial: true, completed: ['auth_account_deleted'] });
    expect(lonerActive()).toBe(true);
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'SUPER_ADMIN_USER_DELETE_PARTIAL', actor_user_id: PSA, target_user_id: LONER }));
  });

  it('membership deactivation failure → 500, partial: true, completed [auth_account_deleted, user_soft_deleted]; recovery audit written', async () => {
    world();
    mockFail.add('user_company_roles:update');
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'FAILED_TO_DEACTIVATE_USER_ROLES', partial: true, completed: ['auth_account_deleted', 'user_soft_deleted'] });
    expect(softDeleted()).toBe(true);
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'SUPER_ADMIN_USER_DELETE_PARTIAL' }));
  });

  it('a failing recovery audit never masks the accurate partial-failure response', async () => {
    world();
    mockFail.add('users:update');
    mockFail.add('audit_logs:insert');
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ partial: true, completed: ['auth_account_deleted'] });
  });

  it('success → 200 with all steps done', async () => {
    world();
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(200);
    expect(mockAuthDeleteUser).toHaveBeenCalledWith('sb-loner');
    expect(softDeleted()).toBe(true);
    expect(mem(LONER)).toMatchObject({ status: 'inactive' });
  });

  it('a SUPER_ADMIN holder is refused before ANY step (no auth delete, no soft-delete, no deactivation)', async () => {
    world();
    rows('user_company_roles').push({ id: 'r-loner-sa', user_id: LONER, company_id: P, role: 'SUPER_ADMIN', status: 'invited' });
    const r = await saDelete({ userId: LONER });
    expect(r.status).toBe(403);
    expect(mockAuthDeleteUser).not.toHaveBeenCalled();
    expect(softDeleted()).toBe(false);
    expect(lonerActive()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F-3 — POST /api/users/invite is retired', () => {
  it('an authenticated platform SA → 410 ENDPOINT_RETIRED naming the replacement; nothing written', async () => {
    world();
    const before = rows('user_company_roles').length;
    const r = await invoke(retiredInviteRoute as never, { method: 'POST', body: { email: 'new@example.test', companyId: CO_A, role: 'VIEW_ONLY' }, headers: { 'x-test-user': PSA } });
    expect(r.status).toBe(410);
    expect(r.body).toEqual({ error: 'ENDPOINT_RETIRED', replacement: '/api/admin/invite-user' });
    expect(rows('user_company_roles')).toHaveLength(before);
    expect(rows('users').some((u) => u.email === 'new@example.test')).toBe(false);
  });

  it('unauthenticated → 401 (the retired route stays authenticated)', async () => {
    world();
    const r = await invoke(retiredInviteRoute as never, { method: 'POST', body: { email: 'x@example.test', companyId: CO_A, role: 'VIEW_ONLY' }, headers: {} });
    expect(r.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R-2 / R-3 — invites never rewrite an existing SUPER_ADMIN membership', () => {
  it('R-2 company-scoped POST /api/company/users: inviting the email of the SUPER_ADMIN into their company → 403; row unchanged; NO invitation created', async () => {
    world();
    const r = await invoke(companyUsersRoute as never, {
      method: 'POST', query: { companyId: CO_A }, body: { companyId: CO_A, email: 'sa-in-a@example.test', role: 'CONTENT_CREATOR' },
      headers: { 'x-test-user': CADMIN, 'idempotency-key': key() },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
    expect(rows('audit_logs')).toContainEqual(expect.objectContaining({ action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED', actor_user_id: CADMIN, target_user_id: SA_IN_A }));
  });

  it('R-2 the SUPER_ADMIN row is protected in every status', async () => {
    for (const status of ['invited', 'inactive', 'expired']) {
      world(undefined, { status });
      const r = await invoke(companyUsersRoute as never, {
        method: 'POST', query: { companyId: CO_A }, body: { companyId: CO_A, email: 'sa-in-a@example.test', role: 'VIEW_ONLY' },
        headers: { 'x-test-user': CADMIN, 'idempotency-key': key() },
      });
      expect(r.status).toBe(403);
      expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status });
    }
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it('R-2 a failed membership lookup → 503; no upsert, NO invitation', async () => {
    world();
    mockFail.add('user_company_roles:select:id, role, status');
    const r = await invoke(companyUsersRoute as never, {
      method: 'POST', query: { companyId: CO_A }, body: { companyId: CO_A, email: 'sa-in-a@example.test', role: 'CONTENT_CREATOR' },
      headers: { 'x-test-user': CADMIN, 'idempotency-key': key() },
    });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'MEMBERSHIP_LOOKUP_FAILED' });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
  });

  it('R-2 an ordinary new invitee still gets an invited membership and an invitation (unchanged)', async () => {
    world();
    const r = await invoke(companyUsersRoute as never, {
      method: 'POST', query: { companyId: CO_A }, body: { companyId: CO_A, email: 'fresh@example.test', role: 'CONTENT_CREATOR' },
      headers: { 'x-test-user': CADMIN, 'idempotency-key': key() },
    });
    expect(r.status).toBe(201);
    expect(mockCreateInvitation).toHaveBeenCalledTimes(1);
  });

  it('R-3 super-admin POST /api/super-admin/users (stepped-up SA): inviting the email of the SUPER_ADMIN into their company → 403; unchanged; NO invitation', async () => {
    world();
    const r = await invoke(superAdminUsersRoute as never, {
      method: 'POST', body: { companyId: CO_A, email: 'sa-in-a@example.test', role: 'CONTENT_CREATOR' },
      headers: { 'x-test-user': PSA, 'idempotency-key': key() },
    });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(mem(SA_IN_A)).toMatchObject({ role: 'SUPER_ADMIN', status: 'active' });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });
});
