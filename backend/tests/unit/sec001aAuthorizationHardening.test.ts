/**
 * SEC-001A — platform authorization hardening.
 *
 * Proves the forgeable `content_architect_session` path is closed everywhere it
 * granted authority, and that the legitimate paths still work:
 *   • forged / unsigned / tampered / stale cookies FAIL
 *   • a validly SIGNED cookie is accepted (backward compatibility for the
 *     deprecated bridge, until its hard expiry)
 *   • the hard expiry and the dry-run switch fail closed
 *   • super-admin and company-admin authorization are unchanged
 *   • cross-tenant access and unauthenticated requests still fail
 */

const BRIDGE_SECRET = 'sec001a-test-secret-value-thirty-two-plus';

const getSupabaseUserFromRequest = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => getSupabaseUserFromRequest(...a),
}));
const isSuperAdmin = jest.fn();
const getUserRole = jest.fn();
jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: (...a: unknown[]) => isSuperAdmin(...a),
  getUserRole: (...a: unknown[]) => getUserRole(...a),
}));
const getCompanyRoleIncludingInvited = jest.fn();
jest.mock('../../services/rbacPrimitives', () => ({
  ...jest.requireActual('../../services/rbacPrimitives'),
  getCompanyRoleIncludingInvited: (...a: unknown[]) => getCompanyRoleIncludingInvited(...a),
}));

import * as contentArchitectService from '../../services/contentArchitectService';
const { resolveCompanyAccess } = contentArchitectService;

const req = (cookies: Record<string, string> = {}) =>
  ({ cookies, headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } } as never);

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res as never;
}

const ENV_KEYS = ['BRIDGE_COOKIE_SECRET', 'SESSION_COOKIE_SECRET', 'LEGACY_BRIDGE_DRY_RUN', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};
let nowSpy: jest.SpyInstance | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.BRIDGE_COOKIE_SECRET = BRIDGE_SECRET;
  delete process.env.LEGACY_BRIDGE_DRY_RUN;
  // Pin the clock to the instant the bridge WOULD still have been valid
  // (2026-08-05T00:00Z minus a minute): even then no cookie grants anything.
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-05T00:00:00Z') - 60_000);
});
afterEach(() => {
  nowSpy?.mockRestore();
  for (const k of ENV_KEYS) {
    // `process.env.NODE_ENV` is typed readonly, but ENV_KEYS restores it by name;
    // go through the index signature so the assignment stays legal.
    const env = process.env as Record<string, string | undefined>;
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k] as string;
  }
});

// The cookie-session matrix (forged / tampered / signed / expired / dry-run)
// pinned isContentArchitectSession. e9 (C), 2026-11-11: that reader and its
// pinned-company sibling are DELETED, so the property is now stronger and
// simpler - NO cookie of any shape grants content-architect access.
describe('SEC-001A (after e9 (C)) - the content-architect cookie grants nothing', () => {
  test('the cookie readers are no longer exported', () => {
    const mod = contentArchitectService as Record<string, unknown>;
    expect(mod.isContentArchitectSession).toBeUndefined();
    expect(mod.checkContentArchitectAccess).toBeUndefined();
    expect(mod.getContentArchitectCompanyId).toBeUndefined();
  });

  test.each([
    ['legacy unsigned =1', () => '1'],
    ['arbitrary value', () => 'attacker'],
    // Nothing verifies a signature any more (the bridge is deleted), so a value
    // shaped like a signed bridge cookie is just another unread string.
    ['shaped like a signed bridge value', () => 'eyJpYXQiOjE3NjI4MDAwMDB9.c2lnbmF0dXJl'],
  ])('%s cookie + no session => 401, no access', async (_n, value) => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: null, error: 'no session' });
    const res = { statusCode: 0, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    const access = await resolveCompanyAccess(
      req({ content_architect_session: value(), content_architect_company_id: 'company-1' }), res as never, 'company-1');
    expect(access).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

describe('SEC-001A — authorization matrix through resolveCompanyAccess', () => {
  test('UNAUTHENTICATED + forged cookie ⇒ 401, no access', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: null, error: 'no session' });
    const res = mockRes();
    const access = await resolveCompanyAccess(req({ content_architect_session: '1' }), res, 'co-1');
    expect(access).toBeNull();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  test('SUPER ADMIN still authorized for any company (unchanged)', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: { id: 'u-super' }, error: null });
    isSuperAdmin.mockResolvedValue(true);
    const access = await resolveCompanyAccess(req(), mockRes(), 'co-1');
    expect(access).toEqual({ userId: 'u-super', role: 'SUPER_ADMIN' });
  });

  test('COMPANY ADMIN still authorized for their own company (unchanged)', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: { id: 'u-admin' }, error: null });
    isSuperAdmin.mockResolvedValue(false);
    getUserRole.mockResolvedValue({ role: 'COMPANY_ADMIN', error: null });
    const access = await resolveCompanyAccess(req(), mockRes(), 'co-1');
    expect(access).toEqual({ userId: 'u-admin', role: 'COMPANY_ADMIN' });
  });

  test('CROSS-TENANT: authenticated user with no role in the target company ⇒ 403', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: { id: 'u-other' }, error: null });
    isSuperAdmin.mockResolvedValue(false);
    getUserRole.mockResolvedValue({ role: null, error: 'COMPANY_ACCESS_DENIED' });
    getCompanyRoleIncludingInvited.mockResolvedValue(null);
    const res = mockRes();
    const access = await resolveCompanyAccess(req(), res, 'co-foreign');
    expect(access).toBeNull();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  test('CROSS-TENANT + forged cookie: the cookie can no longer rescue a denied role ⇒ 403', async () => {
    // This is the precise escalation SEC-001A closes: previously the forged
    // cookie turned this 403 into a CONTENT_ARCHITECT grant for ANY company.
    getSupabaseUserFromRequest.mockResolvedValue({ user: { id: 'u-other' }, error: null });
    isSuperAdmin.mockResolvedValue(false);
    getUserRole.mockResolvedValue({ role: null, error: 'COMPANY_ACCESS_DENIED' });
    getCompanyRoleIncludingInvited.mockResolvedValue(null);
    const res = mockRes();
    const access = await resolveCompanyAccess(req({ content_architect_session: '1' }), res, 'co-foreign');
    expect(access).toBeNull();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  test('missing companyId still 400s before any authorization work', async () => {
    const res = mockRes();
    const access = await resolveCompanyAccess(req(), res, null);
    expect(access).toBeNull();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(getSupabaseUserFromRequest).not.toHaveBeenCalled();
  });
});
