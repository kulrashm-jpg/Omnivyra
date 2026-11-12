/**
 * PRIVILEGE (2026-11-12): PATCH /api/team/self-joined took `role` from the
 * body unvalidated - an org admin could make a self-joined user COMPANY_ADMIN,
 * bypassing the governed promotion path. Now only non-admin roles are
 * confirmable; 0 matched rows is a 404 (never a 200 for nothing); a failed
 * notice is logged.
 */
export {};
const mockUpdates: Array<Record<string, unknown>> = [];
let mockUpdateRows: unknown[] | null = [{ user_id: 'u2' }];
let mockNotifyErr: { message: string } | null = null;

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'admin-1' } }),
}));
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      let op = 'select';
      for (const m of ['eq', 'select']) b[m] = () => b;
      b.update = (p: Record<string, unknown>) => { op = 'update'; mockUpdates.push(p); return b; };
      b.insert = () => { op = 'insert'; return b; };
      b.then = (ok: any, ko: any) => {
        const r = table === 'notifications'
          ? { data: null, error: mockNotifyErr }
          : op === 'update' ? { data: mockUpdateRows, error: null } : { data: [], error: null };
        return Promise.resolve(r).then(ok, ko);
      };
      return b;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
  },
}));

import handler from '../../../pages/api/team/self-joined';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
async function patch(role?: string) {
  const res = mockRes();
  await handler({ method: 'PATCH', query: { companyId: 'c1', userId: 'u2' }, body: role === undefined ? {} : { role }, headers: {} } as any, res);
  return res;
}
let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockUpdates.length = 0; mockUpdateRows = [{ user_id: 'u2' }]; mockNotifyErr = null;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it.each(['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'company_admin', 'anything'])('role %s is REFUSED (400), nothing written', async (role) => {
  const res = await patch(role);
  expect(res.statusCode).toBe(400);
  expect(res.body.code).toBe('ROLE_NOT_CONFIRMABLE');
  expect(mockUpdates).toEqual([]);
});

it.each(['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY'])('control: %s is confirmable (200)', async (role) => {
  const res = await patch(role);
  expect(res.statusCode).toBe(200);
  expect(mockUpdates).toEqual([expect.objectContaining({ role, join_source: 'invited' })]);
});

it('control: no role in the body defaults to CONTENT_CREATOR', async () => {
  const res = await patch();
  expect(res.statusCode).toBe(200);
  expect(mockUpdates[0]).toMatchObject({ role: 'CONTENT_CREATOR' });
});

it('0 rows matched (not self-joined) -> 404, never a 200 for nothing', async () => {
  mockUpdateRows = [];
  const res = await patch('VIEW_ONLY');
  expect(res.statusCode).toBe(404);
  expect(res.body.code).toBe('NOT_SELF_JOINED');
});

it('notification failure -> still 200 (role is set), and logged', async () => {
  mockNotifyErr = { message: 'down' };
  const res = await patch('VIEW_ONLY');
  expect(res.statusCode).toBe(200);
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('confirmation notification failed'))).toBe(true);
});
