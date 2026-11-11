/**
 * e9 (C), 2026-11-11: the platform-admin routes no longer consult the legacy
 * super-admin cookie. Every one authorizes through requireCapability:
 *   - reads: a platform VIEW capability, no step-up;
 *   - writes: a MANAGE capability + requireStepUp + requirePlatformAuthority.
 *
 * requireCapability is mocked to record its options and to allow or deny.
 * The legacy getter and the content-architect check are mocked to ANSWER YES
 * (a valid-looking cookie), so a route that still consulted either would pass
 * where it must refuse. Every data/service module is a tripwire: a refusal
 * must not reach business code.
 */
type Opts = { capability: string; reason: string; requireStepUp?: boolean; requirePlatformAuthority?: boolean };
const capCalls: Opts[] = [];
let allow = false;
let trips = 0;
let platformSuperAdmin = false;

const trip = () => { trips++; throw new Error('business code reached'); };
const tripModule = () => new Proxy({}, {
  get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : trip),
});

jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, opts: Opts) => {
    capCalls.push(opts);
    if (!allow) {
      res.status(401).json({ error: 'Authorization required', code: 'NOT_AUTHENTICATED' });
      return { ok: false, sent: true };
    }
    return { ok: true, principal: { userId: 'principal-1', email: null } };
  }),
}));
jest.mock('../../services/contentArchitectService', () => ({ isContentArchitectSession: () => true }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: async () => platformSuperAdmin,
  isSuperAdmin: async () => platformSuperAdmin,
  getUserRole: async () => ({ role: 'COMPANY_ADMIN', error: null }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: tripModule() }));
jest.mock('../../db/writeOwner', () => tripModule());
jest.mock('../../services/intelligenceConfigService', () => tripModule());
jest.mock('../../services/adminRuntimeConfig', () => tripModule());
jest.mock('../../services/llmProviderService', () => tripModule());
jest.mock('../../services/consumptionAnalyticsService', () => tripModule());
jest.mock('../../services/creator/rendering', () => tripModule());
jest.mock('../../services/companyProfileService', () => tripModule());
jest.mock('../../services/companyIntelligence', () => tripModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import campaignHealth from '../../../pages/api/super-admin/campaign-health';
import creditPackages from '../../../pages/api/super-admin/credit-packages/index';
import activityControl from '../../../pages/api/super-admin/activity-control';
import renderOps from '../../../pages/api/internal/render-ops';
import llmModels from '../../../pages/api/super-admin/llm/models';
import consumptionLlm from '../../../pages/api/admin/consumption/llm';
import canonicalShadow from '../../../pages/api/operator/canonical-shadow';
import * as fs from 'fs';
import * as path from 'path';

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function call(h: unknown, method: string, query: Record<string, unknown> = {}, body: unknown = {}) {
  const out = { code: 0, body: undefined as unknown };
  const res = {
    status: (c: number) => { out.code = c; return res; },
    json: (b: unknown) => { out.body = b; return res; },
    setHeader: () => res,
    end: () => res,
  };
  await (h as Handler)({
    method, query, body, url: '/x',
    headers: { cookie: 'super_admin_session=v1.forged.signature; content_architect_session=1' },
    cookies: { super_admin_session: 'v1.forged.signature', content_architect_session: '1', super_admin_actor: 'cookie-actor' },
  }, res);
  return out;
}

beforeEach(() => { capCalls.length = 0; allow = false; trips = 0; platformSuperAdmin = false; });

const WRITES: Array<[string, unknown, string, string]> = [
  ['credit-packages POST', creditPackages, 'POST', 'billing.plan.manage'],
  ['activity-control PATCH', activityControl, 'PATCH', 'platform.controls.manage'],
  ['render-ops POST', renderOps, 'POST', 'platform.controls.manage'],
  ['llm/models POST', llmModels, 'POST', 'platform.controls.manage'],
  ['canonical-shadow POST', canonicalShadow, 'POST', 'platform.controls.manage'],
];

describe('writes: MANAGE capability + step-up + platform authority; refused without it', () => {
  it.each(WRITES)('%s', async (_n, h, method, cap) => {
    const r = await call(h, method, {}, { action: 'x' });
    expect(r.code).toBe(401);
    expect(trips).toBe(0);
    expect(capCalls).toHaveLength(1);
    expect(capCalls[0]).toMatchObject({ capability: cap, requireStepUp: true, requirePlatformAuthority: true });
  });
});

describe('reads: VIEW capability, no step-up; refused without it', () => {
  it.each([
    ['campaign-health GET', campaignHealth],
    ['credit-packages GET', creditPackages],
    ['activity-control GET', activityControl],
    ['render-ops GET', renderOps],
    ['llm/models GET', llmModels],
  ])('%s', async (_n, h) => {
    const r = await call(h, 'GET');
    expect(r.code).toBe(401);
    expect(trips).toBe(0);
    expect(capCalls).toHaveLength(1);
    expect(capCalls[0].capability).toBe('super_admin.dashboard.view');
    expect(capCalls[0].requireStepUp).toBeUndefined();
    expect(capCalls[0].requirePlatformAuthority).toBeUndefined();
  });
});

describe('admin/consumption: role detects the super-admin tier, the capability authorizes it', () => {
  it('a platform super admin needs CONSUMPTION_VIEW_AGGREGATE; denied -> no consumption read', async () => {
    platformSuperAdmin = true;
    const r = await call(consumptionLlm, 'GET');
    expect(r.code).toBe(401);
    expect(trips).toBe(0);
    expect(capCalls.map((c) => c.capability)).toEqual(['consumption.view.aggregate']);
  });

  it('a tenant user keeps the tenant path (no platform capability asked)', async () => {
    platformSuperAdmin = false;
    const r = await call(consumptionLlm, 'GET', { companyId: '00000000-0000-4000-8000-0000000000aa' });
    expect(capCalls).toHaveLength(0);
    expect(trips).toBe(1); // reached the (tripwired) tenant consumption read
    expect(r.code).toBe(500);
  });
});

it('a valid-looking legacy cookie with no principal never authorizes (the cookie is not consulted)', async () => {
  // Getter + content-architect check are mocked to say YES above; requireCapability
  // (no principal) says no. Every route still refuses before business code.
  for (const [, h, method] of WRITES) {
    expect((await call(h, method)).code).toBe(401);
  }
  expect((await call(campaignHealth, 'GET')).code).toBe(401);
  expect(trips).toBe(0);
});

it('when the capability is granted, the render-ops audit actor is the principal, never a cookie', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../pages/api/internal/render-ops.ts'), 'utf8');
  expect(src).not.toMatch(/req\.cookies/);
  expect(src).toMatch(/guard\.principal\.userId/);
});

it('no route in this group references the legacy session helpers', () => {
  const files = [
    'super-admin/activity-control', 'super-admin/activity-cost-breakdown-v2', 'super-admin/analytics-provider-config',
    'super-admin/analytics-summary', 'super-admin/campaign-health', 'super-admin/community-ai-policy',
    'super-admin/connection-health', 'super-admin/credit-packages/index', 'super-admin/free-credits/activity',
    'super-admin/free-credits/summary', 'super-admin/llm/models', 'super-admin/llm/providers',
    'super-admin/pagespeed-config', 'super-admin/plans/analytics', 'super-admin/plans/get-organization-plan',
    'super-admin/plans/list', 'super-admin/savings-report', 'admin/consumption/apis', 'admin/consumption/llm',
    'system/overview', 'internal/render-ops', 'operator/canonical-shadow',
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, `../../../pages/api/${f}.ts`), 'utf8');
    expect([f, /superAdminSession|getLegacySuperAdminSession|isContentArchitectSession|super_admin_session|content_architect_session/.test(src)]).toEqual([f, false]);
    expect([f, /requireCapability\(/.test(src)]).toEqual([f, true]);
  }
});
