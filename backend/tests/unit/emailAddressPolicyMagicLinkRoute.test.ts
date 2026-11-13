/**
 * e1 2026-11-12 (defence in depth): the address policy is WIRED where an email first enters. magic-link refuses the
 * crafted takeover payload with 400 BEFORE any database read; an ordinary address proceeds.
 */
export {};
const mockReads: string[] = [];
function mockTable(table: string) {
  const b: any = {
    select: () => b, eq: () => b, ilike: () => b, or: () => b, limit: () => b, order: () => b,
    maybeSingle: () => b, single: () => b,
    then: (ok: any, ko: any) => { mockReads.push(table); return Promise.resolve({ data: null, error: null }).then(ok, ko); },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockTable(t), auth: { signInWithOtp: async () => ({ error: null }), admin: {} } },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), EMAIL_LINK_LIMIT: {} }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/auth/magic-link').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(email: string) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'POST', headers: {}, query: {}, body: { email } }, res).catch(() => undefined);
  return res;
}
beforeEach(() => { mockReads.length = 0; });

it('the crafted takeover payload is refused with 400 before ANY database read', async () => {
  const r = await post('a,supabase_uid.eq.sb-victim,email.eq.z@acme.com');
  expect(r.statusCode).toBe(400);
  expect(mockReads).toEqual([]);
});

it('control: an ordinary address gets past the policy (the route reads on)', async () => {
  await post('john@acme.com');
  expect(mockReads.length).toBeGreaterThan(0);
});
