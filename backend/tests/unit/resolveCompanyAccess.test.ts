/**
 * SEC-001 Phase 0 — resolveCompanyAccess contract.
 *
 * First dedicated coverage of the helper every guarded route relies on
 * (previously it appeared in tests only as a mock). Pins the 400/401/403
 * semantics and the allow paths: content-architect session, super-admin,
 * exact-company role, invited-role fallback.
 */
import { resolveCompanyAccess } from '../../services/contentArchitectService';
import { createApiRequestMock, createMockRes } from '../utils';

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(),
}));
jest.mock('../../services/rbacService', () => ({
  getUserRole: jest.fn(),
  isSuperAdmin: jest.fn(),
}));
jest.mock('../../services/rbacPrimitives', () => ({
  Role: {
    COMPANY_ADMIN: 'COMPANY_ADMIN',
    ADMIN: 'ADMIN',
    SUPER_ADMIN: 'SUPER_ADMIN',
  },
  getCompanyRoleIncludingInvited: jest.fn(),
}));

import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../services/rbacService';
import { getCompanyRoleIncludingInvited } from '../../services/rbacPrimitives';

const userMock = getSupabaseUserFromRequest as jest.Mock;
const roleMock = getUserRole as jest.Mock;
const superAdminMock = isSuperAdmin as jest.Mock;
const invitedRoleMock = getCompanyRoleIncludingInvited as jest.Mock;

const req = () => createApiRequestMock({ method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  userMock.mockResolvedValue({ user: { id: 'user-1' }, error: null });
  superAdminMock.mockResolvedValue(false);
  roleMock.mockResolvedValue({ role: null, error: null });
  invitedRoleMock.mockResolvedValue(null);
});

test('missing companyId: 400, null, no identity lookup', async () => {
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, undefined);
  expect(access).toBeNull();
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'companyId required' });
  expect(userMock).not.toHaveBeenCalled();
});

// SEC-001A: this test previously asserted the vulnerability itself — that an
// UNSIGNED `content_architect_session=1` cookie granted access to ANY company
// "without session auth". That is the escalation SEC-001A closes, so the
// contract is inverted here: the unsigned cookie must NOT short-circuit
// authorization, and a validly SIGNED cookie must still work until the bridge
// hard-expires. Both directions are pinned.
test('content-architect session: an UNSIGNED cookie no longer bypasses authentication', async () => {
  const r = req();
  (r as any).cookies = { content_architect_session: '1' };
  userMock.mockResolvedValue({ user: null, error: 'no session' });
  const res = createMockRes();
  const access = await resolveCompanyAccess(r, res, 'company-1');
  expect(access).toBeNull();
  expect(res.statusCode).toBe(401); // falls through to real authentication, which fails
  expect(userMock).toHaveBeenCalled(); // no short-circuit
});

/**
 * SEC-001D: these two tests control LEGACY_BRIDGE_DRY_RUN explicitly instead of
 * inheriting whatever the ambient environment has. A bridge-removal rehearsal
 * is run by setting that flag and looking for failures, so a suite that changes
 * verdict with the flag produces a spurious signal in exactly the run that is
 * supposed to be trustworthy. Pinning both directions also proves the
 * content-architect consumer is VISIBLE to dry-run — i.e. not an invisible
 * bridge dependency.
 */
function withArchitectCookie(
  dryRun: boolean,
  assertion: (access: unknown, userWasCalled: () => boolean) => void,
): () => Promise<void> {
  return async () => {
    const savedSecret = process.env.BRIDGE_COOKIE_SECRET;
    const savedDryRun = process.env.LEGACY_BRIDGE_DRY_RUN;
    process.env.BRIDGE_COOKIE_SECRET = 'sec001a-resolve-test-secret-thirty-two+';
    if (dryRun) process.env.LEGACY_BRIDGE_DRY_RUN = '1';
    else delete process.env.LEGACY_BRIDGE_DRY_RUN;

    const { mintSignedBridgeCookieValue } = require('../../security/bridgeCookie') as
      typeof import('../../security/bridgeCookie');
    const { LEGACY_BRIDGE_HARD_EXPIRY_AT } = require('../../security/legacyCookieSuperAdminBridge') as
      typeof import('../../security/legacyCookieSuperAdminBridge');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(LEGACY_BRIDGE_HARD_EXPIRY_AT.getTime() - 60_000);
    try {
      const r = req();
      (r as any).cookies = { content_architect_session: mintSignedBridgeCookieValue() };
      const res = createMockRes();
      const access = await resolveCompanyAccess(r, res, 'company-1');
      assertion(access, () => userMock.mock.calls.length > 0);
    } finally {
      nowSpy.mockRestore();
      if (savedSecret === undefined) delete process.env.BRIDGE_COOKIE_SECRET;
      else process.env.BRIDGE_COOKIE_SECRET = savedSecret;
      if (savedDryRun === undefined) delete process.env.LEGACY_BRIDGE_DRY_RUN;
      else process.env.LEGACY_BRIDGE_DRY_RUN = savedDryRun;
    }
  };
}

test(
  'content-architect session: a SIGNED cookie is still honoured (deprecated bridge, pre-expiry)',
  withArchitectCookie(false, (access, userWasCalled) => {
    expect(access).toEqual({ userId: 'content_architect', role: 'CONTENT_ARCHITECT' });
    expect(userWasCalled()).toBe(false);
  }),
);

test(
  'content-architect session: LEGACY_BRIDGE_DRY_RUN=1 kills the SAME signed cookie (consumer is visible)',
  withArchitectCookie(true, (access, userWasCalled) => {
    // Falls through to real authentication, which the mock denies.
    expect(access).toBeNull();
    expect(userWasCalled()).toBe(true);
  }),
);

test('no authenticated user: 401 UNAUTHORIZED, null', async () => {
  userMock.mockResolvedValue({ user: null, error: 'no session' });
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'company-1');
  expect(access).toBeNull();
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
});

test('super-admin: allowed without a company role lookup', async () => {
  superAdminMock.mockResolvedValue(true);
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'company-1');
  expect(access).toEqual({ userId: 'user-1', role: 'SUPER_ADMIN' });
  expect(roleMock).not.toHaveBeenCalled();
});

test('member with a role for the exact company: allowed with that role', async () => {
  roleMock.mockResolvedValue({ role: 'COMPANY_ADMIN', error: null });
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'company-1');
  expect(access).toEqual({ userId: 'user-1', role: 'COMPANY_ADMIN' });
  expect(roleMock).toHaveBeenCalledWith('user-1', 'company-1');
});

test('no direct role but invited COMPANY_ADMIN: fallback allows', async () => {
  roleMock.mockResolvedValue({ role: null, error: 'COMPANY_ACCESS_DENIED' });
  invitedRoleMock.mockResolvedValue('COMPANY_ADMIN');
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'company-1');
  expect(access).toEqual({ userId: 'user-1', role: 'COMPANY_ADMIN' });
  expect(invitedRoleMock).toHaveBeenCalledWith('user-1', 'company-1');
});

test('authenticated non-member: 403 FORBIDDEN_ROLE, null', async () => {
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'company-1');
  expect(access).toBeNull();
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({ error: 'FORBIDDEN_ROLE' });
});

test('malformed company id behaves as non-member: 403 before any data access', async () => {
  const res = createMockRes();
  const access = await resolveCompanyAccess(req(), res, 'not-a-uuid');
  expect(access).toBeNull();
  expect(res.statusCode).toBe(403);
});
