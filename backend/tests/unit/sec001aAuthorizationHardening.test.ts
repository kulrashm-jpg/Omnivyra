/**
 * SEC-001A — platform authorization hardening.
 *
 * Proves the forgeable content-architect cookie path is closed everywhere it
 * granted authority, and that the legitimate paths still work. (2026-11-13:
 * the whole legacy Content Architect path — incl. the signed cookie that
 * SEC-001A still honoured until its hard expiry — was REMOVED pre-launch, so
 * the cookie-parser unit tests went with isContentArchitectSession; the
 * authorization matrix below now pins that even a SIGNED cookie confers
 * nothing.)
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

import { mintSignedBridgeCookieValue } from '../../security/bridgeCookie';
import { resolveCompanyAccess } from '../../services/contentArchitectService';
import { LEGACY_BRIDGE_HARD_EXPIRY_AT } from '../../security/legacyCookieSuperAdminBridge';

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
  // Keep the deprecated bridge inside its validity window for the compat tests.
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime() - 60_000);
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

describe('SEC-001A — authorization matrix through resolveCompanyAccess', () => {
  test('UNAUTHENTICATED + validly SIGNED pre-expiry cookie ⇒ 401 (legacy path removed)', async () => {
    getSupabaseUserFromRequest.mockResolvedValue({ user: null, error: 'no session' });
    const res = mockRes();
    const access = await resolveCompanyAccess(
      req({ content_architect_session: mintSignedBridgeCookieValue() }), res, 'co-1');
    expect(access).toBeNull();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

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
