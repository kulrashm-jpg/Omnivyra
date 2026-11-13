/**
 * e1 (2026-11-12): /api/onboarding/validate-company-name is RETIRED - it had no caller and had been a
 * cross-tenant company-name enumeration oracle. It must answer 410 for every method and read nothing.
 */
export {};
const mockTouched: string[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => { mockTouched.push(t); throw new Error('must not read'); } } }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => { mockTouched.push('rate-limit'); return { allowed: true }; } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/onboarding/validate-company-name').default;
/* eslint-enable @typescript-eslint/no-var-requires */

it('answers 410 for every method, including a wildcard probe, and reads nothing', async () => {
  for (const method of ['POST', 'GET', 'PUT']) {
    const res: any = { statusCode: 0, body: null };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (x: unknown) => { res.body = x; return res; };
    await route({ method, headers: {}, query: {}, body: { companyName: 'Acme*' } }, res);
    expect([method, res.statusCode]).toEqual([method, 410]);
  }
  expect(mockTouched).toEqual([]);
});
