/**
 * PRIVILEGE (e9 ruling, 2026-11-12). GET /api/super-admin/plans/analytics
 * decided "super admin" from users.role - a LEGACY column (no CHECK; prod holds
 * NULL / 'admin' / COMPANY_ADMIN) and so a second source of super-admin truth.
 * Now it uses the canonical source (an active user_company_roles SUPER_ADMIN
 * row via isPlatformSuperAdmin), as its sibling read routes do.
 */
export {};
let mockUsersRole: string | null = null;
let mockCanonicalSa = false;
let mockLegacySession: unknown = null;
const mockTablesRead: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'u1' }, error: null }),
}));
jest.mock('@/backend/services/superAdminSession', () => ({ getLegacySuperAdminSession: () => mockLegacySession }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async (id: string) => id === 'u1' && mockCanonicalSa }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      mockTablesRead.push(t);
      const b: any = {};
      for (const m of ['select', 'eq', 'in']) b[m] = () => b;
      b.maybeSingle = async () => ({ data: t === 'users' ? { role: mockUsersRole } : null, error: null });
      b.then = (ok: any, ko: any) => Promise.resolve({ data: [], error: null }).then(ok, ko);
      return b;
    },
  },
}));

import handler from '../../../pages/api/super-admin/plans/analytics';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const get = async () => { const res = mockRes(); await handler({ method: 'GET', query: {}, headers: {} } as any, res); return res; };
beforeEach(() => { mockUsersRole = null; mockCanonicalSa = false; mockLegacySession = null; mockTablesRead.length = 0; });

it('users.role = SUPER_ADMIN WITHOUT a canonical super-admin row -> 403 (the legacy column grants nothing)', async () => {
  mockUsersRole = 'SUPER_ADMIN';
  const res = await get();
  expect(res.statusCode).toBe(403);
  expect(mockTablesRead).not.toContain('users');
});

it('canonical super-admin row -> allowed (200)', async () => {
  mockCanonicalSa = true;
  expect((await get()).statusCode).toBe(200);
});

it('legacy super-admin session -> allowed (unchanged)', async () => {
  mockLegacySession = { id: 'legacy' };
  expect((await get()).statusCode).toBe(200);
});

it('neither -> 403', async () => {
  expect((await get()).statusCode).toBe(403);
});
