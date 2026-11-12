/**
 * S2 (e1) - pages/api/auth/get-stored-phone.ts is IDENTITY-scoped (allow-list entry
 * own-phone-identity-scoped): it reads the caller's OWN phone by the authenticated user id.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false;
  const run = () => { const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))); return one ? (hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { message: 'not single' } }) : { data: hit, error: null }; };
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
let mockUser: Row | null = { id: 'user-a' };
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) }, supabaseAdmin: { from: (t: string) => mockTable(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => (mockUser ? { user: mockUser, error: null } : { user: null, error: 'no' }) }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/auth/get-stored-phone').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function get() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.end = () => res;
  await route({ method: 'GET', headers: {}, query: {} }, res);
  return res;
}
beforeEach(() => {
  mockUser = { id: 'user-a' };
  mockDb.free_credit_profiles = [
    { user_id: 'user-a', organization_id: '11111111-1111-4111-8111-111111111111', phone_number: '+15550001111' },
    { user_id: 'user-b', organization_id: '22222222-2222-4222-8222-222222222222', phone_number: '+15559998888' },
  ];
});
it("returns only the caller's own phone, never another user's", async () => {
  const r = await get();
  expect(r.statusCode).toBe(200);
  expect(r.body.phone).toBe('+15550001111');
  expect(JSON.stringify(r.body)).not.toContain('9998888');
});
it('without a session: 401, nothing read', async () => {
  mockUser = null;
  const r = await get();
  expect(r.statusCode).toBe(401);
});
