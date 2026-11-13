/**
 * Item 8 (financial-writes contract; e9 NON-BLOCKING, fix now): the super-admin pricing route must never report a
 * pricing change as saved when the write failed. The setters return the database result (supabase-js does not
 * throw); the route used to ignore it and answer 200 with the reloaded (unchanged) config.
 * Drives the REAL handler; capability guard, rate limit and pricing service are faked.
 */
export {};
const mockSetter = { error: null as { message: string } | null };
const mockCalls: string[] = [];
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: 'sa-1' } }) }));
jest.mock('../../services/pricingConfigService', () => {
  const result = async (name: string) => { mockCalls.push(name); return { data: null, error: mockSetter.error }; };
  return {
    getFxConfig: async () => ({ INR: 83 }),
    getPlanPricing: async () => [],
    setFxRate: () => result('fx'),
    setPriceOverride: () => result('override'),
    setPlanPricing: () => result('plan'),
  };
});
/* eslint-disable @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/super-admin/pricing/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */
function call(body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  return Promise.resolve(handler({ method: 'POST', body, query: {}, headers: {} }, res)).then(() => res);
}
beforeEach(() => { mockSetter.error = null; mockCalls.length = 0; });

it.each([
  ['fx', { action: 'fx', currency: 'INR', rate: 84 }],
  ['override', { action: 'override', sku: 'p100', currency: 'INR', amount: 499 }],
  ['plan', { action: 'plan', plan_key: 'pro', founder_usd: 19 }],
])('CONTROL (%s): a recorded write -> 200 ok', async (_n, body) => {
  const res = await call(body);
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true });
});

it.each([
  ['fx', { action: 'fx', currency: 'INR', rate: 84 }],
  ['override', { action: 'override', sku: 'p100', currency: 'INR', amount: 499 }],
  ['plan', { action: 'plan', plan_key: 'pro', founder_usd: 19 }],
])('a FAILED %s write -> 500 pricing_write_failed, never "saved"', async (name, body) => {
  mockSetter.error = { message: 'permission denied for table billing_fx_rates' };
  const res = await call(body);
  expect(mockCalls).toEqual([name]);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ ok: false, error: 'pricing_write_failed', detail: 'permission denied for table billing_fx_rates' });
});
