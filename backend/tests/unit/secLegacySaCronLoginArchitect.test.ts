/**
 * 2026-11-11 (e9 (C), non-blocking-scheduled): the legacy super-admin and
 * content-architect bridge cookies are removed.
 *
 *  - cron routes: the CRON_SECRET bearer, or requireCapability with platform
 *    authority + step-up for a person (no cookie, no bare role check);
 *  - content-architect/search: CONTENT_ARCHITECT_READ on the canonical session;
 *  - super-admin login + content-architect login: no bridge cookie is minted;
 *    without a canonical session the login fails closed (503);
 *  - resolveCompanyAccess: a legacy content-architect cookie alone grants nothing.
 */
const CRON = 'cron-secret-for-tests';
const capCalls: Array<Record<string, unknown>> = [];
let capAllow = false;

jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, opts: Record<string, unknown>) => {
    capCalls.push(opts);
    if (capAllow) return { ok: true, principal: { userId: 'sa-1' } };
    res.status(403).json({ error: 'CAPABILITY_NOT_HELD' });
    return { ok: false, sent: true };
  }),
}));
const runExpiryCheck = jest.fn(async () => ({ expired: 0 }));
jest.mock('../../services/creditExpiryService', () => ({ runExpiryCheck: () => runExpiryCheck() }));
jest.mock('../../services/jobRunner', () => ({
  runJob: jest.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => ({ status: 'completed', result: await fn(), ctx: { executionId: 'x' } })),
}));
const runAnomalySweep = jest.fn(async () => ({ ok: true }));
jest.mock('../../../lib/anomaly/sweepDetector', () => ({ runAnomalySweep: () => runAnomalySweep() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// login dependencies
let primaryRow: Record<string, unknown> | null = null;
const createSession = jest.fn(async () => ({ cookieValue: 'canon', session: { id: 'sess-1' } }));
jest.mock('../../security/SessionAuthorityService', () => ({
  createSession: (...a: unknown[]) => (createSession as unknown as (...x: unknown[]) => unknown)(...a),
  attachSessionCookie: (res: { setHeader: (k: string, v: unknown) => void }, v: string) => res.setHeader('Set-Cookie', [`auth_session=${v}`]),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../security/startup/superAdminIdentityCheck', () => ({ checkSuperAdminIdentity: jest.fn(async () => ({ ok: true, primaryUserId: 'sa-1' })) }));
function q(rows: () => unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'insert', 'order']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok);
  return b;
}
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => q(() => (primaryRow ? [t === 'users' ? primaryRow : { user_id: 'sa-1', role: 'X', status: 'active' }] : [])),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => q(() => []) } }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null, error: 'no session' }) }));

import cronCreditExpiry from '../../../pages/api/cron/credit-expiry';
import cronAnomaly from '../../../pages/api/cron/anomaly-sweep';
import architectSearch from '../../../pages/api/content-architect/search';
import login from '../../../pages/api/super-admin/login';
import architectLogin from '../../../pages/api/super-admin/content-architect-login';
import { resolveCompanyAccess } from '../../services/contentArchitectService';

type Res = { code: number; body: Record<string, unknown>; headers: Record<string, unknown> };
async function call(h: unknown, req: Record<string, unknown>): Promise<Res> {
  const out: Res = { code: 0, body: {}, headers: {} };
  const r = {
    status: (c: number) => { out.code = c; return r; },
    json: (b: Record<string, unknown>) => { out.body = b; return r; },
    setHeader: (k: string, v: unknown) => { out.headers[k] = v; return r; },
    getHeader: (k: string) => out.headers[k],
  };
  await (h as (q: unknown, s: unknown) => Promise<void>)({ headers: {}, cookies: {}, query: {}, body: {}, ...req }, r);
  return out;
}
const LEGACY = { headers: { cookie: 'super_admin_session=abc.def' }, cookies: { super_admin_session: 'abc.def', content_architect_session: 'abc.def' } };

beforeEach(() => {
  capCalls.length = 0; capAllow = false; primaryRow = null;
  runExpiryCheck.mockClear(); runAnomalySweep.mockClear(); createSession.mockClear();
  process.env.CRON_SECRET = CRON;
});

describe('cron routes: CRON_SECRET or capability + platform authority + step-up', () => {
  it.each([
    ['credit-expiry', () => cronCreditExpiry, 'POST', 'billing.platform.manage', () => runExpiryCheck],
    ['anomaly-sweep', () => cronAnomaly, 'GET', 'cron.config.manage', () => runAnomalySweep],
  ])('%s', async (_n, h, method, cap, work) => {
    // the scheduler
    const ok = await call(h(), { method, headers: { authorization: `Bearer ${CRON}` } });
    expect(ok.code).toBe(200);
    expect(capCalls).toHaveLength(0);
    expect(work()).toHaveBeenCalledTimes(1);
    // a legacy cookie alone: refused, and the job never runs
    const legacy = await call(h(), { method, ...LEGACY });
    expect(legacy.code).toBe(403);
    expect(work()).toHaveBeenCalledTimes(1);
    expect(capCalls[0]).toMatchObject({ capability: cap, requirePlatformAuthority: true, requireStepUp: true });
    // a wrong secret is not the scheduler
    await call(h(), { method, headers: { authorization: 'Bearer nope' } });
    expect(work()).toHaveBeenCalledTimes(1);
    // a person holding the capability (with step-up satisfied) may trigger it
    capAllow = true;
    expect((await call(h(), { method })).code).toBe(200);
    expect(work()).toHaveBeenCalledTimes(2);
  });
});

describe('content-architect/search', () => {
  it('requires CONTENT_ARCHITECT_READ; a legacy cookie alone is refused', async () => {
    const r = await call(architectSearch, { method: 'GET', query: { q: 'x' }, ...LEGACY });
    expect(r.code).toBe(403);
    expect(capCalls[0]).toMatchObject({ capability: 'content_architect.read' });
  });
});

describe('logins never mint a bridge cookie', () => {
  const setCookies = (r: Res) => ([] as string[]).concat((r.headers['Set-Cookie'] as string[]) ?? []);
  beforeEach(() => {
    process.env.SUPER_ADMIN_USERNAME = 'u'; process.env.SUPER_ADMIN_PASSWORD = 'p';
    process.env.SUPER_ADMIN_PRIMARY_USER_ID = 'sa-1';
    process.env.CONTENT_ARCHITECT_USERNAME = 'u'; process.env.CONTENT_ARCHITECT_PASSWORD = 'p';
    process.env.CONTENT_ARCHITECT_PRIMARY_USER_ID = 'ca-1';
  });

  it.each([['super-admin', () => login], ['content-architect', () => architectLogin]])(
    '%s login: canonical session only; legacy cookies are CLEARED, never set', async (_n, h) => {
      primaryRow = { id: 'sa-1', supabase_uid: 'sa-1', email: null, is_deleted: false };
      const r = await call(h(), { method: 'POST', body: { username: 'u', password: 'p' } });
      expect(r.code).toBe(200);
      const cookies = setCookies(r);
      expect(cookies.some((c) => c.startsWith('auth_session='))).toBe(true);
      for (const c of cookies.filter((x) => /^(super_admin_session|content_architect_session|content_architect_company_id)=/.test(x))) {
        expect(c).toMatch(/^[a-z_]+=;/); // empty value
        expect(c).toContain('Max-Age=0');
      }
    });

  it.each([['super-admin', () => login], ['content-architect', () => architectLogin]])(
    '%s login without a canonical session fails closed (503), no bridge fallback', async (_n, h) => {
      primaryRow = null;
      const r = await call(h(), { method: 'POST', body: { username: 'u', password: 'p' } });
      expect(r.code).toBe(503);
      expect(r.body).toMatchObject({ code: 'CANONICAL_SESSION_UNAVAILABLE' });
      expect(setCookies(r).some((c) => /^(super_admin_session|content_architect_session)=[^;]/.test(c))).toBe(false);
    });
});

describe('resolveCompanyAccess', () => {
  it('a legacy content-architect cookie alone grants nothing (401)', async () => {
    const out: Res = { code: 0, body: {}, headers: {} };
    const r = { status: (c: number) => { out.code = c; return r; }, json: (b: Record<string, unknown>) => { out.body = b; return r; } };
    const access = await resolveCompanyAccess({ ...LEGACY, query: {} } as never, r as never, '00000000-0000-4000-8000-0000000000aa');
    expect(access).toBeNull();
    expect(out.code).toBe(401);
  });
});
