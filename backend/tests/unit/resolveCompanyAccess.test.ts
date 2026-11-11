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
// authorization. Since e9 (C) no cookie value of any shape does (see below).
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
 * e9 (C), 2026-11-11: the content-architect cookie reader and the bridge
 * lifecycle (signature, expiry, dry-run) are DELETED. A cookie of any value -
 * including one shaped like a signed bridge cookie - is just an unread header:
 * resolveCompanyAccess always authenticates the real session.
 */
test.each([
  ['legacy unsigned', '1'],
  ['shaped like a signed bridge value', 'eyJpYXQiOjE3NjI4MDAwMDB9.c2lnbmF0dXJl'],
])('content-architect cookie (%s) grants nothing: real authentication runs and denies', async (_n, value) => {
  const r = req();
  (r as any).cookies = { content_architect_session: value, content_architect_company_id: 'company-1' };
  const res = createMockRes();
  const access = await resolveCompanyAccess(r, res, 'company-1');
  expect(access).toBeNull();
  expect(userMock).toHaveBeenCalled();
});

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
