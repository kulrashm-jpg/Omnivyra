/**
 * Closure-015C (P1, Closure-015B T1–T6) — the five withRBAC([SUPER_ADMIN])
 * routes whose effect is platform-wide or cross-tenant must require ACTIVE
 * platform super-admin authority.
 *
 * withRBAC → enforceRole admits two principals for [SUPER_ADMIN]: an active
 * platform super admin (hasActiveSuperAdminRow bypass) and — through
 * getUserRole's invited-admin fallback — a user whose SUPER_ADMIN membership in
 * the requested companyId is only INVITED. The second is company-scoped, yet
 * these handlers act on the global governance lock, on any tenant's snapshot or
 * campaign, on every company's slots, and on the platform health report.
 *
 * REAL: the routes, withRBAC, enforceRole, getUserRole, isPlatformSuperAdmin
 * (hasActiveSuperAdminRow) — all over the routeAuthHarness in-memory
 * user_company_roles. SPIED: only each route's effect service, so a refused
 * call is shown never to reach its effect. In-memory: proves the routes'
 * authorization decisions, not Postgres/PostgREST behaviour.
 */
import { seed, invoke, CO_A, CO_B, USER_SUPER, CAMPAIGN_B } from '../helpers/routeAuthHarness';
import { bearer, USER_EXSUPER, USER_INVITED } from '../helpers/sec91AHarness';

const mockEffects = {
  releaseGovernanceLock: jest.fn(async () => undefined),
  restoreGovernanceSnapshot: jest.fn(async () => ({ restored: true })),
  rebuildGovernanceProjection: jest.fn(async () => undefined),
  runOpportunitySlotsScheduler: jest.fn(async () => ({ reopened: 0, companiesProcessed: 2, typesProcessed: 0, errors: [] })),
  getOmnivyraHealthReport: jest.fn(() => ({ enabled: false })),
};

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/GovernanceLockdownService', () => ({
  ...jest.requireActual('../../services/GovernanceLockdownService'),
  releaseGovernanceLock: (...a: unknown[]) => mockEffects.releaseGovernanceLock(...(a as [])),
}));
jest.mock('../../services/GovernanceSnapshotService', () => ({
  ...jest.requireActual('../../services/GovernanceSnapshotService'),
  restoreGovernanceSnapshot: (...a: unknown[]) => mockEffects.restoreGovernanceSnapshot(...(a as [])),
}));
jest.mock('../../services/GovernanceProjectionService', () => ({
  ...jest.requireActual('../../services/GovernanceProjectionService'),
  rebuildGovernanceProjection: (...a: unknown[]) => mockEffects.rebuildGovernanceProjection(...(a as [])),
}));
jest.mock('../../services/opportunitySlotsScheduler', () => ({
  runOpportunitySlotsScheduler: (...a: unknown[]) => mockEffects.runOpportunitySlotsScheduler(...(a as [])),
}));
jest.mock('../../services/omnivyraClientV1', () => ({
  getOmnivyraHealthReport: (...a: unknown[]) => mockEffects.getOmnivyraHealthReport(...(a as [])),
}));

import unlockRoute from '../../../pages/api/governance/unlock';
import restoreRoute from '../../../pages/api/governance/restore-snapshot';
import rebuildRoute from '../../../pages/api/governance/rebuild-projection';
import refreshSlotsRoute from '../../../pages/api/opportunities/refresh-slots';
import healthRoute from '../../../pages/api/omnivyra/health';

type Who = 'SUPER' | 'INVITED' | 'EXSUPER' | 'A';
type Case = { name: string; handler: unknown; method: 'GET' | 'POST'; body: Record<string, unknown>; effect: jest.Mock; stepUp?: boolean };

const CASES: Case[] = [
  { name: 'POST /api/governance/unlock (global governance lock)', handler: unlockRoute, method: 'POST', body: {}, effect: mockEffects.releaseGovernanceLock, stepUp: true },
  { name: 'POST /api/governance/restore-snapshot (snapshot of company B)', handler: restoreRoute, method: 'POST', body: { snapshotId: 'snap-of-company-b' }, effect: mockEffects.restoreGovernanceSnapshot, stepUp: true },
  { name: 'POST /api/governance/rebuild-projection (campaign of company B)', handler: rebuildRoute, method: 'POST', body: { campaignId: CAMPAIGN_B }, effect: mockEffects.rebuildGovernanceProjection },
  { name: 'POST /api/opportunities/refresh-slots (every company)', handler: refreshSlotsRoute, method: 'POST', body: {}, effect: mockEffects.runOpportunitySlotsScheduler },
  { name: 'GET /api/omnivyra/health (platform report)', handler: healthRoute, method: 'GET', body: {}, effect: mockEffects.getOmnivyraHealthReport },
];

/**
 * The harness world: USER_SUPER is an ACTIVE platform super admin (CO_A);
 * USER_INVITED holds a SUPER_ADMIN membership in CO_A that is only INVITED;
 * USER_EXSUPER's SUPER_ADMIN row in CO_A is INACTIVE; USER_A is an active
 * COMPANY_ADMIN of CO_A.
 */
function world() {
  seed({
    user_company_roles: [
      { user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' },
      { user_id: USER_INVITED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'invited' },
    ],
  });
}
function call(c: Case, who: Who | null, companyId: string = CO_A, extraHeaders: Record<string, string> = {}) {
  const headers = { ...(who ? bearer(who) : {}), ...extraHeaders };
  const payload = { ...c.body, companyId };
  return c.method === 'GET'
    ? invoke(c.handler as never, { method: 'GET', query: payload, headers })
    : invoke(c.handler as never, { method: 'POST', body: payload, headers });
}

beforeEach(() => {
  world();
  for (const m of Object.values(mockEffects)) m.mockClear();
  delete process.env.CRON_SECRET;
});

describe.each(CASES)('$name', (c) => {
  // Closure-015D: unlock and restore-snapshot additionally require the
  // PLATFORM_CONTROLS_MANAGE passkey step-up after this guard. This harness's
  // IdentityResolver fake carries no capabilities or step-up state, so their
  // allowed AND refused paths are proven through the real chain in
  // closure015dGlobalRouteStepUp; here only the Closure-015C guard is exercised.
  it(c.stepUp ? 'T1 active platform super admin passes the Closure-015C guard (step-up: closure015dGlobalRouteStepUp)' : 'T1 active platform super admin → allowed, effect runs once', async () => {
    if (c.stepUp) {
      const { requireActivePlatformSuperAdmin } = jest.requireActual('../../security/requireActivePlatformSuperAdmin');
      const res = { status: () => { throw new Error('guard refused an active platform super admin'); } };
      expect(await requireActivePlatformSuperAdmin({ rbac: { userId: USER_SUPER } }, res, 'probe')).toBe(true);
      return;
    }
    const r = await call(c, 'SUPER');
    expect(r.status).toBe(200);
    expect(c.effect).toHaveBeenCalledTimes(1);
  });

  it('T2 INVITED SUPER_ADMIN membership in the requested company → 403, effect never runs', async () => {
    const r = await call(c, 'INVITED', CO_A);
    expect(r.status).toBe(403);
    // Closure-015C answered at the route guard (PLATFORM_SUPER_ADMIN_REQUIRED); since
    // Closure-015D getUserRole grants an invited SUPER_ADMIN row nothing, so withRBAC
    // itself refuses first. Either refusal is before the effect.
    expect(c.effect).not.toHaveBeenCalled();
  });

  it('T2b the route guard alone refuses a principal withRBAC admitted without platform authority', async () => {
    const { requireActivePlatformSuperAdmin } = jest.requireActual('../../security/requireActivePlatformSuperAdmin');
    const out: { code?: number; body?: unknown } = {};
    const res = { status(n: number) { out.code = n; return this; }, json(b: unknown) { out.body = b; return this; } };
    expect(await requireActivePlatformSuperAdmin({ rbac: { userId: USER_INVITED } }, res, 'probe')).toBe(false);
    expect(out).toEqual({ code: 403, body: { error: 'Forbidden', code: 'PLATFORM_SUPER_ADMIN_REQUIRED', operation: 'probe' } });
  });

  it('T3 inactive (deactivated) SUPER_ADMIN row → 403, effect never runs', async () => {
    const r = await call(c, 'EXSUPER', CO_A);
    expect(r.status).toBe(403);
    expect(c.effect).not.toHaveBeenCalled();
  });

  it('T4 active COMPANY_ADMIN of the requested company → 403, effect never runs', async () => {
    const r = await call(c, 'A', CO_A);
    expect(r.status).toBe(403);
    expect(c.effect).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, effect never runs', async () => {
    const r = await call(c, null, CO_A);
    expect(r.status).toBe(401);
    expect(c.effect).not.toHaveBeenCalled();
  });
});

describe('cross-company identifiers (T5/T6): a company-scoped principal of A cannot act on B', () => {
  it.each([
    ['restore-snapshot', restoreRoute, { snapshotId: 'snap-of-company-b' }, mockEffects.restoreGovernanceSnapshot],
    ['rebuild-projection', rebuildRoute, { campaignId: CAMPAIGN_B }, mockEffects.rebuildGovernanceProjection],
  ] as const)('%s: invited SUPER_ADMIN of A with companyId=A and B\'s id → 403 before the service', async (_n, handler, body, effect) => {
    const r = await invoke(handler as never, { method: 'POST', body: { ...body, companyId: CO_A }, headers: bearer('INVITED') });
    expect(r.status).toBe(403);
    expect(effect).not.toHaveBeenCalled();
  });

  it('the active platform super admin keeps platform-wide authority (rebuild of B\'s campaign while naming company A)', async () => {
    // Closure-015D: the restore variant now needs step-up — see closure015dGlobalRouteStepUp.
    const r = await invoke(rebuildRoute as never, { method: 'POST', body: { campaignId: CAMPAIGN_B, companyId: CO_A }, headers: bearer('SUPER') });
    expect(r.status).toBe(200);
    expect(mockEffects.rebuildGovernanceProjection).toHaveBeenCalledWith(CAMPAIGN_B);
  });
});

describe('refresh-slots cron path is unchanged', () => {
  it('a valid CRON_SECRET bearer runs the scheduler without any membership', async () => {
    process.env.CRON_SECRET = 'c15c-test-cron-secret-not-real';
    const r = await invoke(refreshSlotsRoute as never, { method: 'POST', body: {}, headers: { authorization: 'Bearer c15c-test-cron-secret-not-real' } });
    expect(r.status).toBe(200);
    expect(mockEffects.runOpportunitySlotsScheduler).toHaveBeenCalledTimes(1);
  });

  it('a wrong secret falls through to withRBAC: the invited SUPER_ADMIN is still refused', async () => {
    process.env.CRON_SECRET = 'c15c-test-cron-secret-not-real';
    const r = await invoke(refreshSlotsRoute as never, { method: 'POST', body: { companyId: CO_A }, headers: bearer('INVITED') });
    expect(r.status).toBe(403);
    expect(mockEffects.runOpportunitySlotsScheduler).not.toHaveBeenCalled();
  });
});

describe('harness fidelity (the decision is the real code over the fake rows)', () => {
  it('USER_SUPER has an ACTIVE SUPER_ADMIN row; USER_INVITED only an invited one', async () => {
    const rbac = jest.requireActual('../../services/rbacService');
    expect(await rbac.isPlatformSuperAdmin(USER_SUPER)).toBe(true);
    expect(await rbac.isPlatformSuperAdmin(USER_INVITED)).toBe(false);
    // Closure-015C: this fallback returned SUPER_ADMIN (what the routes trusted); Closure-015D removed it.
    expect((await rbac.getUserRole(USER_INVITED, CO_A)).role).toBeNull();
    expect(CO_B).not.toBe(CO_A);
  });
});
