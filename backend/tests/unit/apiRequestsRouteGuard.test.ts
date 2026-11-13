/**
 * ROUTE GUARD for UI step 7b (e1's ask). The client's approve/reject call must be one
 * the server actually serves. Earlier the /social-platforms hook sent
 * PATCH /api/external-apis/requests, a route that answers 405, and a mocked unit pin
 * kept passing. These tests run the REAL handlers:
 *   - PATCH on /api/external-apis/requests → 405 (the old, broken call);
 *   - the client's URL shape maps to requests/[id], which serves PUT;
 *   - a signed-in member WITHOUT MANAGE_EXTERNAL_APIS gets 403 from [id] and nothing is
 *     written (authorization is server-side; the hook gates nothing).
 */
import { apiRequestStatusUrl } from '../../../hooks/useApiRequestsQueue';

const MEMBER = 'user-member';
const COMPANY = 'company-a';
const writes: unknown[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: MEMBER }, error: null })),
}));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: jest.fn(() => null) }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => ({
    userId: MEMBER, role: 'user', companyIds: [COMPANY], defaultCompanyId: COMPANY, authenticated: true,
  })),
}));
jest.mock('../../services/rbacService', () => ({
  isSuperAdmin: jest.fn(async () => false),
  isPlatformSuperAdmin: jest.fn(async () => false),
  // A real member of the company, but a role without MANAGE_EXTERNAL_APIS.
  getUserRole: jest.fn(async () => ({ role: 'CONTENT_CREATOR', error: null })),
  getCompanyRoleIncludingInvited: jest.fn(async () => 'CONTENT_CREATOR'),
  hasPermission: jest.fn(async (role: string, perm: string) =>
    perm === 'MANAGE_EXTERNAL_APIS' ? role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN' : false),
}));
jest.mock('../../services/externalApiService', () => ({
  validatePlatformConfig: jest.fn(() => ({ ok: true })),
  saveTenantPlatformConfig: jest.fn(async () => { writes.push('provision'); }),
}));
jest.mock('../../db/supabaseClient', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) chain[m] = () => chain;
  chain.single = async () => ({ data: { id: 'r1', company_id: COMPANY, status: 'pending_admin_review' }, error: null });
  chain.maybeSingle = chain.single;
  chain.update = () => { writes.push('update'); return chain; };
  chain.insert = () => { writes.push('insert'); return chain; };
  return { supabase: { from: () => chain } };
});

import requestsHandler from '../../../pages/api/external-apis/requests';
import requestByIdHandler from '../../../pages/api/external-apis/requests/[id]';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}

beforeEach(() => {
  writes.length = 0;
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requests route guard', () => {
  it('PATCH /api/external-apis/requests → 405 (the old /social-platforms call never worked)', async () => {
    const res = mockRes();
    await (requestsHandler as any)(
      { method: 'PATCH', url: '/api/external-apis/requests', query: { companyId: COMPANY }, body: { id: 'r1', status: 'approved' } },
      res,
    );
    expect(res.statusCode).toBe(405);
    expect(writes).toEqual([]);
  });

  it("the client's approve/reject URL targets requests/[id], which serves PUT", () => {
    const url = apiRequestStatusUrl('r1', COMPANY);
    expect(url).toMatch(/^\/api\/external-apis\/requests\/[^/?]+\?companyId=/);
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/api/external-apis/requests/[id].ts'), 'utf8') as string;
    expect(src).toMatch(/req\.method !== 'PUT'/);
  });

  it('[id] PUT by a member WITHOUT MANAGE_EXTERNAL_APIS → 403, nothing written', async () => {
    const res = mockRes();
    await (requestByIdHandler as any)(
      { method: 'PUT', url: '/api/external-apis/requests/r1', query: { id: 'r1', companyId: COMPANY }, body: { status: 'approved' } },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(writes).toEqual([]);
  });
});
