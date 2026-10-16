/**
 * Closure-015E (Workstream 1) — PATCH /api/users/[userId]/role.
 *
 * Before: withRBAC([SUPER_ADMIN, ADMIN]) + requireUserAdminAccess (effectively an
 * active platform super admin) and updateUserRole wrote ANY string onto ANY
 * membership — granting SUPER_ADMIN, or overwriting (revoking) a SUPER_ADMIN row
 * — with no step-up and outside identity.admin.assign / identity.admin.revoke.
 *
 * After: the same gate as every super-admin identity assignment
 * (IDENTITY_ADMIN_ASSIGN: platform-tier → platform write authority; passkey
 * step-up on a trusted device, mandatory) runs before any membership is read or
 * written; the service refuses SUPER_ADMIN as a target role and any change to a
 * SUPER_ADMIN membership (any status), accepts only INVITABLE_ROLES, changes only
 * an ACTIVE membership (compare-and-set), and fails closed on lookup errors.
 *
 * REAL: the route, withRBAC → enforceRole → getUserRole, requireCapability →
 * IdentityResolver → CapabilityService → decideCapabilityWithStepUp → step-up
 * evaluation, resolveUserContext, updateUserRole + requireUserAdminAccess — over
 * the routeAuthHarness in-memory tables. FAKED (I/O only): identity provider and
 * session lookup (x-test-user header), legacy bridge (none), security-audit sink
 * (captured), the user-management audit logger. In-memory: proves the decisions
 * and ordering, NOT Postgres/PostgREST or a real WebAuthn ceremony.
 */
import { seed, rows, invoke, failTable, CO_A, CO_B } from '../helpers/routeAuthHarness';

const mockSecurityAudit: Record<string, unknown>[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
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
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: jest.fn(async () => 'person-1') }));

import roleRoute from '../../../pages/api/users/[userId]/role';
import inviteRoute from '../../../pages/api/users/invite';
import { INVITABLE_ROLES } from '../../services/userManagementService';
import { IDENTITY_ADMIN_ASSIGN, STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';
import { CROSS_ORGANIZATION_IDENTITY_CAPABILITIES } from '../../security/platformCapabilities';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import { logUserManagementAudit } from '../../services/campaignAuditService';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const P = '44444444-4444-4444-8444-444444444444'; // platform tenant holding the SUPER_ADMIN rows
const FUTURE = () => new Date(Date.now() + 5 * 60_000).toISOString();
const PAST = () => new Date(Date.now() - 5 * 60_000).toISOString();
const role = (user_id: string, company_id: string, r: string, status = 'active', id = `ucr-${user_id}-${company_id}`) => ({ id, user_id, company_id, role: r, status });
const stepUp = (user_id: string, factor: string, expires_at = FUTURE()) =>
  ({ id: `su-${user_id}`, user_id, auth_session_id: `sess-${user_id}`, factor, expires_at, consumed_at: null, revoked_at: null });
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
const SUPER_STALE = 'u-super-stale';         // active SA, expired passkey step-up
const SUPER_TOTP = 'u-super-totp';           // active SA, TOTP step-up (not phishing-resistant)
const SUPER_UNTRUSTED = 'u-super-untrusted'; // active SA, passkey step-up, untrusted device
const INVITED_SA = 'u-invited-sa';           // SUPER_ADMIN row in CO_A only INVITED; passkey + trusted
const INACTIVE_SA = 'u-inactive-sa';         // SUPER_ADMIN row INACTIVE; passkey + trusted
const CADMIN = 'u-cadmin';                   // active COMPANY_ADMIN of CO_A; passkey + trusted
const LEGACY_ADMIN = 'u-legacy-admin';       // active legacy ADMIN of CO_A; passkey + trusted
/** VIEW_ONLY of CO_A with a DIRECT identity.admin.assign grant, passkey + trusted. */
const GRANTEE = 'u-grantee';

const TARGET = 'u-target';                   // the member whose role is changed
const STEPPED = [SUPER, SUPER_UNTRUSTED, INVITED_SA, INACTIVE_SA, CADMIN, LEGACY_ADMIN, GRANTEE];

function world(target: Record<string, unknown> | null = { role: 'CONTENT_CREATOR', status: 'active' }) {
  seed({
    user_company_roles: [
      role(SUPER, P, 'SUPER_ADMIN'), role(SUPER_NO_STEPUP, P, 'SUPER_ADMIN'), role(SUPER_STALE, P, 'SUPER_ADMIN'),
      role(SUPER_TOTP, P, 'SUPER_ADMIN'), role(SUPER_UNTRUSTED, P, 'SUPER_ADMIN'),
      role(INVITED_SA, CO_A, 'SUPER_ADMIN', 'invited'), role(INACTIVE_SA, P, 'SUPER_ADMIN', 'inactive'),
      role(CADMIN, CO_A, 'COMPANY_ADMIN'), role(LEGACY_ADMIN, CO_A, 'ADMIN'), role(GRANTEE, CO_A, 'VIEW_ONLY'),
      ...(target ? [{ id: 'ucr-target', user_id: TARGET, company_id: CO_A, ...target }] : []),
    ],
    capability_assignments: [
      { user_id: GRANTEE, capability: IDENTITY_ADMIN_ASSIGN, organization_id: null, expires_at: null, revoked_at: null },
    ],
    stepup_sessions: [...STEPPED.map((u) => stepUp(u, 'webauthn')), stepUp(SUPER_TOTP, 'totp'), stepUp(SUPER_STALE, 'webauthn', PAST())],
    trusted_devices: [SUPER, SUPER_NO_STEPUP, SUPER_STALE, SUPER_TOTP, INVITED_SA, INACTIVE_SA, CADMIN, LEGACY_ADMIN, GRANTEE].map(trustedDevice),
    users: [{ id: TARGET, email: 'target@example.test' }],
  });
}
const targetRow = () => rows('user_company_roles').find((r) => r.user_id === TARGET && r.company_id === CO_A);
const patch = (who: string | null, roleName: string, companyId = CO_A, userId = TARGET) =>
  invoke(roleRoute as never, {
    method: 'PATCH',
    query: { userId },
    body: { role: roleName, companyId },
    headers: who ? { 'x-test-user': who } : {},
  });

beforeEach(() => {
  mockSecurityAudit.length = 0;
  (logUserManagementAudit as jest.Mock).mockClear();
});

describe('policy wiring', () => {
  it('IDENTITY_ADMIN_ASSIGN is a cross-organization identity capability with MANDATORY passkey step-up on a trusted device', () => {
    expect(CROSS_ORGANIZATION_IDENTITY_CAPABILITIES).toContain(IDENTITY_ADMIN_ASSIGN);
    expect(STEP_UP_REQUIRED_CAPABILITIES).toContain(IDENTITY_ADMIN_ASSIGN);
    expect(getStepUpPolicy(IDENTITY_ADMIN_ASSIGN)).toMatchObject({ phishingResistantOnly: true, trustedDeviceRequired: true });
  });
});

describe('legitimate non-privileged role update — preserved, now behind the identity-assignment gate', () => {
  it.each(['VIEW_ONLY', 'CONTENT_REVIEWER', 'COMPANY_ADMIN', 'CONTENT_MANAGER', 'ADMIN'])(
    'active platform SA with passkey step-up on a trusted device: CONTENT_CREATOR → %s → 200, row updated, elevated access + business audit recorded',
    async (to) => {
      world();
      const r = await patch(SUPER, to);
      expect(r.status).toBe(200);
      expect(targetRow()).toMatchObject({ role: to, status: 'active' });
      expect(mockSecurityAudit).toContainEqual(expect.objectContaining({ capability: IDENTITY_ADMIN_ASSIGN, decision: 'elevated_route_accessed', actorUserId: SUPER }));
      expect(logUserManagementAudit).toHaveBeenCalledWith('USER_ROLE_UPDATED', expect.objectContaining({ target_user_id: TARGET, role: to }));
    },
  );
});

describe('step-up failures — nothing read-for-write, nothing written', () => {
  it.each([
    ['no step-up session', SUPER_NO_STEPUP],
    ['an expired step-up session', SUPER_STALE],
    ['a TOTP (not phishing-resistant) step-up', SUPER_TOTP],
    ['a passkey step-up on an untrusted device', SUPER_UNTRUSTED],
  ])('active platform SA with %s → STEP_UP_REQUIRED, membership unchanged, no business audit', async (_d, who) => {
    world();
    const r = await patch(who, 'VIEW_ONLY');
    expect([401, 403]).toContain(r.status);
    expect(r.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });
});

describe('unauthorized callers — a company-scoped role check never authorizes a role change', () => {
  it.each([
    ['an active COMPANY_ADMIN of the company (passkey + trusted device)', CADMIN],
    ['an active legacy ADMIN of the company (passkey + trusted device)', LEGACY_ADMIN],
    ['a VIEW_ONLY member holding a DIRECT identity.admin.assign grant (passkey + trusted device)', GRANTEE],
    ['an INVITED SUPER_ADMIN membership', INVITED_SA],
    ['an INACTIVE SUPER_ADMIN membership', INACTIVE_SA],
  ])('%s → 403, membership unchanged', async (_d, who) => {
    world();
    const r = await patch(who, 'VIEW_ONLY');
    expect(r.status).toBe(403);
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
    expect(logUserManagementAudit).not.toHaveBeenCalled();
    expect(mockSecurityAudit.some((e) => e.decision === 'elevated_route_accessed')).toBe(false);
  });

  it('unauthenticated → 401, membership unchanged', async () => {
    world();
    const r = await patch(null, 'VIEW_ONLY');
    expect(r.status).toBe(401);
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('a company admin of A cannot change a member of B (403), even naming B', async () => {
    world();
    rows('user_company_roles').push({ id: 'ucr-tb', user_id: 'u-target-b', company_id: CO_B, role: 'CONTENT_CREATOR', status: 'active' });
    const r = await patch(CADMIN, 'VIEW_ONLY', CO_B, 'u-target-b');
    expect(r.status).toBe(403);
    expect(rows('user_company_roles').find((x) => x.user_id === 'u-target-b')).toMatchObject({ role: 'CONTENT_CREATOR' });
  });
});

describe('SUPER_ADMIN assignment and revocation stay on the governed paths', () => {
  it.each(['SUPER_ADMIN', 'super_admin', 'Super Admin'])('assigning %s (stepped-up active SA) → 403 SUPER_ADMIN_NOT_ASSIGNABLE_HERE; unchanged', async (to) => {
    world();
    const r = await patch(SUPER, to);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_NOT_ASSIGNABLE_HERE' });
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
  });

  it.each(['active', 'invited', 'inactive', 'expired'])('revoking (rewriting) a %s SUPER_ADMIN membership → 403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE; unchanged', async (status) => {
    world({ role: 'SUPER_ADMIN', status });
    const r = await patch(SUPER, 'CONTENT_CREATOR');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(targetRow()).toMatchObject({ role: 'SUPER_ADMIN', status });
  });
});

describe('membership state and role vocabulary — fail closed before any write', () => {
  it.each(['invited', 'inactive', 'expired'])('a %s target membership → 409 STALE_MEMBERSHIP; unchanged', async (status) => {
    world({ role: 'CONTENT_CREATOR', status });
    const r = await patch(SUPER, 'VIEW_ONLY');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'STALE_MEMBERSHIP' });
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR', status });
  });

  it('no membership in the company → 404 USER_ROLE_NOT_FOUND', async () => {
    world(null);
    const r = await patch(SUPER, 'VIEW_ONLY');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'USER_ROLE_NOT_FOUND' });
  });

  it.each(['OWNER', 'CONTENT_ARCHITECT', 'COMPANYADMIN', ' VIEW_ONLY '])('unsupported role %j → 400 UNSUPPORTED_ROLE with the accepted list; unchanged', async (to) => {
    world();
    const r = await patch(SUPER, to);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'UNSUPPORTED_ROLE', allowedRoles: [...INVITABLE_ROLES] });
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR' });
  });

  it('a membership lookup failure fails CLOSED (never 200, nothing written)', async () => {
    world();
    failTable('user_company_roles');
    const r = await patch(SUPER, 'VIEW_ONLY');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(logUserManagementAudit).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/users/invite — RETIRED (Closure-015I, F-3); the 015E bypass stays closed', () => {
  // Closure-015E gated this route on IDENTITY_ADMIN_ASSIGN because its existing-member branch was
  // a role change. Closure-015I retired the route (the /admin/users page uses the governed POST
  // /api/admin/invite-user), so it can neither invite nor change a role, step-up or not.
  const invite = (who: string | null, email: string, roleName: string) =>
    invoke(inviteRoute as never, { method: 'POST', body: { email, companyId: CO_A, role: roleName }, headers: who ? { 'x-test-user': who } : {} });

  it.each([['stepped-up', SUPER], ['no step-up', SUPER_NO_STEPUP]])('active platform SA (%s) → 410 ENDPOINT_RETIRED; no user created', async (_d, who) => {
    world();
    const r = await invite(who, 'new@example.test', 'VIEW_ONLY');
    expect(r.status).toBe(410);
    expect(r.body).toEqual({ error: 'ENDPOINT_RETIRED', replacement: '/api/admin/invite-user' });
    expect(rows('users').some((u) => u.email === 'new@example.test')).toBe(false);
  });

  it('THE BYPASS CLOSED: an existing active member role cannot be changed through /api/users/invite (retired)', async () => {
    world();
    const r = await invite(SUPER, 'target@example.test', 'COMPANY_ADMIN');
    expect(r.status).toBe(410);
    expect(targetRow()).toMatchObject({ role: 'CONTENT_CREATOR', status: 'active' });
  });

  it.each([['active COMPANY_ADMIN', CADMIN], ['VIEW_ONLY with a direct identity.admin.assign grant', GRANTEE], ['invited SUPER_ADMIN', INVITED_SA]])('%s → 403 (withRBAC still guards the retired route); no user created', async (_d, who) => {
    world();
    const r = await invite(who, 'new@example.test', 'VIEW_ONLY');
    expect(r.status).toBe(403);
    expect(rows('users').some((u) => u.email === 'new@example.test')).toBe(false);
  });
});
