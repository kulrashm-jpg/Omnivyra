/**
 * SEC-91A (STEP 3AH-91) — A2: platform super-admin must be an ACTIVE
 * SUPER_ADMIN membership.
 *
 * THE DEFECT: rbacService.isSuperAdmin / isPlatformSuperAdmin matched any
 * user_company_roles row with role='SUPER_ADMIN', ignoring `status`. Those two
 * predicates feed the platform bypass in TenantGuard.assertTenantAccess (so
 * enforceCompanyAccess / requireCompanyAccess / requireTenantAccess),
 * enforceRole / withRBAC, requireSuperAdminUser and getUserCompanyRole. An
 * invited-but-never-accepted SUPER_ADMIN row, or a super admin whose row was
 * deactivated (user removal keeps the role and flips only the status), kept
 * cross-tenant access to every company.
 *
 * Only the database and identity provider are faked; the whole guard chain runs.
 */
import { seed, invoke, CO_A, CO_B, USER_SUPER, failTable } from '../helpers/routeAuthHarness';
import { bearer, USER_EXSUPER, USER_INVITED } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const rbac = require('../../services/rbacService');
const { enforceCompanyAccess } = require('../../services/userContextService');
const { requireSuperAdminUser } = require('../../services/requestAccessService');
const { withRBAC } = require('../../middleware/withRBAC');
/* eslint-enable @typescript-eslint/no-var-requires */

function world(exSuperStatus: string) {
  seed({
    user_company_roles: [
      // A former platform admin: the SUPER_ADMIN row survives, status does not.
      { user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: exSuperStatus },
      // A pending SUPER_ADMIN invitation that was never accepted.
      { user_id: USER_INVITED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'invited' },
    ],
  });
}

describe('rbacService super-admin predicates', () => {
  it.each(['inactive', 'deactivated', 'invited', 'pending'])('a SUPER_ADMIN row with status=%s is NOT a platform super admin', async (status) => {
    world(status);
    expect(await rbac.isSuperAdmin(USER_EXSUPER)).toBe(false);
    expect(await rbac.isPlatformSuperAdmin(USER_EXSUPER)).toBe(false);
  });

  it('an ACTIVE SUPER_ADMIN row still is (override path preserved)', async () => {
    world('inactive');
    expect(await rbac.isSuperAdmin(USER_SUPER)).toBe(true);
    expect(await rbac.isPlatformSuperAdmin(USER_SUPER)).toBe(true);
  });

  it('a lookup error fails closed (no bypass)', async () => {
    world('active');
    failTable('user_company_roles');
    expect(await rbac.isPlatformSuperAdmin(USER_SUPER)).toBe(false);
  });

  it('an empty user id is never a super admin', async () => {
    world('active');
    expect(await rbac.isPlatformSuperAdmin('')).toBe(false);
  });
});

/** Run a guard with a fake req/res; returns the guard result and the response. */
async function runGuard(fn: (req: any, res: any) => Promise<unknown>, who: Parameters<typeof bearer>[0] | null) {
  let result: unknown;
  const r = await invoke(async (req, res) => { result = await fn(req, res); }, { headers: who ? bearer(who) : {} });
  return { result, status: r.status, body: r.body };
}

describe('tenant guard platform bypass (enforceCompanyAccess → TenantGuard)', () => {
  it('unauthenticated → 401', async () => {
    world('inactive');
    const g = await runGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_B }), null);
    expect(g.result).toBeNull();
    expect(g.status).toBe(401);
  });

  it('THE EXPLOIT: a deactivated super admin can no longer open another tenant → 403', async () => {
    world('inactive');
    const g = await runGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_B }), 'EXSUPER');
    expect(g.result).toBeNull();
    expect(g.status).toBe(403);
  });

  it('an invited (never accepted) SUPER_ADMIN row gets no cross-tenant bypass → 403', async () => {
    world('inactive');
    const g = await runGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_B }), 'INVITED');
    expect(g.result).toBeNull();
    expect(g.status).toBe(403);
  });

  it('an active super admin keeps the cross-tenant override → allowed', async () => {
    world('inactive');
    const g = await runGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_B }), 'SUPER');
    expect(g.result).not.toBeNull();
    expect(g.status).toBe(200);
  });
});

describe('requireSuperAdminUser (platform-only routes)', () => {
  it('unauthenticated → 401', async () => {
    world('inactive');
    const g = await runGuard((req, res) => requireSuperAdminUser(req, res), null);
    expect(g.result).toBeNull();
    expect(g.status).toBe(401);
  });

  it('deactivated super admin → 403 SUPER_ADMIN_REQUIRED', async () => {
    world('inactive');
    const g = await runGuard((req, res) => requireSuperAdminUser(req, res), 'EXSUPER');
    expect(g.result).toBeNull();
    expect(g.status).toBe(403);
  });

  it('active super admin → allowed', async () => {
    world('inactive');
    const g = await runGuard((req, res) => requireSuperAdminUser(req, res), 'SUPER');
    expect((g.result as { id: string }).id).toBe(USER_SUPER);
  });
});

describe('withRBAC([SUPER_ADMIN]) (e.g. governance/snapshot, recommendations/simulate)', () => {
  const sink = jest.fn(async (_req: any, res: any) => res.status(200).json({ ok: true }));
  const handler = withRBAC(sink, [rbac.Role.SUPER_ADMIN]);
  beforeEach(() => sink.mockClear());

  it('deactivated super admin → 403, handler never runs', async () => {
    world('deactivated');
    const r = await invoke(handler, { method: 'POST', body: { companyId: CO_B }, headers: bearer('EXSUPER') });
    expect(r.status).toBe(403);
    expect(sink).not.toHaveBeenCalled();
  });

  it('active super admin → handler runs', async () => {
    world('deactivated');
    const r = await invoke(handler, { method: 'POST', body: { companyId: CO_B }, headers: bearer('SUPER') });
    expect(r.status).toBe(200);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('unauthenticated → 401, handler never runs', async () => {
    world('deactivated');
    const r = await invoke(handler, { method: 'POST', body: { companyId: CO_B } });
    expect(r.status).toBe(401);
    expect(sink).not.toHaveBeenCalled();
  });
});
