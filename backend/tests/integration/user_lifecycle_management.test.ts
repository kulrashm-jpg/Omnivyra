import type { NextApiRequest, NextApiResponse } from 'next';
import inviteHandler from '../../../pages/api/users/invite';
import listHandler from '../../../pages/api/users/index';
import roleHandler from '../../../pages/api/users/[userId]/role';
import removeHandler from '../../../pages/api/users/[userId]/index';
import { logUserManagementAudit } from '../../services/campaignAuditService';
import { Role } from '../../services/rbacService';

jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  enforceRole: jest.fn(),
  getUserRole: jest.fn(),
  isSuperAdmin: jest.fn(),
}));

const { enforceRole, getUserRole, isSuperAdmin } = jest.requireMock('../../services/rbacService');

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      admin: {
        getUserByEmail: jest.fn(),
        createUser: jest.fn(),
        getUserById: jest.fn(),
      },
    },
  },
}));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
}));

jest.mock('../../services/campaignAuditService', () => {
  const actual = jest.requireActual('../../services/campaignAuditService');
  return {
    ...actual,
    logUserManagementAudit: jest.fn(),
  };
});

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

type RoleRow = { user_id: string; company_id: string; role: string };
const roleRows: RoleRow[] = [];
const authUsers: Record<string, { id: string; email: string }> = {};

const buildQuery = (table: string) => {
  const state: { filters: Record<string, any>; op?: string; updatePayload?: any } = { filters: {} };
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return query;
    }),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn((payload: any) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      rows.forEach((row) => roleRows.push(row));
      return query;
    }),
    update: jest.fn((payload: any) => {
      state.op = 'update';
      state.updatePayload = payload;
      return query;
    }),
    delete: jest.fn(() => {
      state.op = 'delete';
      return query;
    }),
    then: (resolve: any) => {
      if (table === 'user_company_roles') {
        if (state.op === 'update' && state.updatePayload) {
          roleRows.forEach((row) => {
            if (
              row.user_id === state.filters.user_id &&
              row.company_id === state.filters.company_id
            ) {
              Object.assign(row, state.updatePayload);
            }
          });
          const updated = roleRows.filter(
            (r) => r.user_id === state.filters.user_id && r.company_id === state.filters.company_id
          );
          return resolve({ data: updated, error: null });
        }
        if (state.op === 'delete') {
          for (let i = roleRows.length - 1; i >= 0; i -= 1) {
            const row = roleRows[i];
            if (
              row.user_id === state.filters.user_id &&
              row.company_id === state.filters.company_id
            ) {
              roleRows.splice(i, 1);
            }
          }
          return resolve({ data: null, error: null });
        }
        const filtered = roleRows.filter((row) => {
          if (state.filters.user_id && row.user_id !== state.filters.user_id) return false;
          if (state.filters.company_id && row.company_id !== state.filters.company_id) return false;
          if (state.filters.role && row.role !== state.filters.role) return false;
          if (state.filters.status && (row.status ?? 'active') !== state.filters.status) return false;
          return true;
        });
        return resolve({ data: filtered, error: null });
      }
      return resolve({ data: [], error: null });
    },
  };
  return query;
};

describe('User lifecycle management', () => {
  beforeEach(() => {
    roleRows.splice(0, roleRows.length);
    Object.keys(authUsers).forEach((key) => delete authUsers[key]);
    (isSuperAdmin as jest.Mock).mockImplementation(async (userId: string) => {
      return roleRows.some((r) => r.user_id === userId && r.role === 'SUPER_ADMIN');
    });
    (getUserRole as jest.Mock).mockImplementation(async (userId: string, companyId: string) => {
      const row = roleRows.find(
        (r) => r.user_id === userId && r.company_id === companyId && (r.status ?? 'active') === 'active'
      );
      if (!row) {
        const hasAnyRole = roleRows.some((r) => r.user_id === userId);
        return { role: null, error: hasAnyRole ? 'COMPANY_ACCESS_DENIED' : null };
      }
      return { role: row.role === 'ADMIN' ? Role.ADMIN : (row.role as any), error: null };
    });
    (enforceRole as jest.Mock).mockImplementation(async ({ req, res, companyId, allowedRoles }: any) => {
      const user = await resolveUserContext(req);
      if (!companyId) {
        res.status(400).json({ error: 'companyId required' });
        return null;
      }
      const superAdminRow = roleRows.find((r) => r.user_id === user.userId && r.role === 'SUPER_ADMIN');
      if (superAdminRow && allowedRoles.includes(Role.SUPER_ADMIN)) {
        return { userId: user.userId, role: Role.SUPER_ADMIN };
      }
      const row = roleRows.find(
        (r) => r.user_id === user.userId && r.company_id === companyId && (r.status ?? 'active') === 'active'
      );
      const role = row?.role ?? null;
      if (!role) {
        if (roleRows.some((r) => r.user_id === user.userId)) {
          res.status(403).json({ error: 'COMPANY_SCOPE_VIOLATION' });
          return null;
        }
        res.status(403).json({ error: 'FORBIDDEN_ROLE' });
        return null;
      }
      const roleToUse = role === 'ADMIN' ? Role.ADMIN : role;
      if (!allowedRoles.includes(roleToUse) && !allowedRoles.includes(role)) {
        res.status(403).json({ error: 'FORBIDDEN_ROLE' });
        return null;
      }
      return { userId: user.userId, role: roleToUse };
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => buildQuery(table));
    (supabase.auth.admin.getUserByEmail as jest.Mock).mockImplementation(async (email: string) => {
      const user = Object.values(authUsers).find((u) => u.email === email);
      return { data: { user }, error: null };
    });
    (supabase.auth.admin.createUser as jest.Mock).mockImplementation(async ({ email }: any) => {
      const id = `user-${Object.keys(authUsers).length + 1}`;
      const user = { id, email };
      authUsers[id] = user;
      return { data: { user }, error: null };
    });
    (supabase.auth.admin.getUserById as jest.Mock).mockImplementation(async (id: string) => {
      return { data: { user: authUsers[id] || null }, error: null };
    });
  });

  it('Super admin can invite user', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'super-1',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'super-1', company_id: 'company-a', role: 'SUPER_ADMIN' });
    const req = {
      method: 'POST',
      body: { email: 'new@example.com', companyId: 'company-b', role: 'CONTENT_MANAGER' },
      query: { companyId: 'company-b' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await inviteHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(roleRows.some((row) => row.company_id === 'company-b')).toBe(true);
  });

  it('Admin can invite user in own company', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-1', company_id: 'company-a', role: 'ADMIN' });
    const req = {
      method: 'POST',
      body: { email: 'own@example.com', companyId: 'company-a', role: 'CONTENT_CREATOR' },
      query: { companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await inviteHandler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('Admin cannot invite user in other company', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-2',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-2', company_id: 'company-a', role: 'ADMIN' });
    const req = {
      method: 'POST',
      body: { email: 'other@example.com', companyId: 'company-b', role: 'CONTENT_CREATOR' },
      query: { companyId: 'company-b' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await inviteHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('COMPANY_SCOPE_VIOLATION');
  });

  it('Content role cannot invite user (403)', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'creator-1',
      role: 'user',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'creator-1', company_id: 'company-a', role: 'CONTENT_CREATOR' });
    const req = {
      method: 'POST',
      body: { email: 'blocked@example.com', companyId: 'company-a', role: 'CONTENT_PLANNER' },
      query: { companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await inviteHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error).toBe('FORBIDDEN_ROLE');
  });

  it('Role update works', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-3',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-3', company_id: 'company-a', role: 'ADMIN' });
    roleRows.push({ user_id: 'target-1', company_id: 'company-a', role: 'CONTENT_CREATOR' });
    const req = {
      method: 'PATCH',
      query: { userId: 'target-1' },
      body: { role: 'CONTENT_MANAGER', companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await roleHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(roleRows.find((row) => row.user_id === 'target-1')?.role).toBe('CONTENT_MANAGER');
  });

  it('Remove user works', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-4',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-4', company_id: 'company-a', role: 'ADMIN' });
    roleRows.push({ user_id: 'target-2', company_id: 'company-a', role: 'CONTENT_CREATOR' });
    const req = {
      method: 'DELETE',
      query: { userId: 'target-2', companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await removeHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(roleRows.some((row) => row.user_id === 'target-2')).toBe(false);
  });

  it('List users scoped to company', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-5',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-5', company_id: 'company-a', role: 'ADMIN' });
    roleRows.push({ user_id: 'target-3', company_id: 'company-a', role: 'CONTENT_CREATOR' });
    roleRows.push({ user_id: 'target-4', company_id: 'company-b', role: 'CONTENT_MANAGER' });
    authUsers['target-3'] = { id: 'target-3', email: 't3@example.com' };
    authUsers['target-4'] = { id: 'target-4', email: 't4@example.com' };
    const req = {
      method: 'GET',
      query: { companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await listHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.users).toHaveLength(2);
  });

  it('Audit logs created', async () => {
    resolveUserContext.mockResolvedValue({
      userId: 'admin-6',
      role: 'admin',
      companyIds: ['company-a'],
      defaultCompanyId: 'company-a',
    });
    roleRows.push({ user_id: 'admin-6', company_id: 'company-a', role: 'ADMIN' });
    const req = {
      method: 'POST',
      body: { email: 'audit@example.com', companyId: 'company-a', role: 'CONTENT_MANAGER' },
      query: { companyId: 'company-a' },
    } as unknown as NextApiRequest;
    const res = createMockRes();
    await inviteHandler(req, res);
    expect(logUserManagementAudit).toHaveBeenCalled();
  });
});
