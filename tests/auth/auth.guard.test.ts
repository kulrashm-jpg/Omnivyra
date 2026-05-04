import type { NextApiHandler } from 'next';
import { applyAuthGuard } from '../../backend/middleware/applyAuthGuard';
import { buildAuthContext, AuthContextError } from '../../backend/auth/authContext';
import {
  mockAuthContext,
  mockInternalUser,
  mockMembership,
  mockRequest,
  mockResponse,
  mockSupabaseSession,
} from './helpers';

jest.mock('../../backend/auth/authContext', () => {
  const actual = jest.requireActual('../../backend/auth/authContext');
  return {
    ...actual,
    buildAuthContext: jest.fn(),
  };
});

const mockedBuildAuthContext = buildAuthContext as jest.MockedFunction<typeof buildAuthContext>;

const okHandler: NextApiHandler = (_req, res) => res.status(200).json({ ok: true });

describe('applyAuthGuard', () => {
  beforeEach(() => {
    mockedBuildAuthContext.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    expect(mockSupabaseSession('invalid')).toBeNull();
    mockedBuildAuthContext.mockRejectedValueOnce(new AuthContextError('Unauthorized', 401));

    const req = mockRequest();
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for invalid token', async () => {
    mockedBuildAuthContext.mockRejectedValueOnce(new AuthContextError('Unauthorized', 401));

    const req = mockRequest({ authorization: 'Bearer malformed' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when internal user is missing', async () => {
    expect(mockInternalUser('missing')).toBeNull();
    mockedBuildAuthContext.mockRejectedValueOnce(new AuthContextError('Unauthorized', 401));

    const req = mockRequest({ authorization: 'Bearer valid' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for deleted user', async () => {
    expect(mockInternalUser('deleted')?.status).toBe('deleted');
    mockedBuildAuthContext.mockRejectedValueOnce(new AuthContextError('Forbidden', 403));

    const req = mockRequest({ authorization: 'Bearer valid' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows valid user when org is not required', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext());

    const req = mockRequest({ authorization: 'Bearer valid' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows valid tenant access', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [mockMembership('org-1', 'MEMBER')],
      roles: ['MEMBER'],
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true, requiresOrg: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('blocks wrong-org tenant access', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [mockMembership('org-2', 'MEMBER')],
      roles: [],
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true, requiresOrg: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when org is missing', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext());

    const req = mockRequest({ authorization: 'Bearer valid' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true, requiresOrg: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('blocks missing required role', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [mockMembership('org-1', 'MEMBER')],
      roles: ['MEMBER'],
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({
      requiresAuth: true,
      requiresOrg: true,
      requiredRole: 'COMPANY_ADMIN',
    })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows required role', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [mockMembership('org-1', 'COMPANY_ADMIN')],
      roles: ['COMPANY_ADMIN'],
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({
      requiresAuth: true,
      requiresOrg: true,
      requiredRole: 'COMPANY_ADMIN',
    })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('allows super-admin override when enabled', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [],
      roles: [],
      isSuperAdmin: true,
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({
      requiresAuth: true,
      requiresOrg: true,
      requiredRole: 'COMPANY_ADMIN',
      allowSuperAdminOverride: true,
    })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('blocks super-admin override when disabled', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-1',
      memberships: [],
      roles: [],
      isSuperAdmin: true,
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({
      requiresAuth: true,
      requiresOrg: true,
      requiredRole: 'COMPANY_ADMIN',
      allowSuperAdminOverride: false,
    })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
