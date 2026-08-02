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

test('content-architect session: allowed for any company without session auth', async () => {
  const r = req();
  (r as any).cookies = { content_architect_session: '1' };
  const res = createMockRes();
  const access = await resolveCompanyAccess(r, res, 'company-1');
  expect(access).toEqual({ userId: 'content_architect', role: 'CONTENT_ARCHITECT' });
  expect(userMock).not.toHaveBeenCalled();
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
