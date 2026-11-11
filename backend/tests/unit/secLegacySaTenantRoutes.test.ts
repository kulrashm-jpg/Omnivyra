/**
 * 2026-11-11 (e9 C, legacy super-admin cookie removal - tenant / external-apis
 * group). Every route here used to accept the legacy super-admin cookie as a
 * bypass or as platform authority. The getter is mocked to report a VALID
 * legacy session, so a route that still consulted it would admit the request:
 * these tests prove it is no longer consulted at all.
 *
 *  1. legacy cookie + no Supabase user -> refused (401/403) on tenant routes.
 *  2. platform helpers are capability decisions: reads ask for
 *     SUPER_ADMIN_DASHBOARD_VIEW, writes ask for INTEGRATION_PLATFORM_OAUTH_MANAGE
 *     with step-up + platform authority, and a denied capability is refused.
 *  3. an active tenant member still gets through.
 */
const CO = '00000000-0000-4000-8000-0000000000aa';
const MEMBER = 'user-member';

let authUser: { id: string } | null = null;
let memberRole: string | null = null;
let capabilityAllowed = true;
const requireCapability = jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }, _opts: Record<string, unknown>) => {
  if (!capabilityAllowed) {
    res.status(403).json({ error: 'CAPABILITY_NOT_HELD' });
    return { ok: false, sent: true };
  }
  return { ok: true, principal: { userId: 'cap-principal' } };
});

function chain() {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'neq', 'update', 'insert', 'upsert', 'delete']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.single = async () => ({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => chain(), rpc: async () => ({ data: null, error: null }) } }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => (authUser ? { user: authUser, error: null } : { user: null, error: 'NO_TOKEN' }),
}));
jest.mock('../../services/rbacService', () => ({
  getUserRole: async () => (memberRole ? { role: memberRole, error: null } : { role: null, error: null }),
  getCompanyRoleIncludingInvited: async () => null,
  hasPermission: async () => true,
  isPlatformSuperAdmin: async () => false,
  isSuperAdmin: async () => false,
  Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', ADMIN: 'ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' },
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => (requireCapability as unknown as (...x: unknown[]) => unknown)(...a),
}));
jest.mock('../../services/companyApiConfigService', () => ({
  POLLING_OPTIONS: ['daily'],
  getAllowedPollingForCompany: async () => ['daily'],
  isPollingAllowedForCompany: async () => true,
}));
jest.mock('../../services/companyApiConfigCache', () => ({
  invalidateCompanyConfigCache: () => undefined,
  getCompanyConfigRows: async () => [],
}));
jest.mock('../../services/externalApiService', () => ({
  getAvailableApis: async () => [],
  getCompanyDefaultApiIds: async () => [],
  getEnabledApis: async () => [],
  getEnabledApiIdsFromCompanyConfig: async () => [],
  getUserApiAccess: async () => [],
  getSocialPostingConfigs: async () => [],
  getPlatformConfigs: async () => [],
  getExternalApiRuntimeSnapshot: async () => ({}),
  savePlatformConfig: async () => ({}),
  validatePlatformConfig: () => ({ ok: true }),
  VALID_API_CATEGORIES: [],
}));
jest.mock('../../services/usageAccessService', () => ({ hasUsageAccess: async () => false }));
jest.mock('../../services/planResolutionService', () => ({ resolveOrganizationPlanLimits: async () => ({}) }));
jest.mock('../../services/apiConnectionTestService', () => ({ testApiConnection: async () => ({ ok: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import companyConfig from '../../../pages/api/external-apis/company-config';
import access from '../../../pages/api/external-apis/access';
import usageSummary from '../../../pages/api/organization/usage-summary';
import socialConfigs from '../../../pages/api/social-platforms/configs';
import healthSummary from '../../../pages/api/external-apis/health-summary';
import testConnection from '../../../pages/api/external-apis/[id]/test-connection';
import { requirePlatformAdmin } from '../../apiHandlers/externalApis/indexShared';

type Handler = (q: unknown, s: unknown) => Promise<unknown>;
async function call(h: unknown, method: string, query: Record<string, unknown>, body: Record<string, unknown> = {}) {
  const res = { code: 0, body: {} as unknown };
  const r = {
    status: (c: number) => { res.code = c; return r; },
    json: (b: unknown) => { res.body = b; return r; },
    setHeader: () => r,
    redirect: () => r,
  };
  await (h as Handler)({ method, query, body, url: '/x', headers: { cookie: 'super_admin_session=1' }, cookies: { super_admin_session: '1' } }, r);
  return res;
}

beforeEach(() => {
  authUser = null;
  memberRole = null;
  capabilityAllowed = true;
  requireCapability.mockClear();
});

describe('a legacy super-admin cookie with no Supabase user is refused', () => {
  it.each([
    ['external-apis/company-config GET', companyConfig, 'GET', { companyId: CO }],
    ['external-apis/access GET', access, 'GET', { companyId: CO }],
    ['social-platforms/configs (company path) GET', socialConfigs, 'GET', { companyId: CO }],
    ['organization/usage-summary GET', usageSummary, 'GET', { organization_id: CO }],
  ])('%s', async (_label, handler, method, query) => {
    const res = await call(handler, method as string, query as Record<string, unknown>);
    expect([401, 403]).toContain(res.code);
  });
});

describe('platform helpers are capability decisions', () => {
  it('health-summary GET asks for SUPER_ADMIN_DASHBOARD_VIEW (no step-up)', async () => {
    await call(healthSummary, 'GET', {});
    expect(requireCapability).toHaveBeenCalledTimes(1);
    const opts = requireCapability.mock.calls[0][2];
    expect(opts.capability).toBe('super_admin.dashboard.view');
    expect(opts.requireStepUp).toBeUndefined();
  });

  it('a platform WRITE asks for INTEGRATION_PLATFORM_OAUTH_MANAGE with step-up + platform authority', async () => {
    const res = { status: () => ({ json: () => undefined }) };
    const out = await requirePlatformAdmin({ method: 'POST', headers: {}, query: {} } as never, res as never);
    expect(out).toEqual({ userId: 'cap-principal', role: 'SUPER_ADMIN' });
    expect(requireCapability.mock.calls[0][2]).toMatchObject({
      capability: 'integration.platform.oauth.manage',
      requireStepUp: true,
      requirePlatformAuthority: true,
    });
  });

  it('test-connection with scope=platform (POST) is refused when the capability is denied, and never runs the test', async () => {
    capabilityAllowed = false;
    const res = await call(testConnection, 'POST', { id: 'api-1', scope: 'platform' });
    expect(res.code).toBe(403);
    expect(requireCapability.mock.calls[0][2]).toMatchObject({ capability: 'integration.platform.oauth.manage', requireStepUp: true });
  });

  it('social-platforms/configs scope=platform asks for the view capability and is refused when denied', async () => {
    capabilityAllowed = false;
    const res = await call(socialConfigs, 'GET', { scope: 'platform' });
    expect(res.code).toBe(403);
    expect(requireCapability.mock.calls[0][2].capability).toBe('super_admin.dashboard.view');
  });
});

describe('the tenant path for an active member still works', () => {
  it('company-config GET for an active member is 200', async () => {
    authUser = { id: MEMBER };
    memberRole = 'COMPANY_ADMIN';
    const res = await call(companyConfig, 'GET', { companyId: CO });
    expect(res.code).toBe(200);
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it('social-platforms/configs company path for an active member is 200', async () => {
    authUser = { id: MEMBER };
    memberRole = 'COMPANY_ADMIN';
    const res = await call(socialConfigs, 'GET', { companyId: CO });
    expect(res.code).toBe(200);
  });
});
