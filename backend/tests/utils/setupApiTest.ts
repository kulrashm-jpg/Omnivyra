/**
 * Shared API test setup.
 * Use for ALL handler tests. No custom inline mocks.
 *
 * - createApiRequestMock: normalized req with headers, query, body
 * - createMockRes: standard res mock
 * - rbacMockImplementations: spread into jest.mock('../../services/rbacService')
 * - authMockImplementations: for supabaseAuthService
 */

import type { NextApiResponse } from 'next';

export { createApiRequestMock, type ApiRequestMockOptions } from './createApiRequestMock';
export { createSupabaseMock, type TableResponses } from './createSupabaseMock';

export function createMockRes(): NextApiResponse & {
  statusCode?: number;
  body?: any;
  json: jest.Mock;
} {
  const res: any = {
    statusCode: 200,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: any) => {
      res.body = payload;
      return res;
    }),
    setHeader: jest.fn().mockReturnThis(),
    end: jest.fn(),
  };
  return res as NextApiResponse & { statusCode?: number; body?: any; json: jest.Mock };
}

/**
 * Standard RBAC mock. Preserve Role, PERMISSIONS; override async functions.
 * Usage: jest.mock('../../services/rbacService', () => ({
 *   ...require('../utils/setupApiTest').rbacMockImplementations,
 * }));
 */
export function getRbacMockImplementations() {
  const actual = jest.requireActual('../../services/rbacService');
  return {
    ...actual,
    enforceRole: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'SUPER_ADMIN' }),
    getUserRole: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN', error: null }),
    hasPermission: jest.fn().mockResolvedValue(true),
    isSuperAdmin: jest.fn().mockResolvedValue(true),
    isPlatformSuperAdmin: jest.fn().mockResolvedValue(false),
    getUserCompanyRole: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN', userId: 'user-1' }),
  };
}

/**
 * Standard auth mock. Usage:
 * jest.mock('../../services/supabaseAuthService', () => ({
 *   getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
 * }));
 */
export const authMockImplementations = {
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
};

/**
 * Standard userContext mock for enforceCompanyAccess / resolveUserContext.
 */
export const userContextMockImplementations = {
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    companyIds: ['default'],
    defaultCompanyId: 'default',
    role: 'admin',
  }),
  enforceCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1' }),
};
