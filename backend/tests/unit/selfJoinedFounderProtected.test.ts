/**
 * PRIVILEGE (2026-11-12, e1 audit). The ONLY app writer of
 * join_source='self_joined' is onboarding/setup-company: the FOUNDING
 * COMPANY_ADMIN (the column defaults to 'invited'). /api/team/self-joined
 * PATCH / DELETE filtered on join_source only, so any ORGANIZATION_MANAGE holder
 * could demote or delete the founder - including the company's last admin.
 * The fake APPLIES eq / in filters over stored rows (a lenient fake hid this).
 */
export {};
type Row = { user_id: string; company_id: string; role: string; status: string; join_source: string };
let mockRows: Row[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'admin-2' } }),
}));
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
      let patch: Partial<Row> = {};
      const b: any = {};
      b.eq = (c: keyof Row, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.in = (c: keyof Row, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; };
      b.select = () => b;
      b.update = (p: Partial<Row>) => { op = 'update'; patch = p; return b; };
      b.delete = () => { op = 'delete'; return b; };
      b.insert = () => { op = 'insert'; return b; };
      b.then = (ok: any, ko: any) => {
        if (table !== 'user_company_roles') return Promise.resolve({ data: null, error: null }).then(ok, ko);
        const hit = mockRows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
        if (op === 'delete') mockRows = mockRows.filter((r) => !hit.includes(r));
        return Promise.resolve({ data: hit.map((r) => ({ user_id: r.user_id })), error: null }).then(ok, ko);
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
const call = async (method: 'PATCH' | 'DELETE', userId: string, role?: string) => {
  const res = mockRes();
  await handler({ method, query: { companyId: 'c1', userId }, body: role ? { role } : {}, headers: {} } as any, res);
  return res;
};
let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockRows = [
    { user_id: 'founder', company_id: 'c1', role: 'COMPANY_ADMIN', status: 'active', join_source: 'self_joined' },
    { user_id: 'member', company_id: 'c1', role: 'VIEW_ONLY', status: 'active', join_source: 'self_joined' },
  ];
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('CRITICAL: PATCH cannot demote the FOUNDING COMPANY_ADMIN (404, row unchanged)', async () => {
  const r = await call('PATCH', 'founder', 'VIEW_ONLY');
  expect(r.statusCode).toBe(404);
  expect(mockRows.find((x) => x.user_id === 'founder')).toMatchObject({ role: 'COMPANY_ADMIN', join_source: 'self_joined' });
});

it('CRITICAL: DELETE cannot remove the FOUNDING COMPANY_ADMIN (404, row kept)', async () => {
  const r = await call('DELETE', 'founder');
  expect(r.statusCode).toBe(404);
  expect(mockRows.some((x) => x.user_id === 'founder')).toBe(true);
});

it('control: a genuine self-joined NON-admin member is confirmed (200) and can be removed (200)', async () => {
  expect((await call('PATCH', 'member', 'CONTENT_CREATOR')).statusCode).toBe(200);
  expect(mockRows.find((x) => x.user_id === 'member')).toMatchObject({ role: 'CONTENT_CREATOR', join_source: 'invited' });
  mockRows.find((x) => x.user_id === 'member')!.join_source = 'self_joined';
  expect((await call('DELETE', 'member')).statusCode).toBe(200);
  expect(mockRows.some((x) => x.user_id === 'member')).toBe(false);
});

it('DELETE of a non-existent self-joined member -> 404, never a 200 for nothing', async () => {
  expect((await call('DELETE', 'nobody')).statusCode).toBe(404);
});
