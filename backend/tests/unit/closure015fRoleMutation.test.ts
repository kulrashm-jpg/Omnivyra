/**
 * Closure-015F — governed SUPER_ADMIN-safe role mutation on the two remaining
 * routes (Closure-015E decision E-2):
 *
 *   A  PATCH  /api/company/users/[userId]/role — set COMPANY_ADMIN (stored as the
 *      legacy ADMIN) or USER (CONTENT_CREATOR) on a member. Before: effectively
 *      active-platform-SA only, no step-up, and it rewrote ANY membership —
 *      including a SUPER_ADMIN row in any status (revocation bypass).
 *   B  DELETE /api/users/[userId]?companyId= — delete the member's membership in
 *      that company. Before: effectively active-platform-SA only, no step-up, and
 *      it deleted ANY membership — including a SUPER_ADMIN row; a missing
 *      membership answered 200.
 *
 * After: A gates on IDENTITY_ADMIN_ASSIGN (mandatory passkey step-up on a trusted
 * device), B on IDENTITY_ADMIN_DELETE (registered passkey step-up on a trusted
 * device) — the capabilities the governed super-admin paths already use
 * (companies/promote-admin, super-admin/users DELETE) — before any membership is
 * read or written. Both refuse a SUPER_ADMIN membership in any status, act only
 * on the membership the read found (compare-and-set / conditional delete), and
 * fail closed on lookup or write errors with nothing partially changed.
 *
 * REAL: both routes, requireCompanyContext → enforceCompanyAccess (TenantGuard),
 * ensureCompanyAdminAccess, withRBAC → enforceRole, requireCapability →
 * IdentityResolver → CapabilityService → step-up evaluation, removeUser — over
 * the routeAuthHarness in-memory tables. FAKED (I/O only): identity provider and
 * session (x-test-user), legacy bridge (none), security-audit sink, the
 * user-management audit logger; and — for the race / write-failure cases only —
 * a hook on the in-memory query builder that changes or fails the row between the
 * route's read and its write. In-memory: not Postgres, not a real WebAuthn ceremony.
 */
import { seed, rows, invoke, failTable, CO_A, CO_B } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];
/** Race / failure hooks applied to user_company_roles writes (reset per test). */
const mockHooks: { beforeWrite: ((op: 'update' | 'delete') => void) | null; failWrite: 'update' | 'delete' | null } = { beforeWrite: null, failWrite: null };

function mockWrap(builder: Record<string, unknown>, table: string) {
  if (table !== 'user_company_roles') return builder;
  for (const op of ['update', 'delete'] as const) {
    const orig = builder[op] as (p?: unknown) => Record<string, unknown>;
    builder[op] = (p?: unknown) => {
      if (mockHooks.beforeWrite) mockHooks.beforeWrite(op);
      const next = orig(p);
      if (mockHooks.failWrite === op) {
        const failing: Record<string, unknown> = {};
        const chain = () => failing;
        for (const m of ['eq', 'neq', 'in', 'is', 'select', 'limit', 'order']) failing[m] = chain;
        failing.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'forced write failure' } }).then(ok);
        failing.maybeSingle = async () => ({ data: null, error: { message: 'forced write failure' } });
        return failing;
      }
      return next;
    };
  }
  return builder;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  const fake = m.supabase;
  const wrapped = { ...fake, from: (t: string) => mockWrap(fake.from(t), t) };
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
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/campaignAuditService', () => ({ logUserManagementAudit: jest.fn() }));

import companyRoleRoute from '../../../pages/api/company/users/[userId]/role';
import removeRoute from '../../../pages/api/users/[userId]/index';
import { IDENTITY_ADMIN_ASSIGN, IDENTITY_ADMIN_DELETE, STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import { PLATFORM_TIER_CAPABILITIES } from '../../security/platformCapabilities';
import { logUserManagementAudit } from '../../services/campaignAuditService';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444';
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active') => ({ id: `ucr-${user_id}-${company_id}`, user_id, company_id, role: r, status });
const stepUp = (user_id: string, factor: string) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at: FUTURE(), consumed_at: null, revoked_at: null });
function fingerprintForBareRequest(): string {
  let h = 5381;
  const input = '||';
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `dj2-${h.toString(36)}`;
}
const trustedDevice = (user_id: string) =>
  ({ id: `dev-${user_id}`, user_id, fingerprint: fingerprintForBareRequest(), expires_at: FUTURE(), revoked_at: null });

const SUPER = 'u-super';                     // active platform SA, passkey step-up, trusted device
const SUPER_NO_STEPUP = 'u-super-nostep';    // active SA, trusted device, no step-up
const SUPER_TOTP = 'u-super-totp';           // active SA, TOTP step-up
const SUPER_UNTRUSTED = 'u-super-untrusted'; // active SA, passkey step-up, untrusted device
const CADMIN = 'u-cadmin';                   // active COMPANY_ADMIN of CO_A; passkey + trusted
const LEGACY_ADMIN = 'u-legacy-admin';       // active legacy ADMIN of CO_A; passkey + trusted
const INVITED_SA = 'u-invited-sa';           // SUPER_ADMIN row in CO_A only INVITED; passkey + trusted
/** VIEW_ONLY of CO_A with DIRECT identity.admin.assign + identity.admin.delete grants, passkey + trusted. */
const GRANTEE = 'u-grantee';
const TARGET = 'u-target';
const OTHER = 'u-other';                     // an unrelated member of CO_A
const STEPPED = [SUPER, SUPER_UNTRUSTED, CADMIN, LEGACY_ADMIN, INVITED_SA, GRANTEE];

function world(target: Record<string, unknown> | null = { role: 'CONTENT_CREATOR', status: 'active' }, targetInB = true) {
  seed({
    user_company_roles: [
      role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_TOTP, P, 'SUPER_ADMIN'), role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
      role(CADMIN, CO_A, 'COMPANY_ADMIN'), role(LEGACY_ADMIN, CO_A, 'ADMIN'), role(INVITED_SA, CO_A, 'SUPER_ADMIN', 'invited'), role(GRANTEE, CO_A, 'VIEW_ONLY'),
      role(OTHER, CO_A, 'CONTENT_REVIEWER'),
      ...(target ? [{ id: 'ucr-target-a', user_id: TARGET, company_id: CO_A, ...target }] : []),
      ...(targetInB ? [{ id: 'ucr-target-b', user_id: TARGET, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' }] : []),
    ],
    capability_assignments: [IDENTITY_ADMIN_ASSIGN, IDENTITY_ADMIN_DELETE].map((capability) =>
      ({ user_id: GRANTEE, capability, organization_id: null, expires_at: null, revoked_at: null })),
    stepup_sessions: [...STEPPED.map((u) => stepUp(u, 'webauthn')), stepUp(SUPER_TOTP, 'totp')],
    trusted_devices: [SUPER, SUPER_NO_STEPUP, SUPER_TOTP, CADMIN, LEGACY_ADMIN, INVITED_SA, GRANTEE].map(trustedDevice),
    users: [{ id: TARGET, email: 'target@example.test' }],
  });
}
const mem = (userId: string, companyId = CO_A) => rows('user_company_roles').find((r) => r.user_id === userId && r.company_id === companyId);
const patchRole = (who: string | null, roleName: string, companyId = CO_A) =>
  invoke(companyRoleRoute as never, { method: 'PATCH', query: { userId: TARGET }, body: { role: roleName, companyId }, headers: who ? { 'x-test-user': who } : {} });
const remove = (who: string | null, companyId = CO_A, userId = TARGET) =>
  invoke(removeRoute as never, { method: 'DELETE', query: { userId, companyId }, headers: who ? { 'x-test-user': who } : {} });

beforeEach(() => {
  mockSecurityAudit.length = 0;
  mockHooks.beforeWrite = null;
  mockHooks.failWrite = null;
  (logUserManagementAudit as jest.Mock).mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('policy wiring', () => {
  it('both capabilities are platform-tier with a registered passkey + trusted-device step-up', () => {
    for (const cap of [IDENTITY_ADMIN_ASSIGN, IDENTITY_ADMIN_DELETE]) {
      expect(PLATFORM_TIER_CAPABILITIES).toContain(cap);
      expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(cap);
      expect(getStepUpPolicy(cap)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A — PATCH /api/company/users/[userId]/role', () => {
  it.each([['COMPANY_ADMIN', 'ADMIN'], ['USER', 'CONTENT_CREATOR']])('stepped-up active platform SA: %s → stored %s, 200, elevated access recorded; B membership untouched', async (to, stored) => {
    world({ role: to === 'USER' ? 'ADMIN' : 'CONTENT_CREATOR', status: 'active' });
    const r = await patchRole(SUPER, to);
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toMatchObject({ role: stored, status: 'active' });
    expect(mem(TARGET, CO_B)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_ASSIGN, decision: 'elevated_route_accessed', actorUserId: SUPER }));
  });

  it.each([['no step-up', SUPER_NO_STEPUP], ['TOTP step-up', SUPER_TOTP], ['untrusted device', SUPER_UNTRUSTED]])('active SA with %s → STEP_UP_REQUIRED; unchanged', async (_d, who) => {
    world();
    const r = await patchRole(who, 'COMPANY_ADMIN');
    expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it.each([
    ['an active COMPANY_ADMIN of the company', CADMIN],
    ['an active legacy ADMIN of the company', LEGACY_ADMIN],
    ['a VIEW_ONLY member with DIRECT identity.admin.assign', GRANTEE],
    ['an INVITED SUPER_ADMIN', INVITED_SA],
  ])('%s (passkey + trusted device) → 403; unchanged; no elevated access', async (_d, who) => {
    world();
    const r = await patchRole(who, 'COMPANY_ADMIN');
    expect(r.status).toBe(403);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed')).toBe(false);
  });

  it('unauthenticated → 401; unchanged', async () => {
    world();
    expect((await patchRole(null, 'COMPANY_ADMIN')).status).toBe(401);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it.each(['active', 'invited', 'inactive', 'expired'])('a %s SUPER_ADMIN target → 403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE; unchanged (no downgrade)', async (status) => {
    world({ role: 'SUPER_ADMIN', status });
    for (const to of ['USER', 'COMPANY_ADMIN']) {
      const r = await patchRole(SUPER, to);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
      expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN', status });
    }
  });

  it.each(['invited', 'inactive', 'expired'])('a %s non-privileged target → 409 STALE_MEMBERSHIP; unchanged', async (status) => {
    world({ role: 'CONTENT_CREATOR', status });
    const r = await patchRole(SUPER, 'COMPANY_ADMIN');
    expect(r.status).toBe(409);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status });
  });

  it('no membership → 404 USER_NOT_FOUND (nothing inserted)', async () => {
    world(null, false);
    const r = await patchRole(SUPER, 'USER');
    expect(r.status).toBe(404);
    expect(mem(TARGET)).toBeUndefined();
  });

  it.each(['SUPER_ADMIN', 'OWNER', 'CONTENT_CREATOR'])('requested role %s → 400 ROLE_NOT_ALLOWED (only COMPANY_ADMIN | USER); unchanged', async (to) => {
    world();
    const r = await patchRole(SUPER, to);
    expect(r.status).toBe(400);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('CONCURRENT: the target is promoted to SUPER_ADMIN between the read and the write → 409; the promotion is NOT overwritten', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'update') (mem(TARGET) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await patchRole(SUPER, 'COMPANY_ADMIN');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('CONCURRENT: the target is deactivated between the read and the write → 409; still inactive, role unchanged', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'update') (mem(TARGET) as Record<string, unknown>).status = 'inactive'; };
    const r = await patchRole(SUPER, 'COMPANY_ADMIN');
    expect(r.status).toBe(409);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR', status: 'inactive' });
  });

  it('write failure → 500; nothing changed', async () => {
    world();
    mockHooks.failWrite = 'update';
    const r = await patchRole(SUPER, 'COMPANY_ADMIN');
    expect(r.status).toBe(500);
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('membership lookup failure → never 200, nothing changed', async () => {
    world();
    failTable('user_company_roles');
    const r = await patchRole(SUPER, 'COMPANY_ADMIN');
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B — DELETE /api/users/[userId]?companyId=', () => {
  it('stepped-up active platform SA removes an ordinary member → 200; ONLY that company\'s membership is deleted', async () => {
    world();
    const r = await remove(SUPER);
    expect(r.status).toBe(200);
    expect(mem(TARGET)).toBeUndefined();
    expect(mem(TARGET, CO_B)).toMatchObject({ role: 'COMPANY_ADMIN', status: 'active' }); // other company untouched
    expect(mem(OTHER)).toMatchObject({ role: 'CONTENT_REVIEWER' });                    // other member untouched
    expect(rows('users').some((u) => u.id === TARGET)).toBe(true);                    // user record untouched
    expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_DELETE, decision: 'elevated_route_accessed', actorUserId: SUPER }));
    expect(logUserManagementAudit).toHaveBeenCalledWith('USER_REMOVED', expect.objectContaining({ target_user_id: TARGET, company_id: CO_A }));
  });

  it('an inactive (deactivated) ordinary membership can still be cleaned up → 200', async () => {
    world({ role: 'CONTENT_CREATOR', status: 'inactive' });
    expect((await remove(SUPER)).status).toBe(200);
    expect(mem(TARGET)).toBeUndefined();
  });

  it.each([['no step-up', SUPER_NO_STEPUP], ['TOTP step-up', SUPER_TOTP], ['untrusted device', SUPER_UNTRUSTED]])('active SA with %s → STEP_UP_REQUIRED; nothing deleted', async (_d, who) => {
    world();
    const r = await remove(who);
    expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(mem(TARGET)).toBeTruthy();
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });

  it.each([
    ['an active COMPANY_ADMIN of the company', CADMIN],
    ['an active legacy ADMIN of the company', LEGACY_ADMIN],
    ['a VIEW_ONLY member with DIRECT identity.admin.delete', GRANTEE],
    ['an INVITED SUPER_ADMIN', INVITED_SA],
  ])('%s (passkey + trusted device) → 403; nothing deleted', async (_d, who) => {
    world();
    const r = await remove(who);
    expect(r.status).toBe(403);
    expect(mem(TARGET)).toBeTruthy();
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed')).toBe(false);
  });

  it('unauthenticated → 401; nothing deleted', async () => {
    world();
    expect((await remove(null)).status).toBe(401);
    expect(mem(TARGET)).toBeTruthy();
  });

  it.each(['active', 'invited', 'inactive', 'expired'])('a %s SUPER_ADMIN membership → 403 SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE; preserved', async (status) => {
    world({ role: 'SUPER_ADMIN', status });
    const r = await remove(SUPER);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' });
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN', status });
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });

  it('no membership in that company → 404 USER_ROLE_NOT_FOUND (was a false 200); the other company is untouched', async () => {
    world(null);
    const r = await remove(SUPER);
    expect(r.status).toBe(404);
    expect(mem(TARGET, CO_B)).toMatchObject({ role: 'COMPANY_ADMIN' });
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });

  it('CONCURRENT: promoted to SUPER_ADMIN between the read and the delete → 409; the SUPER_ADMIN membership is NOT deleted', async () => {
    world();
    mockHooks.beforeWrite = (op) => { if (op === 'delete') (mem(TARGET) as Record<string, unknown>).role = 'SUPER_ADMIN'; };
    const r = await remove(SUPER);
    expect(r.status).toBe(409);
    expect(mem(TARGET)).toMatchObject({ role: 'SUPER_ADMIN' });
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });

  it('delete failure after a successful read → 500; membership intact; no success audit (no partial change)', async () => {
    world();
    mockHooks.failWrite = 'delete';
    const r = await remove(SUPER);
    expect(r.status).toBe(500);
    expect(mem(TARGET)).toBeTruthy();
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });

  it('membership lookup failure → never 200; nothing deleted', async () => {
    world();
    failTable('user_company_roles');
    const r = await remove(SUPER);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('tenant isolation: a stepped-up SA removing from B deletes only B (A untouched)', async () => {
    world();
    expect((await remove(SUPER, CO_B)).status).toBe(200);
    expect(mem(TARGET, CO_B)).toBeUndefined();
    expect(mem(TARGET)).toMatchObject({ role: 'CONTENT_CREATOR' });
  });
});
