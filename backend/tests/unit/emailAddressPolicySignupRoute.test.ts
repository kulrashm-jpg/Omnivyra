/**
 * e1 2026-11-13 (05 review - merge hazard): the address policy at POST /api/auth/signup is pinned by BEHAVIOUR, not
 * by a line's survival. P1 (fix/signup-intent-bootstrap-gate) rewrites ~190 lines of signup.ts and this branch adds
 * the single policy line; if a merge ever drops it, this suite fails. The crafted takeover payload is refused with 400
 * BEFORE any database read or write; an ordinary address proceeds to the database.
 */
export {};
const mockTouched: string[] = [];
function mockTable(table: string) {
  const b: any = {
    select: () => b, eq: () => b, in: () => b, gt: () => b, lt: () => b, ilike: () => b, or: () => b, order: () => b, limit: () => b,
    insert: () => b, update: () => b, upsert: () => b,
    maybeSingle: () => b, single: () => b,
    then: (ok: any, ko: any) => { mockTouched.push(table); return Promise.resolve({ data: null, error: null }).then(ok, ko); },
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockTable(t),
    rpc: async (fn: string) => { mockTouched.push(`rpc:${fn}`); return { data: null, error: null }; },
    auth: { admin: {} },
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), EMAIL_LINK_LIMIT: {} }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
jest.mock('../../../lib/auth/captcha', () => ({ verifyCaptchaToken: async () => ({ ok: true }), CAPTCHA_FAILED_RESPONSE: { error: 'captcha' } }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/auth/signup').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(email: unknown) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'POST', headers: {}, query: {}, body: { email, companyName: 'Acme' } }, res).catch(() => undefined);
  return res;
}
beforeEach(() => { mockTouched.length = 0; });

it('the crafted takeover payload is refused with 400 before ANY database read or write', async () => {
  for (const email of ['a,supabase_uid.eq.sb-victim,email.eq.z@acme.com', '"a,b"@acme.com', 'jo%hn@acme.com']) {
    mockTouched.length = 0;
    const r = await post(email);
    expect([email, r.statusCode]).toEqual([email, 400]);
    expect([email, mockTouched]).toEqual([email, []]);
  }
});

it('a non-string email is a 400, not a 500', async () => {
  expect((await post(42)).statusCode).toBe(400);
  expect(mockTouched).toEqual([]);
});

it('control: an ordinary address gets past the policy (the route reaches the database)', async () => {
  await post('john@acme.com');
  expect(mockTouched.length).toBeGreaterThan(0);
});
