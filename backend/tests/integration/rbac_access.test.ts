import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceRole, Role } from '../../services/rbacService';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
}));

const { supabase } = jest.requireMock('../../db/supabaseClient');
const { resolveUserContext } = jest.requireMock('../../services/userContextService');

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { statusCode?: number; body?: any } = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res as NextApiResponse;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res as NextApiResponse;
  };
  return res as NextApiResponse & { statusCode?: number; body?: any };
};

const mockRoleLookup = (rowsByCompany: Record<string, string | null>, anyRoles: string[] = []) => {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table !== 'user_company_roles') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
    }
    let filters: Record<string, string> = {};
    const query: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn((field: string, value: string) => {
        filters[field] = value;
        return query;
      }),
      limit: jest.fn().mockReturnThis(),
      then: (resolve: any) => {
        if (filters.user_id && !filters.company_id) {
          const filtered = filters.role
            ? anyRoles.filter((role) => role === filters.role)
            : anyRoles;
          const data = filtered.map((role) => ({ role }));
          return resolve({ data, error: null });
        }
        if (filters.user_id && filters.company_id) {
          const role = rowsByCompany[filters.company_id];
          const data = role ? [{ role }] : [];
          return resolve({ data, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return query;
  });
};

describe('RBAC access enforcement', () => {
  beforeEach(() => {
    resolveUserContext.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
  });

  it('SUPER_ADMIN can access all', async () => {
    mockRoleLookup({ 'company-a': Role.SUPER_ADMIN }, [Role.SUPER_ADMIN]);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-a',
      allowedRoles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
    });
    expect(result?.role).toBe(Role.SUPER_ADMIN);
  });

  it('COMPANY_ADMIN blocked from OmniVyra health', async () => {
    mockRoleLookup({ 'company-a': Role.COMPANY_ADMIN }, [Role.COMPANY_ADMIN]);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-a',
      allowedRoles: [Role.SUPER_ADMIN],
    });
    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
  });

  it('CONTENT_CREATOR cannot publish', async () => {
    mockRoleLookup({ 'company-a': Role.CONTENT_CREATOR }, [Role.CONTENT_CREATOR]);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-a',
      allowedRoles: [Role.SUPER_ADMIN, Role.CONTENT_PUBLISHER],
    });
    expect(result).toBeNull();
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
  });

  it('VIEW_ONLY allowed for dashboard view roles', async () => {
    mockRoleLookup({ 'company-a': Role.VIEW_ONLY }, [Role.VIEW_ONLY]);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-a',
      allowedRoles: [
        Role.SUPER_ADMIN,
        Role.COMPANY_ADMIN,
        Role.CONTENT_CREATOR,
        Role.CONTENT_REVIEWER,
        Role.CONTENT_PUBLISHER,
        Role.VIEW_ONLY,
      ],
    });
    expect(result?.role).toBe(Role.VIEW_ONLY);
  });

  it('returns FORBIDDEN_ROLE when user has no roles', async () => {
    mockRoleLookup({}, []);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-a',
      allowedRoles: [Role.SUPER_ADMIN],
    });
    expect(result).toBeNull();
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
  });

  it('returns COMPANY_SCOPE_VIOLATION when company mismatch', async () => {
    mockRoleLookup({ 'company-a': Role.COMPANY_ADMIN }, [Role.COMPANY_ADMIN]);
    const res = createMockRes();
    const result = await enforceRole({
      req: {} as NextApiRequest,
      res,
      companyId: 'company-b',
      allowedRoles: [Role.COMPANY_ADMIN],
    });
    expect(result).toBeNull();
    expect(res.body?.error).toBe('COMPANY_SCOPE_VIOLATION');
  });
});
