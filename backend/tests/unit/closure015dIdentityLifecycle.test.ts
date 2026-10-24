/**
 * Closure-015D (Workstreams B, C, D) — invitation role governance, reinvitation
 * of privileged users, acceptance consistency, invitation expiry, and the
 * authority of INVITED memberships.
 *
 *   B  /api/users/invite (inviteUser): accepts exactly the server Role
 *      vocabulary minus SUPER_ADMIN; anything else fails closed (400
 *      UNSUPPORTED_ROLE, nothing written) and the response names the accepted
 *      roles; SUPER_ADMIN grant/rewrite stays refused (403, Closure-015C).
 *   C  /api/company/users/reinvite: never grants, restores or removes a
 *      SUPER_ADMIN membership (403 SUPER_ADMIN_NOT_REINVITABLE, nothing
 *      written); the invitation carries the role acceptance activates (legacy
 *      names mapped by normalizeRole onto invitations_role_check); a role with
 *      no mapping fails closed (409 ROLE_NOT_REINVITABLE).
 *      Acceptance (/api/team/accept-invite) activates exactly invitation.role;
 *      an expired or revoked invitation is refused and changes nothing.
 *   D  an INVITED SUPER_ADMIN row confers nothing before acceptance in
 *      getUserRole / withRBAC, enforceCompanyAccess and resolveCompanyAccess;
 *      the invited COMPANY_ADMIN fallback is unchanged (owner decision).
 *
 * REAL: inviteUser + requireUserAdminAccess, the invite / reinvite /
 * accept-invite routes, withRBAC → enforceRole → getUserRole,
 * enforceCompanyAccess (TenantGuard), resolveCompanyAccess — over the
 * routeAuthHarness in-memory tables. MOCKED: authentication (bearer / x-test-user),
 * the company-context guard, email sending (captures the invite URL), audit sinks.
 * In-memory limits: column DEFAULTs and CHECK constraints are NOT applied, and
 * `.or()` filters are not evaluated (accept-invite's users lookup returns the
 * first users row — each acceptance test seeds only the accepting user).
 */
import { seed, rows, invoke, failTable, CO_A, CO_B, USER_A, USER_SUPER } from '../helpers/routeAuthHarness';
import { USER_INVITED, bearer } from '../helpers/sec91AHarness';

const mockSentInvites: { email: string; url: string }[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../services/campaignAuditService', () => ({ logUserManagementAudit: jest.fn() }));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: jest.fn(async () => undefined), SYSTEM_USER_ID: 'system' }));
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: jest.fn(async () => 'person-1') }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: jest.fn(async (req: { headers?: Record<string, unknown> }) => {
    const direct = req?.headers?.['x-test-user'];
    if (typeof direct === 'string' && direct) {
      const email = String(req?.headers?.['x-test-email'] ?? `${direct}@example.test`);
      return { user: { id: direct, supabaseUid: `sb-${direct}`, email, status: 'active' }, error: null };
    }
    const u = require('../helpers/sec91AHarness').userForRequest(req);
    return u ? { user: { id: u.id, supabaseUid: `sb-${u.id}`, email: u.email, status: 'active' }, error: null } : { user: null, error: 'NO_TOKEN' };
  }),
}));
jest.mock('../../services/companyContextGuardService', () => ({
  requireCompanyContext: jest.fn(async ({ companyId }: { companyId: string }) => ({ companyId })),
}));
jest.mock('../../services/emailService', () => ({
  sendInvite: jest.fn(async (email: string, url: string) => { mockSentInvites.push({ email, url }); }),
}));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'http://localhost:3000' }));
// Closure-015E added the IDENTITY_ADMIN_ASSIGN step-up gate to /api/users/invite. The
// "through the route" tests below check response shapes and withRBAC refusals; the gate
// itself (step-up, platform authority) is proven through the real chain in
// closure015eRolePatchStepUp. Stubbed here, as in the functional suites.
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'test-actor' } }),
}));

import { inviteUser, INVITABLE_ROLES } from '../../services/userManagementService';
import inviteRoute from '../../../pages/api/users/invite';
import reinviteRoute from '../../../pages/api/company/users/reinvite';
import acceptInviteRoute from '../../../pages/api/team/accept-invite';
import { Role } from '../../services/rbacPrimitives';

const TARGET = 'user-t-00-0000-0000-0000000000t1';
const TARGET_EMAIL = 'target@example.test';
const asRequester = (userId: string) => ({ userId } as never);
const membership = (userId: string, companyId = CO_A) =>
  rows('user_company_roles').filter((r) => r.user_id === userId && r.company_id === companyId);

function world(targetRow?: Record<string, unknown>, extraRoles: Record<string, unknown>[] = []) {
  seed({
    users: [
      { id: USER_A, email: 'a@example.test' },
      { id: USER_SUPER, email: 's@example.test' },
      { id: TARGET, email: TARGET_EMAIL },
    ],
    user_company_roles: [
      { user_id: USER_INVITED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'invited' },
      ...(targetRow ? [{ user_id: TARGET, company_id: CO_A, ...targetRow }] : []),
      ...extraRoles,
    ],
    invitations: [],
  });
}
beforeEach(() => { mockSentInvites.length = 0; });

// ─────────────────────────────────────────────────────────────────────────────
describe('B — /api/users/invite role vocabulary', () => {
  it('the accepted vocabulary is exactly the server Role set minus SUPER_ADMIN (incl. every /admin/users legacy name)', () => {
    expect([...INVITABLE_ROLES].sort()).toEqual(Object.values(Role).filter((r) => r !== 'SUPER_ADMIN').sort());
    for (const legacy of ['CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_CREATOR', 'CONTENT_ENGAGER', 'ADMIN']) {
      expect(INVITABLE_ROLES).toContain(legacy);
    }
    expect(INVITABLE_ROLES).not.toContain('SUPER_ADMIN');
  });

  it.each([...Object.values(Role).filter((r) => r !== 'SUPER_ADMIN')])('supported role %s → invited, stored as that name', async (role) => {
    world();
    const r = await inviteUser('new-person@example.test', CO_A, role, asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: true, role });
    expect(rows('user_company_roles').some((x) => x.role === role && x.user_id !== USER_INVITED)).toBe(true);
  });

  it('a supported role in lower case is accepted and stored canonically upper-cased (unchanged behaviour)', async () => {
    world();
    expect(await inviteUser('new-person@example.test', CO_A, 'view_only', asRequester(USER_SUPER))).toMatchObject({ ok: true, role: 'VIEW_ONLY' });
  });

  it.each([
    ['an unknown name', 'OWNER'],
    ['a platform-only role outside the Role vocabulary', 'CONTENT_ARCHITECT'],
    ['an alias spelling normalizeRole would tolerate', 'COMPANYADMIN'],
    ['a spaced alias', 'content creator'],
    ['padding around a valid name', ' VIEW_ONLY '],
    ['an injection-shaped value', "VIEW_ONLY' OR '1'='1"],
  ])('%s (%j) → 400 UNSUPPORTED_ROLE with the accepted list; no user, membership or audit written', async (_d, role) => {
    world();
    const before = rows('user_company_roles').length;
    const r = await inviteUser('new-person@example.test', CO_A, role, asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: false, status: 400, error: 'UNSUPPORTED_ROLE', allowedRoles: INVITABLE_ROLES });
    expect(rows('users').some((u) => u.email === 'new-person@example.test')).toBe(false);
    expect(rows('user_company_roles')).toHaveLength(before);
  });

  it('SUPER_ADMIN is still refused as 403 SUPER_ADMIN_NOT_ASSIGNABLE_HERE (not as an unsupported name)', async () => {
    world();
    expect(await inviteUser('new-person@example.test', CO_A, 'SUPER_ADMIN', asRequester(USER_SUPER)))
      .toMatchObject({ ok: false, status: 403, error: 'SUPER_ADMIN_NOT_ASSIGNABLE_HERE' });
  });

  it('an unsupported role on an EXISTING member changes nothing', async () => {
    world({ role: 'VIEW_ONLY', status: 'active' });
    expect(await inviteUser(TARGET_EMAIL, CO_A, 'OWNER', asRequester(USER_SUPER))).toMatchObject({ ok: false, status: 400 });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'VIEW_ONLY', status: 'active' })]);
  });

  describe('through the route', () => {
    const post = (who: 'SUPER' | 'A' | 'INVITED', role: string) =>
      invoke(inviteRoute as never, { method: 'POST', body: { email: 'new-person@example.test', companyId: CO_A, role }, headers: bearer(who) });

    // Closure-015I (F-3): POST /api/users/invite is RETIRED — the /admin/users page now uses
    // the governed POST /api/admin/invite-user. The role-vocabulary rules above remain pinned
    // at the service level (inviteUser); through the route every role now answers 410.
    it.each(['OWNER', 'SUPER_ADMIN', 'CONTENT_MANAGER', 'VIEW_ONLY'])('role %s → 410 ENDPOINT_RETIRED; no user created (Closure-015I)', async (role) => {
      world();
      const r = await post('SUPER', role);
      expect(r.status).toBe(410);
      expect(r.body).toEqual({ error: 'ENDPOINT_RETIRED', replacement: '/api/admin/invite-user' });
      expect(rows('users').some((u) => u.email === 'new-person@example.test')).toBe(false);
    });

    it('an INVITED SUPER_ADMIN of the company is refused before the service (Closure-015D, withRBAC)', async () => {
      world();
      const r = await post('INVITED', 'VIEW_ONLY');
      expect(r.status).toBe(403);
      expect(rows('users').some((u) => u.email === 'new-person@example.test')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — reinvitation of privileged users', () => {
  const reinvite = (who: 'A' | 'SUPER', companyId = CO_A) =>
    invoke(reinviteRoute as never, { method: 'POST', body: { email: TARGET_EMAIL, companyId }, headers: bearer(who) });
  const invitationFor = () => rows('invitations').filter((i) => i.email === TARGET_EMAIL);

  it.each([
    ['a deactivated (inactive) former SUPER_ADMIN', 'inactive'],
    ['an INVITED SUPER_ADMIN', 'invited'],
    ['an ACTIVE platform SUPER_ADMIN', 'active'],
    ['an expired SUPER_ADMIN row', 'expired'],
  ])('%s → 403 SUPER_ADMIN_NOT_REINVITABLE; membership untouched, no invitation, no email', async (_d, status) => {
    for (const who of ['A', 'SUPER'] as const) {
      world({ role: 'SUPER_ADMIN', status });
      const r = await reinvite(who);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: 'SUPER_ADMIN_NOT_REINVITABLE' });
      expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN', status })]);
      expect(invitationFor()).toHaveLength(0);
      expect(mockSentInvites).toHaveLength(0);
    }
  });

  it.each([
    ['COMPANY_ADMIN', 'COMPANY_ADMIN'],
    ['ADMIN', 'COMPANY_ADMIN'],
    ['CONTENT_MANAGER', 'CONTENT_CREATOR'],
    ['CONTENT_PLANNER', 'CONTENT_CREATOR'],
    ['CONTENT_CREATOR', 'CONTENT_CREATOR'],
    ['CONTENT_REVIEWER', 'CONTENT_REVIEWER'],
    ['CONTENT_PUBLISHER', 'CONTENT_PUBLISHER'],
    ['CONTENT_ENGAGER', 'VIEW_ONLY'],
    ['VIEWER', 'VIEW_ONLY'],
    ['VIEW_ONLY', 'VIEW_ONLY'],
  ])('a former %s → invited membership keeps its role; the invitation carries %s (an invitations_role_check value)', async (held, expected) => {
    world({ role: held, status: 'inactive' });
    const r = await reinvite('A');
    expect(r.status).toBe(200);
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: held, status: 'invited' })]);
    expect(invitationFor()).toEqual([expect.objectContaining({ role: expected })]);
    expect(['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY']).toContain(expected);
  });

  it('a brand-new person → CONTENT_CREATOR membership and a CONTENT_CREATOR invitation (unchanged default, now explicit)', async () => {
    world();
    const r = invoke(reinviteRoute as never, { method: 'POST', body: { email: 'fresh@example.test', companyId: CO_A }, headers: bearer('A') });
    expect((await r).status).toBe(200);
    expect(rows('invitations')).toEqual([expect.objectContaining({ email: 'fresh@example.test', role: 'CONTENT_CREATOR' })]);
  });

  it('a held role with no invitation mapping (CONTENT_ARCHITECT) → 409 ROLE_NOT_REINVITABLE; nothing written', async () => {
    world({ role: 'CONTENT_ARCHITECT', status: 'inactive' });
    const r = await reinvite('A');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'ROLE_NOT_REINVITABLE' });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'CONTENT_ARCHITECT', status: 'inactive' })]);
    expect(invitationFor()).toHaveLength(0);
    expect(mockSentInvites).toHaveLength(0);
  });

  it('unchanged authorization: a company admin of A cannot reinvite into B', async () => {
    world();
    const r = await reinvite('A', CO_B);
    expect(r.status).toBe(403);
    expect(membership(TARGET, CO_B)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — acceptance activates exactly the invitation role; expiry and revocation fail closed', () => {
  /** Reinvite TARGET (held role) as company admin A, then return the raw token from the sent email. */
  async function reinviteAndCaptureToken(held: string): Promise<string> {
    world({ role: held, status: 'inactive' });
    const r = await invoke(reinviteRoute as never, { method: 'POST', body: { email: TARGET_EMAIL, companyId: CO_A }, headers: bearer('A') });
    expect(r.status).toBe(200);
    const url = mockSentInvites.at(-1)?.url ?? '';
    const token = new URL(url).searchParams.get('token');
    if (!token) throw new Error('no token in the invite email');
    // accept-invite's users lookup uses .or() (not evaluated by the fake): leave only the acceptor.
    const users = rows('users');
    users.splice(0, users.length, { id: TARGET, email: TARGET_EMAIL, status: 'active', active_company_id: CO_A });
    return token;
  }
  const accept = (token: string) =>
    invoke(acceptInviteRoute as never, { method: 'POST', body: { token }, headers: { 'x-test-user': TARGET, 'x-test-email': TARGET_EMAIL } });

  it.each([
    ['COMPANY_ADMIN', 'COMPANY_ADMIN'],
    ['ADMIN', 'COMPANY_ADMIN'],
    ['CONTENT_REVIEWER', 'CONTENT_REVIEWER'],
    ['VIEWER', 'VIEW_ONLY'],
  ])('a re-invited former %s accepts → ACTIVE %s (no silent demotion to CONTENT_CREATOR)', async (held, expected) => {
    const token = await reinviteAndCaptureToken(held);
    const r = await accept(token);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ companyId: CO_A, role: expected });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: expected, status: 'active' })]);
    const inv = rows('invitations').find((i) => i.email === TARGET_EMAIL);
    expect(inv?.role).toBe(expected);
    expect(inv?.accepted_at).toBeTruthy();
  });

  it('an EXPIRED invitation → 404; the membership stays invited and the invitation unaccepted', async () => {
    const token = await reinviteAndCaptureToken('COMPANY_ADMIN');
    const inv = rows('invitations').find((i) => i.email === TARGET_EMAIL) as Record<string, unknown>;
    inv.expires_at = new Date(Date.now() - 60_000).toISOString();
    const r = await accept(token);
    expect(r.status).toBe(404);
    expect(String(r.body.error)).toMatch(/expired/i);
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'COMPANY_ADMIN', status: 'invited' })]);
    expect(inv.accepted_at ?? null).toBeNull();
  });

  it('a REVOKED invitation (superseded by a newer reinvite) → 404; nothing activated', async () => {
    const first = await reinviteAndCaptureToken('CONTENT_REVIEWER');
    // second reinvite revokes the first invitation (createInvitationToken)
    rows('users').push({ id: USER_A, email: 'a@example.test' });
    await invoke(reinviteRoute as never, { method: 'POST', body: { email: TARGET_EMAIL, companyId: CO_A }, headers: bearer('A') });
    const users = rows('users');
    users.splice(0, users.length, { id: TARGET, email: TARGET_EMAIL, status: 'active', active_company_id: CO_A });
    const r = await accept(first);
    expect(r.status).toBe(404);
    expect(membership(TARGET).every((m) => m.status !== 'active')).toBe(true);
  });

  it('a different signed-in email cannot accept → 403; nothing activated', async () => {
    const token = await reinviteAndCaptureToken('COMPANY_ADMIN');
    const r = await invoke(acceptInviteRoute as never, { method: 'POST', body: { token }, headers: { 'x-test-user': TARGET, 'x-test-email': 'someone-else@example.test' } });
    expect(r.status).toBe(403);
    expect(membership(TARGET)).toEqual([expect.objectContaining({ status: 'invited' })]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D — invited memberships before acceptance', () => {
  it('getUserRole: an INVITED SUPER_ADMIN row → no role (was SUPER_ADMIN before Closure-015D)', async () => {
    world();
    const rbac = jest.requireActual('../../services/rbacService');
    expect((await rbac.getUserRole(USER_INVITED, CO_A)).role).toBeNull();
    expect(await rbac.isPlatformSuperAdmin(USER_INVITED)).toBe(false);
  });

  it('getUserRole: the invited COMPANY_ADMIN / ADMIN fallback is REMOVED (Closure-015E; was unchanged in 015D)', async () => {
    const rbac = jest.requireActual('../../services/rbacService');
    for (const held of ['COMPANY_ADMIN', 'ADMIN']) {
      world({ role: held, status: 'invited' });
      expect((await rbac.getUserRole(TARGET, CO_A)).role).toBeNull();
    }
    world({ role: 'CONTENT_CREATOR', status: 'invited' });
    expect((await rbac.getUserRole(TARGET, CO_A)).role).toBeNull();
  });

  it('getUserRole: inactive and expired SUPER_ADMIN rows confer nothing (unchanged)', async () => {
    const rbac = jest.requireActual('../../services/rbacService');
    for (const status of ['inactive', 'expired']) {
      world({ role: 'SUPER_ADMIN', status });
      expect((await rbac.getUserRole(TARGET, CO_A)).role).toBeNull();
    }
  });

  it('getUserRole: an active SUPER_ADMIN membership in the company still resolves to SUPER_ADMIN (unchanged)', async () => {
    world({ role: 'SUPER_ADMIN', status: 'active' });
    const rbac = jest.requireActual('../../services/rbacService');
    expect((await rbac.getUserRole(TARGET, CO_A)).role).toBe('SUPER_ADMIN');
  });

  it('getUserRole: a membership lookup error confers nothing (fail closed, unchanged)', async () => {
    world({ role: 'COMPANY_ADMIN', status: 'invited' });
    failTable('user_company_roles');
    const rbac = jest.requireActual('../../services/rbacService');
    expect((await rbac.getUserRole(TARGET, CO_A)).role).toBeNull();
  });

  it('enforceCompanyAccess: an INVITED SUPER_ADMIN of A is refused for A', async () => {
    world();
    const { enforceCompanyAccess } = jest.requireActual('../../services/userContextService');
    const r = await invoke(async (req: never, res: never) => {
      const ctx = await enforceCompanyAccess({ req, res, companyId: CO_A });
      if (ctx) (res as { status: (n: number) => { json: (b: unknown) => void } }).status(200).json({ ok: true });
    }, { method: 'GET', query: { companyId: CO_A }, headers: bearer('INVITED') });
    expect(r.status).toBe(403);
  });

  it('resolveCompanyAccess: an INVITED SUPER_ADMIN of A is refused for A', async () => {
    world();
    const { resolveCompanyAccess } = jest.requireActual('../../services/contentArchitectService');
    const r = await invoke(async (req: never, res: never) => {
      const ok = await resolveCompanyAccess(req, res, CO_A);
      if (ok) (res as { status: (n: number) => { json: (b: unknown) => void } }).status(200).json(ok);
    }, { method: 'GET', query: { companyId: CO_A }, headers: bearer('INVITED') });
    expect(r.status).toBe(403);
  });

  it('withRBAC([COMPANY_ADMIN, SUPER_ADMIN]): an INVITED SUPER_ADMIN of A is refused; an active COMPANY_ADMIN is admitted', async () => {
    world();
    const { withRBAC } = jest.requireActual('../../middleware/withRBAC');
    const h = withRBAC(async (_q: never, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(200).json({ ok: true }), ['COMPANY_ADMIN', 'SUPER_ADMIN']);
    expect((await invoke(h, { method: 'GET', query: { companyId: CO_A }, headers: bearer('INVITED') })).status).toBe(403);
    expect((await invoke(h, { method: 'GET', query: { companyId: CO_A }, headers: bearer('A') })).status).toBe(200);
  });
});
