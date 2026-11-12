/**
 * SECURITY (2026-11-13, e9 ruling): internal error detail (exception messages, auth-failure reasons) reached API
 * responses whenever `process.env.NODE_ENV !== 'production'` - fail-OPEN for unset / 'staging' / 'Production'.
 * The response-bound gates now use isNonProduction() (exactly 'development' / 'test'). Server-LOG-only stacks
 * (connect/google:62, status:41, generate:359) are not responses and are unchanged.
 *
 * Each case loads the route in an isolated registry under the NODE_ENV it names (productionFlags freezes at load),
 * drives the error path, and looks for the internal detail in the RESPONSE body.
 */
import { randomBytes } from 'crypto';

const DETAIL = `INTERNAL-DETAIL-${randomBytes(6).toString('hex')}`;
const state = { auth: { user: { id: 'user-a' }, error: null } as { user: unknown; error: unknown } };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => state.auth }));
jest.mock('../../middleware/authMiddleware', () => ({ requireCompanyAccess: async () => true }));
jest.mock('../../services/googleAnalyticsExperienceService', () => ({
  getGoogleAnalyticsStatusPayload: async () => { throw new Error(DETAIL); },
}));
jest.mock('../../services/analyticsIntegrationService', () => ({
  connectGoogleAnalytics: async () => { throw new Error(DETAIL); },
  connectGoogleSearchConsole: async () => { throw new Error(DETAIL); },
}));
jest.mock('../../auth/getBaseUrl', () => ({ getBaseUrl: () => 'http://localhost:3000' }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => ({ userId: 'super_admin_session' }) }));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: async () => false, isSuperAdmin: async () => false, getUserRole: async () => ({ role: null }),
}));
jest.mock('../../services/consumptionAnalyticsService', () => ({
  getLlmConsumption: async () => { throw new Error(DETAIL); },
  getAllOrgsConsumption: async () => { throw new Error(DETAIL); },
}));
jest.mock('../../services/reportsCompanyAccessService', () => ({ resolveCompanyId: async () => { throw new Error(DETAIL); } }));
jest.mock('../../services/logger', () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } }));

const savedEnv = process.env.NODE_ENV;
beforeEach(() => {
  state.auth = { user: { id: 'user-a' }, error: null };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  if (savedEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
  jest.restoreAllMocks();
});

function load(route: string, env: string | undefined): any {
  const e = process.env as Record<string, string | undefined>;
  if (env === undefined) delete e.NODE_ENV; else e.NODE_ENV = env;
  let h: any;
  jest.isolateModules(() => { h = require(`../../../pages/api/${route}`).default; });
  return h;
}

async function call(h: any, method: string, query: Record<string, unknown>, body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  await h({ method, headers: {}, query, body, url: `/api/x`, socket: {} }, res);
  return res;
}

const A = '11111111-1111-4111-8111-111111111111';
type Scenario = { name: string; run: (env: string | undefined) => Promise<any>; status: number };
const SCENARIOS: Scenario[] = [
  { name: 'analytics/status auth failure detail', status: 401, run: async (env) => {
    state.auth = { user: null, error: DETAIL };
    return call(load('analytics/status', env), 'GET', { companyId: A }, {});
  } },
  { name: 'analytics/status 500 message', status: 500, run: async (env) => call(load('analytics/status', env), 'GET', { companyId: A }, {}) },
  { name: 'analytics/connect/google auth failure detail', status: 401, run: async (env) => {
    state.auth = { user: null, error: DETAIL };
    return call(load('analytics/connect/google', env), 'POST', {}, { companyId: A });
  } },
  { name: 'analytics/connect/google 500 message', status: 500, run: async (env) => call(load('analytics/connect/google', env), 'POST', {}, { companyId: A }) },
  { name: 'admin/consumption/llm 500 message', status: 500, run: async (env) => call(load('admin/consumption/llm', env), 'GET', { companyId: A }, {}) },
  { name: 'reports/generate unhandled 500 message', status: 500, run: async (env) => call(load('reports/generate', env), 'POST', {}, { companyId: A, domain: 'example.test' }) },
];

describe.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', (_n, s) => {
  it.each([['production'], ['Production'], ['prod'], ['staging'], ['UNSET']])('NODE_ENV=%s: the internal detail never reaches the response', async (env) => {
    let res: any;
    try {
      res = await s.run(env === 'UNSET' ? undefined : env);
    } catch (err) {
      // A route that imports the app config is REFUSED at load for a NODE_ENV outside its zod enum
      // (development|production|test) - no response at all, which is also fail-closed. Accept exactly that error.
      expect(['Production', 'prod', 'staging']).toContain(env);
      expect(JSON.stringify((err as { issues?: unknown }).issues ?? String(err))).toContain('NODE_ENV');
      return;
    }
    expect(res.statusCode).toBe(s.status);
    expect(JSON.stringify(res.body)).not.toContain(DETAIL);
  });

  it('CONTROL NODE_ENV=development: the detail is still shown to developers', async () => {
    const res = await s.run('development');
    expect(res.statusCode).toBe(s.status);
    expect(JSON.stringify(res.body)).toContain(DETAIL);
  });
});
