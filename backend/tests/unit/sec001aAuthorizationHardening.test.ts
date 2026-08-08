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

import { mintSignedBridgeCookieValue } from '../../security/bridgeCookie';
import {
  isContentArchitectSession,
  resolveCompanyAccess,
} from '../../services/contentArchitectService';
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

describe('SEC-001A — forged cookies fail', () => {
  test('the legacy unsigned `=1` cookie NO LONGER grants a content-architect session', () => {
    expect(isContentArchitectSession(req({ content_architect_session: '1' }))).toBe(false);
  });

  test('arbitrary attacker-chosen values fail (forgery, tamper, malformed)', () => {
    for (const forged of ['true', 'yes', 'admin', 'x.y', 'eyJhIjoxfQ.not-a-signature', '..', '1;1']) {
      expect(isContentArchitectSession(req({ content_architect_session: forged }))).toBe(false);
    }
  });

  test('a cookie signed with the WRONG secret fails (no secret sharing, no bypass)', () => {
    const value = mintSignedBridgeCookieValue();
    process.env.BRIDGE_COOKIE_SECRET = 'a-different-secret-value-thirty-two-chars';
    expect(isContentArchitectSession(req({ content_architect_session: value }))).toBe(false);
  });

  test('a tampered payload on a valid signature fails', () => {
    const value = mintSignedBridgeCookieValue();
    const [payload, sig] = value.split('.');
    const tampered = `${Buffer.from('9999999999:deadbeef', 'utf8').toString('base64url')}.${sig}`;
    expect(tampered).not.toBe(value);
    expect(payload.length).toBeGreaterThan(0);
    expect(isContentArchitectSession(req({ content_architect_session: tampered }))).toBe(false);
  });

  test('absent cookie is simply not an architect session', () => {
    expect(isContentArchitectSession(req())).toBe(false);
    expect(isContentArchitectSession(req({ other: 'x' }))).toBe(false);
  });
});

describe('SEC-001A — legitimate + expiry behaviour', () => {
  test('BACKWARD COMPATIBLE: a validly signed cookie is still accepted before the hard expiry', () => {
    expect(isContentArchitectSession(req({ content_architect_session: mintSignedBridgeCookieValue() }))).toBe(true);
  });

  test('HARD EXPIRY: after the removal date even a valid signature fails closed', () => {
    const value = mintSignedBridgeCookieValue();
    nowSpy!.mockReturnValue(LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime() + 1);
    expect(isContentArchitectSession(req({ content_architect_session: value }))).toBe(false);
  });

  test('DRY RUN: LEGACY_BRIDGE_DRY_RUN=1 fails closed (Wave-3A removal simulation)', () => {
    const value = mintSignedBridgeCookieValue();
    process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    expect(isContentArchitectSession(req({ content_architect_session: value }))).toBe(false);
  });

  test('no signing secret configured ⇒ the deprecated path cannot be used at all', () => {
    const value = mintSignedBridgeCookieValue();
    delete process.env.BRIDGE_COOKIE_SECRET;
    delete process.env.SESSION_COOKIE_SECRET;
    expect(isContentArchitectSession(req({ content_architect_session: value }))).toBe(false);
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
