/**
 * Closure-015E (Workstreams 2–5).
 *
 *   2  An INVITED membership (any role, incl. COMPANY_ADMIN / ADMIN) confers no
 *      authority before acceptance — getUserRole, getCompanyRoleIncludingInvited
 *      (the fallback ~20 route-local guards use), withRBAC, enforceCompanyAccess,
 *      resolveCompanyAccess, requireCampaignAccess. Accepted (active) memberships
 *      keep their access.
 *   3  Invitation expiry: one predicate (isInvitationExpired) with the
 *      authoritative RPC semantics (expired AT expires_at) and fail-closed
 *      handling of missing / malformed values, used by team/accept-invite,
 *      auth/accept-invite and auth/set-password.
 *   4  withRBAC refuses tenant principals for a missing / non-active company
 *      (503 on a lookup error); the platform super admin keeps its bypass.
 *   5  The route-policy gate agrees with route authorization on the same rows.
 *
 * REAL: rbacService, rbacPrimitives, withRBAC, userContextService.enforceCompanyAccess
 * (TenantGuard), contentArchitectService.resolveCompanyAccess, campaignAccessService,
 * companyOperationalState, the accept-invite routes, invitationExpiry, the
 * policy gate (observePolicy → evaluatePolicy) — over the routeAuthHarness
 * in-memory tables. MOCKED: authentication (sec91AHarness bearer tokens /
 * x-test-user), IdentityResolver (built FROM the same harness rows, so the gate
 * sees exactly the memberships the routes see), the policy-gate log sink, audit
 * sinks. In-memory: no Postgres defaults / constraints / RLS.
 */
import { createHash } from 'crypto';
import { seed, rows, invoke, failTable, CO_A, CO_B, USER_A, USER_SUPER, CAMPAIGN_A } from '../helpers/routeAuthHarness';
import { bearer, USER_INVITED, USER_EXSUPER, userForRequest } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => ({
  // The gate's principal view is built from the SAME membership rows the routes read.
  resolvePrincipal: jest.fn(async (req: unknown) => {
    const u = require('../helpers/sec91AHarness').userForRequest(req);
    if (!u) return { ok: false, reason: 'NO_AUTH' };
    const all = require('../helpers/routeAuthHarness').rows('user_company_roles') as Array<Record<string, string>>;
    const organizations = all.filter((r) => r.user_id === u.id).map((r) => ({ organizationId: r.company_id, role: r.role, status: r.status }));
    return {
      ok: true,
      principal: {
        userId: u.id, supabaseUid: u.id, email: u.email, emailVerified: true, sessionId: null, sessionAgeSeconds: 0, sessionStaleSeconds: 0,
        organizations, activeOrgId: null, capabilities: [],
        mfa: { enrolled: false, factors: [], lastVerifiedAt: null, phishingResistant: false },
        device: { deviceId: null, trusted: false, fingerprint: 'f' },
        stepUp: { active: false, expiresAt: null, factor: null, sessionId: null },
        legacyCookieSuperAdmin: false,
      },
    };
  }),
}));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: jest.fn(async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    if (typeof id === 'string' && id) {
      return { user: { id, supabaseUid: `sb-${id}`, email: String(req?.headers?.['x-test-email'] ?? `${id}@example.test`), status: 'active' }, error: null };
    }
    const u = require('../helpers/sec91AHarness').userForRequest(req);
    return u ? { user: { id: u.id, supabaseUid: `sb-${u.id}`, email: u.email, status: 'active' }, error: null } : { user: null, error: 'NO_TOKEN' };
  }),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: jest.fn(async () => undefined), SYSTEM_USER_ID: 'system' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), LOGIN_LIMIT: { keyPrefix: 'rl', limit: 10, windowSecs: 60 } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { isInvitationExpired } from '../../services/invitationExpiry';
import { getCompanyRoleIncludingInvited } from '../../services/rbacPrimitives';
import { withRBAC } from '../../middleware/withRBAC';
import { Role } from '../../services/rbacService';
import { enforceCompanyAccess } from '../../services/userContextService';
import { resolveCompanyAccess } from '../../services/contentArchitectService';
import { requireCampaignAccess } from '../../services/campaignAccessService';
import teamAcceptInvite from '../../../pages/api/team/accept-invite';
import authAcceptInvite from '../../../pages/api/auth/accept-invite';
import { observePolicy } from '../../../lib/platform/policyGate';
import type { RoutePolicy } from '../../../lib/platform/routePolicy';
import { logger } from '../../services/logger';
import { requireActivePlatformSuperAdmin } from '../../security/requireActivePlatformSuperAdmin';

type Res = { status: (n: number) => { json: (b: unknown) => void } };
const ok = async (_q: unknown, res: Res) => res.status(200).json({ ok: true });

/** USER_A: active COMPANY_ADMIN of CO_A (base). USER_INVITED: membership in CO_A with the given role, INVITED. */
function world(invitedRole = 'COMPANY_ADMIN', extra: Record<string, unknown[]> = {}) {
  seed({
    user_company_roles: [{ user_id: USER_INVITED, company_id: CO_A, role: invitedRole, status: 'invited' }],
    ...(extra as Record<string, never[]>),
  });
}
const setCompany = (id: string, status: string | null) => {
  const t = rows('companies');
  const i = t.findIndex((c) => c.id === id);
  if (status === null) t.splice(i, 1); else t[i].status = status;
};
const viaWithRBAC = (who: 'A' | 'INVITED' | 'SUPER' | 'EXSUPER', roles: string[] | undefined, companyId = CO_A) =>
  invoke(withRBAC(ok as never, roles as never) as never, { method: 'GET', query: { companyId }, headers: bearer(who) });
async function viaGuard<T>(fn: (req: never, res: never) => Promise<T>, who: 'A' | 'INVITED'): Promise<{ status: number; value: T | null }> {
  let value: T | null = null;
  const r = await invoke(async (req: never, res: never) => { value = await fn(req, res); }, { method: 'GET', query: { companyId: CO_A }, headers: bearer(who) });
  return { status: r.status, value };
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('Workstream 2 — invited memberships confer no authority before acceptance', () => {
  it.each(['COMPANY_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'CONTENT_CREATOR'])('getCompanyRoleIncludingInvited: an INVITED %s row → null (the fallback ~20 route guards use)', async (r) => {
    world(r);
    expect(await getCompanyRoleIncludingInvited(USER_INVITED, CO_A)).toBeNull();
  });

  it('getCompanyRoleIncludingInvited: an ACTIVE membership still resolves (unchanged)', async () => {
    world();
    expect(await getCompanyRoleIncludingInvited(USER_A, CO_A)).toBe('COMPANY_ADMIN');
  });

  it.each([
    ['withRBAC([COMPANY_ADMIN])', [Role.COMPANY_ADMIN]],
    ['withRBAC([COMPANY_ADMIN, SUPER_ADMIN])', [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]],
    ['withRBAC(all roles)', undefined],
  ])('%s: invited COMPANY_ADMIN → 403; accepted (active) COMPANY_ADMIN → 200', async (_n, roles) => {
    world();
    expect((await viaWithRBAC('INVITED', roles as string[] | undefined)).status).toBe(403);
    expect((await viaWithRBAC('A', roles as string[] | undefined)).status).toBe(200);
  });

  it('enforceCompanyAccess (TenantGuard + legacy fallbacks): invited COMPANY_ADMIN refused; active admin admitted', async () => {
    world();
    const inv = await viaGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_A }), 'INVITED');
    expect(inv).toMatchObject({ status: 403, value: null });
    const act = await viaGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_A }), 'A');
    expect(act.value).not.toBeNull();
  });

  it('resolveCompanyAccess: invited COMPANY_ADMIN refused; active admin admitted', async () => {
    world();
    expect(await viaGuard((req, res) => resolveCompanyAccess(req, res, CO_A), 'INVITED')).toMatchObject({ status: 403, value: null });
    expect((await viaGuard((req, res) => resolveCompanyAccess(req, res, CO_A), 'A')).value).toMatchObject({ userId: USER_A, role: 'COMPANY_ADMIN' });
  });

  it('requireCampaignAccess: invited COMPANY_ADMIN refused A\'s campaign; active admin admitted', async () => {
    world();
    expect(await viaGuard((req, res) => requireCampaignAccess(req, res, CAMPAIGN_A), 'INVITED')).toMatchObject({ status: 403, value: null });
    expect((await viaGuard((req, res) => requireCampaignAccess(req, res, CAMPAIGN_A), 'A')).value).toMatchObject({ userId: USER_A, companyId: CO_A });
  });

  it('acceptance is what grants authority: the same membership, once activated (as accept-invite writes it), is admitted', async () => {
    world();
    expect((await viaWithRBAC('INVITED', [Role.COMPANY_ADMIN])).status).toBe(403);
    const row = rows('user_company_roles').find((r) => r.user_id === USER_INVITED && r.company_id === CO_A) as Record<string, unknown>;
    row.status = 'active';
    expect((await viaWithRBAC('INVITED', [Role.COMPANY_ADMIN])).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Workstream 3 — invitation expiry', () => {
  const T = Date.parse('2026-10-15T12:00:00.000Z');
  const now = new Date(T);

  describe('isInvitationExpired (RPC semantics: expires_at <= now ⇒ expired; malformed ⇒ expired)', () => {
    it.each([
      ['1 ms in the future', new Date(T + 1).toISOString(), false],
      ['7 days in the future', new Date(T + 7 * 86_400_000).toISOString(), false],
      ['exactly now (boundary)', new Date(T).toISOString(), true],
      ['1 ms in the past', new Date(T - 1).toISOString(), true],
      ['a Postgres timestamptz text in the future', '2026-10-15 12:00:01+00', false],
      ['a Date object at the boundary', new Date(T), true],
      ['null', null, true],
      ['undefined', undefined, true],
      ['empty string', '', true],
      ['whitespace', '   ', true],
      ['garbage', 'not-a-date', true],
      ['a number', T + 60_000, true],
    ])('%s → expired=%s', (_d, value, expected) => {
      expect(isInvitationExpired(value, now)).toBe(expected);
    });
  });

  describe('team/accept-invite (real route)', () => {
    const TOKEN = 'c15e-test-invite-token-not-real';
    const INVITEE = 'u-invitee';
    function inviteWorld(expires_at: unknown) {
      seed({
        invitations: [{ id: 'inv-1', email: 'invitee@example.test', company_id: CO_A, role: 'COMPANY_ADMIN', token_hash: createHash('sha256').update(TOKEN).digest('hex'), expires_at, accepted_at: null, revoked_at: null }],
        users: [{ id: INVITEE, email: 'invitee@example.test', status: 'active', active_company_id: CO_A }],
        user_company_roles: [{ id: 'ucr-inv', user_id: INVITEE, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'invited' }],
      });
    }
    const accept = () => invoke(teamAcceptInvite as never, { method: 'POST', body: { token: TOKEN }, headers: { 'x-test-user': INVITEE, 'x-test-email': 'invitee@example.test' } });
    const membership = () => rows('user_company_roles').find((r) => r.user_id === INVITEE);
    afterEach(() => jest.useRealTimers());

    it('valid (1 s before expiry) → 200, membership activated with invitation.role', async () => {
      jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
      inviteWorld(new Date(T + 1000).toISOString());
      const r = await accept();
      expect(r.status).toBe(200);
      expect(membership()).toMatchObject({ role: 'COMPANY_ADMIN', status: 'active' });
    });

    it('boundary (expires_at === now) → 404 expired, nothing activated (was ACCEPTED with `<`)', async () => {
      jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
      inviteWorld(new Date(T).toISOString());
      const r = await accept();
      expect(r.status).toBe(404);
      expect(String(r.body.error)).toMatch(/expired/i);
      expect(membership()).toMatchObject({ status: 'invited' });
    });

    it.each([['malformed', 'not-a-date'], ['missing', null]])('%s expires_at → 404 expired, nothing activated (malformed was ACCEPTED before)', async (_d, v) => {
      inviteWorld(v);
      const r = await accept();
      expect(r.status).toBe(404);
      expect(membership()).toMatchObject({ status: 'invited' });
    });

    it('expired (1 ms past) → 404, nothing activated', async () => {
      jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
      inviteWorld(new Date(T - 1).toISOString());
      expect((await accept()).status).toBe(404);
      expect(membership()).toMatchObject({ status: 'invited' });
    });
  });

  describe('auth/accept-invite (real route)', () => {
    const TOKEN = 'c15e-auth-invite-token-not-real-0001';
    function authWorld(expires_at: unknown) {
      seed({ invitations: [{ id: 'inv-2', email: 'x@example.test', token_hash: createHash('sha256').update(TOKEN).digest('hex'), expires_at, accepted_at: null, revoked_at: null, token_consumed_at: null }] });
    }
    const post = () => invoke(authAcceptInvite as never, { method: 'POST', body: { token: TOKEN }, headers: {} });
    afterEach(() => jest.useRealTimers());

    it.each([['malformed', 'not-a-date'], ['missing', null]])('%s expires_at → 400 EXPIRED, invitation revoked, token not consumed', async (_d, v) => {
      authWorld(v);
      const r = await post();
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'EXPIRED' });
      const inv = rows('invitations')[0];
      expect(inv.revoked_at).toBeTruthy();
      expect(inv.token_consumed_at ?? null).toBeNull();
    });

    it('boundary (expires_at === now) → 400 EXPIRED', async () => {
      jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
      authWorld(new Date(T).toISOString());
      const r = await post();
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'EXPIRED' });
    });
  });

  it('authorization time: an invitation-backed (invited) membership authorizes nothing, expired or not — so expiry can never be outlived', async () => {
    world('COMPANY_ADMIN', { invitations: [{ id: 'inv-x', email: 'i@example.test', company_id: CO_A, role: 'COMPANY_ADMIN', expires_at: new Date(Date.now() + 86_400_000).toISOString() }] });
    expect((await viaWithRBAC('INVITED', [Role.COMPANY_ADMIN])).status).toBe(403);
    rows('invitations')[0].expires_at = new Date(Date.now() - 86_400_000).toISOString();
    expect((await viaWithRBAC('INVITED', [Role.COMPANY_ADMIN])).status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Workstream 4 — withRBAC honours company operational status', () => {
  it('active company → active COMPANY_ADMIN admitted (200)', async () => {
    world();
    expect((await viaWithRBAC('A', [Role.COMPANY_ADMIN])).status).toBe(200);
  });

  it.each(['suspended', 'inactive', 'deleted'])('company %s → active COMPANY_ADMIN refused (403 "Access denied to company")', async (status) => {
    world();
    setCompany(CO_A, status);
    const r = await viaWithRBAC('A', [Role.COMPANY_ADMIN]);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Access denied to company' });
  });

  it('company row missing → 403 (fail closed)', async () => {
    world();
    setCompany(CO_A, null);
    expect((await viaWithRBAC('A', [Role.COMPANY_ADMIN])).status).toBe(403);
  });

  it('company status lookup error → retryable 503, never an allow', async () => {
    world();
    failTable('companies');
    const r = await viaWithRBAC('A', [Role.COMPANY_ADMIN]);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'TENANT_LOOKUP_ERROR', retryable: true });
  });

  it('platform super admin keeps TenantGuard\'s bypass: suspended / missing company and even a failing company read → 200', async () => {
    world();
    setCompany(CO_B, 'suspended');
    expect((await viaWithRBAC('SUPER', [Role.SUPER_ADMIN], CO_B)).status).toBe(200);
    failTable('companies');
    expect((await viaWithRBAC('SUPER', [Role.COMPANY_ADMIN, Role.SUPER_ADMIN], CO_A)).status).toBe(200);
  });

  it('agrees with enforceCompanyAccess for the same suspended company (both refuse the active admin)', async () => {
    world();
    setCompany(CO_A, 'suspended');
    expect((await viaWithRBAC('A', [Role.COMPANY_ADMIN])).status).toBe(403);
    expect(await viaGuard((req, res) => enforceCompanyAccess({ req, res, companyId: CO_A }), 'A')).toMatchObject({ status: 403, value: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Workstream 5 — the route-policy gate agrees with route authorization on the same rows', () => {
  const GATE = 'ROLLOUT_ROUTE_POLICY_GATE_MODE';
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[GATE]; process.env[GATE] = 'shadow'; (logger.info as jest.Mock).mockClear(); });
  afterEach(() => { if (saved === undefined) delete process.env[GATE]; else process.env[GATE] = saved; });

  async function gateAllows(policy: RoutePolicy, who: 'A' | 'INVITED' | 'SUPER' | 'EXSUPER'): Promise<boolean> {
    (logger.info as jest.Mock).mockClear();
    const req = { method: 'GET', url: '/api/probe', headers: bearer(who), cookies: {}, query: { companyId: CO_A }, body: {} };
    await observePolicy(policy, '/api/probe', req as never);
    const call = (logger.info as jest.Mock).mock.calls.find((c) => c[0] === 'route_policy_shadow_observation');
    if (!call) throw new Error('no observation logged');
    return (call[1] as { wouldAllow: boolean }).wouldAllow;
  }
  const ADMIN_POLICY: RoutePolicy = { v: 1, category: 'admin', companyIdFrom: 'query.companyId', role: 'COMPANY_ADMIN' };
  const COMPANY_POLICY: RoutePolicy = { v: 1, category: 'company-scoped', companyIdFrom: 'query.companyId' };
  const SUPER_POLICY: RoutePolicy = { v: 1, category: 'super-admin', audit: true };
  const superOnlyRoute = withRBAC((async (req: never, res: Res) => {
    if (!(await requireActivePlatformSuperAdmin(req, res as never, 'probe'))) return;
    res.status(200).json({ ok: true });
  }) as never, [Role.SUPER_ADMIN]);

  const PRINCIPALS: Array<[string, 'A' | 'INVITED' | 'SUPER' | 'EXSUPER', () => void]> = [
    ['active COMPANY_ADMIN', 'A', () => world()],
    ['INVITED COMPANY_ADMIN', 'INVITED', () => world('COMPANY_ADMIN')],
    ['INVITED ADMIN (legacy)', 'INVITED', () => world('ADMIN')],
    ['INVITED SUPER_ADMIN', 'INVITED', () => world('SUPER_ADMIN')],
    ['INVITED CONTENT_CREATOR', 'INVITED', () => world('CONTENT_CREATOR')],
    ['INACTIVE SUPER_ADMIN', 'EXSUPER', () => seed({ user_company_roles: [{ user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' }] })],
    ['active platform SUPER_ADMIN', 'SUPER', () => world()],
  ];

  it.each(PRINCIPALS)('%s: admin policy ⇔ withRBAC([COMPANY_ADMIN]) (active company)', async (_d, who, setup) => {
    setup();
    const route = (await viaWithRBAC(who, [Role.COMPANY_ADMIN])).status === 200;
    expect(await gateAllows(ADMIN_POLICY, who)).toBe(route);
  });

  it.each(PRINCIPALS)('%s: company-scoped policy ⇔ withRBAC(all roles) (active company)', async (_d, who, setup) => {
    setup();
    const route = (await viaWithRBAC(who, undefined)).status === 200;
    expect(await gateAllows(COMPANY_POLICY, who)).toBe(route);
  });

  it.each(PRINCIPALS)('%s: super-admin policy ⇔ withRBAC([SUPER_ADMIN]) + active-platform guard', async (_d, who, setup) => {
    setup();
    const r = await invoke(superOnlyRoute as never, { method: 'GET', query: { companyId: CO_A }, headers: bearer(who) });
    expect(await gateAllows(SUPER_POLICY, who)).toBe(r.status === 200);
  });

  it('known divergence (documented): the gate does not read company status — a suspended company is refused by withRBAC but the observation-only gate would allow', async () => {
    world();
    setCompany(CO_A, 'suspended');
    expect((await viaWithRBAC('A', [Role.COMPANY_ADMIN])).status).toBe(403);
    expect(await gateAllows(ADMIN_POLICY, 'A')).toBe(true);
  });

  it('fixture sanity', () => {
    expect(userForRequest({ headers: bearer('INVITED') })?.id).toBe(USER_INVITED);
    expect(USER_SUPER).toBeTruthy();
  });
});
