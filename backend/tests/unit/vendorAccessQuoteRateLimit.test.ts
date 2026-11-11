/**
 * The public vendor-access quote is rate limited per IP, BEFORE any pricing
 * read (GOV-SECURITY condition, 2026-11-11): its reads hit Postgres per call.
 */
const counts = new Map<string, number>();
const seenConfigs: Array<{ keyPrefix: string; limit: number; windowSecs: number }> = [];
jest.mock('../../../lib/auth/rateLimit', () => ({
  // A faithful fixed-window double: allowed while the count before this
  // request is below the configured limit.
  checkRateLimit: async (id: string, config: { keyPrefix: string; limit: number; windowSecs: number }) => {
    seenConfigs.push(config);
    const k = `${config.keyPrefix}:${id}`;
    const before = counts.get(k) ?? 0;
    counts.set(k, before + 1);
    return { allowed: before < config.limit, remaining: Math.max(0, config.limit - before - 1), resetAt: 0, bypassed: false };
  },
}));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: (req: { headers: Record<string, string> }) => req.headers['x-test-ip'] }));
let pricingReads = 0;
jest.mock('../../services/enrichment/centralVendorAccess', () => ({
  STANDARD_CREDIT_RATE_USD: 0.01,
  quoteCentralVendorAccess: async () => { pricingReads += 1; return [{ vendor: 'apollo', unit: 'credit', creditsPerUnit: 30, available: true }]; },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler, { VENDOR_QUOTE_LIMIT } from '../../../pages/api/billing/vendor-access-quote';

function call(ip: string) {
  const res: Record<string, unknown> & { statusCode?: number } = {};
  const r = {
    status(c: number) { res.statusCode = c; return r; },
    json(b: unknown) { res.body = b; return r; },
    end() { return r; },
    setHeader() { return r; },
  };
  return (handler as unknown as (q: unknown, s: unknown) => Promise<unknown>)({ method: 'GET', headers: { 'x-test-ip': ip } }, r).then(() => res);
}

beforeEach(() => { counts.clear(); seenConfigs.length = 0; pricingReads = 0; });

it('N = limit requests from one IP succeed; request N+1 gets 429 and makes NO pricing read', async () => {
  const N = VENDOR_QUOTE_LIMIT.limit;
  for (let i = 0; i < N; i++) expect((await call('203.0.113.7')).statusCode).toBe(200);
  expect(pricingReads).toBe(N);
  const over = await call('203.0.113.7');
  expect(over.statusCode).toBe(429);
  expect(pricingReads).toBe(N);            // the refused request never reached the database
});

it('the limit is per IP: another client is unaffected', async () => {
  for (let i = 0; i <= VENDOR_QUOTE_LIMIT.limit; i++) await call('203.0.113.7');
  expect((await call('198.51.100.9')).statusCode).toBe(200);
});

it('uses its own key prefix and a bounded window', () => {
  expect(VENDOR_QUOTE_LIMIT).toEqual({ keyPrefix: 'rl:billing:vendor-access-quote', limit: 30, windowSecs: 60 });
});
