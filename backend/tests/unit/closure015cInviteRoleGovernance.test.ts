/**
 * Closure-015C (Closure-015B P2, P3, P7, T7–T11) — membership-writer role governance.
 *
 * Established policy this file holds the code to: a SUPER_ADMIN membership is
 * GRANTED only through `identity.admin.assign` and REVOKED only through
 * `identity.admin.revoke` — governed, platform-tier, step-up-required paths
 * (pages/api/admin/invite-user.ts, pages/api/admin/revoke-super-admin.ts,
 * Closure-014 grant governance). No other membership writer may create, mint or
 * rewrite one.
 *
 * Part 1 — userManagementService.inviteUser (`/api/users/invite`): FIXED here.
 * Part 2 — company/users/reinvite.ts and invitation acceptance: NOT remediated
 * in this phase (owner decision 4). Their defects are pinned with `test.failing`
 * — each test states the CORRECT behaviour, so it passes while the defect
 * exists and fails once the fix lands (convert it to a plain test then).
 *
 * REAL: inviteUser + requireUserAdminAccess (isSuperAdmin/getUserRole over the
 * routeAuthHarness in-memory user_company_roles), and the reinvite route's own
 * authorization, role preservation and writes. MOCKED: authentication, the
 * company-context guard, email sending, the audit logger. In-memory: the fake
 * database does not apply column DEFAULTs (e.g. invitations.role), so the
 * acceptance-time demotion is evidenced by the insert payload, not by a row.
 */
import { seed, rows, invoke, CO_A, CO_B, USER_A, USER_SUPER } from '../helpers/routeAuthHarness';
import { USER_INVITED, USER_EXSUPER, userForRequest, bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/campaignAuditService', () => ({ logUserManagementAudit: jest.fn() }));
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: jest.fn(async () => 'person-1') }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: jest.fn(async (req: unknown) => {
    const u = require('../helpers/sec91AHarness').userForRequest(req);
    return u ? { user: { id: u.id, email: u.email, status: 'active' }, error: null } : { user: null, error: 'NO_TOKEN' };
  }),
}));
jest.mock('../../services/companyContextGuardService', () => ({
  requireCompanyContext: jest.fn(async ({ companyId }: { companyId: string }) => ({ companyId })),
}));
jest.mock('../../services/emailService', () => ({ sendInvite: jest.fn(async () => undefined) }));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'http://localhost:3000' }));

import { inviteUser } from '../../services/userManagementService';
import reinviteRoute from '../../../pages/api/company/users/reinvite';

const TARGET = 'user-t-00-0000-0000-0000000000t1';
const TARGET_EMAIL = 'target@example.test';

function world(targetRow?: Record<string, unknown>) {
  seed({
    users: [
      { id: USER_A, email: 'a@example.test' },
      { id: USER_SUPER, email: 's@example.test' },
      { id: TARGET, email: TARGET_EMAIL },
    ],
    user_company_roles: [
      { user_id: USER_INVITED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'invited' },
      ...(targetRow ? [{ user_id: TARGET, company_id: CO_A, ...targetRow }] : []),
    ],
    invitations: [],
  });
}
const membership = (userId: string, companyId = CO_A) =>
  rows('user_company_roles').filter((r) => r.user_id === userId && r.company_id === companyId);
const asRequester = (userId: string) => ({ userId } as never);

describe('Part 1 — inviteUser never grants, mints or rewrites a SUPER_ADMIN membership (FIXED)', () => {
  it.each(['SUPER_ADMIN', 'super_admin', 'Super_Admin'])('T11 requested role %s → 403, no user created, no membership written', async (role) => {
    world();
    const r = await inviteUser('new-person@example.test', CO_A, role, asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: false, status: 403, error: 'SUPER_ADMIN_NOT_ASSIGNABLE_HERE' });
    expect(rows('users').some((u) => u.email === 'new-person@example.test')).toBe(false);
  });

  it('T11 an ACTIVE member cannot be turned into an active SUPER_ADMIN (the P3 bypass)', async () => {
    world({ role: 'VIEW_ONLY', status: 'active' });
    const r = await inviteUser(TARGET_EMAIL, CO_A, 'SUPER_ADMIN', asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'VIEW_ONLY', status: 'active' })]);
  });

  it('an existing SUPER_ADMIN membership cannot be rewritten here (revocation has its own governed path)', async () => {
    world({ role: 'SUPER_ADMIN', status: 'active' });
    const r = await inviteUser(TARGET_EMAIL, CO_A, 'CONTENT_CREATOR', asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: false, status: 403, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN', status: 'active' })]);
  });

  it.each(['CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_CREATOR', 'CONTENT_ENGAGER', 'ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'])(
    'legitimate workflow kept: role %s (incl. the /admin/users legacy vocabulary) is still invitable',
    async (role) => {
      world();
      const r = await inviteUser('new-person@example.test', CO_A, role, asRequester(USER_SUPER));
      expect(r).toMatchObject({ ok: true, role: role.toUpperCase() });
    },
  );

  it('legitimate workflow kept: an existing non-SUPER_ADMIN member\'s role can still be changed', async () => {
    world({ role: 'VIEW_ONLY', status: 'active' });
    const r = await inviteUser(TARGET_EMAIL, CO_A, 'CONTENT_CREATOR', asRequester(USER_SUPER));
    expect(r).toMatchObject({ ok: true });
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'CONTENT_CREATOR', status: 'active' })]);
  });

  it('unchanged authorization: an active COMPANY_ADMIN is still refused (route is effectively active-SA only)', async () => {
    world();
    const r = await inviteUser('new-person@example.test', CO_A, 'VIEW_ONLY', asRequester(USER_A));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('unchanged authorization: an INVITED SUPER_ADMIN membership grants nothing here', async () => {
    world();
    const r = await inviteUser('new-person@example.test', CO_A, 'VIEW_ONLY', asRequester(USER_INVITED));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

// Closure-015D remediated reinvite (Workstream C): T7–T9 were `test.failing` pins
// and are now plain tests; closure015dReinviteAcceptanceExpiry covers acceptance.
describe('Part 2 — reinvite and acceptance (Closure-015D: FIXED)', () => {
  const reinvite = (who: 'A' | 'SUPER', email = TARGET_EMAIL, companyId = CO_A) =>
    invoke(reinviteRoute as never, { method: 'POST', body: { email, companyId }, headers: bearer(who) });

  it('harness fidelity: an active COMPANY_ADMIN of the company IS authorized to reinvite (real isActorAuthorized)', async () => {
    world({ role: 'CONTENT_CREATOR', status: 'inactive' });
    const r = await reinvite('A');
    expect(r.status).toBe(200);
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'CONTENT_CREATOR', status: 'invited' })]);
  });

  it('T7 a company admin\'s reinvite never yields an invited SUPER_ADMIN membership (deactivated former SA)', async () => {
    world({ role: 'SUPER_ADMIN', status: 'inactive' });
    const r = await reinvite('A');
    // Correct behaviour: refused, or the role is not preserved as SUPER_ADMIN.
    const rowsNow = membership(TARGET);
    expect(r.status === 200 && rowsNow.some((x) => x.role === 'SUPER_ADMIN' && x.status === 'invited')).toBe(false);
  });

  it('T8 reinvite never removes an ACTIVE platform super admin\'s membership', async () => {
    world({ role: 'SUPER_ADMIN', status: 'active' });
    await reinvite('A');
    expect(membership(TARGET)).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN', status: 'active' })]);
  });

  it('T9 (P7) the reinvite invitation carries the role the membership keeps (else acceptance demotes it)', async () => {
    world({ role: 'COMPANY_ADMIN', status: 'inactive' });
    const r = await reinvite('A');
    expect(r.status).toBe(200);
    const inv = rows('invitations').find((i) => i.email === TARGET_EMAIL);
    // Acceptance applies invitation.role (team/accept-invite.ts:153; RPC activate_invitation_membership
    // ON CONFLICT … role = EXCLUDED.role). Today the insert omits role, so the DB default CONTENT_CREATOR
    // (invitations.role) applies — static evidence; the fake DB does not apply defaults.
    expect(inv?.role).toBe('COMPANY_ADMIN');
  });

  it('T10 (Closure-015E: FIXED) an invited COMPANY_ADMIN membership with NO invitation row grants nothing', async () => {
    world({ role: 'COMPANY_ADMIN', status: 'invited' });
    const rbac = jest.requireActual('../../services/rbacService');
    expect(rows('invitations')).toHaveLength(0); // no unexpired invitation backs it
    // Closure-015C characterized this as still granting COMPANY_ADMIN; 015E removed the invited fallback.
    expect((await rbac.getUserRole(TARGET, CO_A)).role).toBeNull();
  });

  it('cross-company: a company admin of A cannot reinvite into B (unchanged)', async () => {
    world();
    const r = await reinvite('A', TARGET_EMAIL, CO_B);
    expect(r.status).toBe(403);
    expect(membership(TARGET, CO_B)).toHaveLength(0);
  });

  it('fixture sanity', () => {
    expect(userForRequest({ headers: bearer('A') })?.id).toBe(USER_A);
    expect(USER_EXSUPER).toBeTruthy();
  });
});
