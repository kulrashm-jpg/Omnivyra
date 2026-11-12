/**
 * MONEY unread-error sites (owner rule 2026-11-11/12): checkout/verify and
 * checkout/create-order now READ every database error on the money path.
 *
 *  - verify: a failed purchase lookup is 503 (retryable), never the 404
 *    "purchase_not_found" a customer who just paid used to get; nothing is
 *    verified or settled on an unread row.
 *  - create-order: a failed package lookup is 503 with no DB message leaked;
 *    if the provider order id cannot be recorded (error OR 0 rows) the order is
 *    NOT handed to the browser (no key_id / client token) and the row is closed;
 *    a failed 'failed' flip is logged, not swallowed.
 */
export {};
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const PURCHASE = '11111111-0000-4000-8000-0000000000p1';

type Res = { data: unknown; error: { message: string } | null };
let mockScript: Record<string, (op: string, payload: unknown) => Res> = {};
const mockWrites: Array<{ table: string; op: string; payload: unknown }> = [];
const mockLogs: Array<[string, string]> = [];
const mockSinks: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withOrgAccess', () => ({
  withOrgAccess: (h: (req: any, res: any) => unknown) => (req: any, res: any) => { req.orgAccess = { orgId: ORG }; return h(req, res); },
}));
jest.mock('../../services/logger', () => ({
  logger: {
    error: (e: string) => mockLogs.push(['error', e]),
    warn: (e: string) => mockLogs.push(['warn', e]),
    info: (e: string) => mockLogs.push(['info', e]),
  },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      let payload: unknown = null;
      const b: any = {};
      const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))(op, payload);
      b.select = () => b;
      b.eq = () => b;
      b.insert = (p: unknown) => { op = 'insert'; payload = p; mockWrites.push({ table, op, payload: p }); return b; };
      b.update = (p: unknown) => { op = 'update'; payload = p; mockWrites.push({ table, op, payload: p }); return b; };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: async () => ({ ok: true, principal: { userId: 'u1' } }) }));
jest.mock('../../services/pricingConfigService', () => ({ getFxConfig: async () => ({}) }));
jest.mock('../../services/payments/orchestrator', () => ({
  createOrder: async () => {
    mockSinks.push('provider:createOrder');
    return { order: { providerOrderId: 'order_1', amountSubunits: 100, clientToken: 'tok' }, provider: 'razorpay', attempts: [] };
  },
  getProviderCredentials: () => ({ keyId: 'rzp_key' }),
  getActiveMode: () => 'test',
  verifyPayment: async () => { mockSinks.push('provider:verifyPayment'); return { verified: true }; },
}));
jest.mock('../../services/billing/topupInvoiceService', () => ({ generateTopupInvoice: async () => null }));
jest.mock('../../services/billing/purchaseClosureService', () => ({
  closePurchaseFromClient: async () => { mockSinks.push('closePurchaseFromClient'); return { action: 'failed' }; },
  fulfillProviderConfirmedPurchase: async () => { mockSinks.push('fulfill'); return { ok: true, creditsGranted: 10 }; },
}));

import verify from '../../../pages/api/billing/checkout/verify';
import createOrder from '../../../pages/api/billing/checkout/create-order';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
const post = (body: unknown) => ({ method: 'POST', body, query: {}, headers: {} }) as any;
const PKG_OK: Res = { data: { id: 'pkg', credits: 100, price: 500, sku: null, canonical_usd_price: null, is_active: true }, error: null };

beforeEach(() => { mockScript = {}; mockWrites.length = 0; mockLogs.length = 0; mockSinks.length = 0; });

describe('checkout/verify', () => {
  it('purchase lookup error -> 503 retryable, NOT 404; nothing verified or settled', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: { message: 'connection reset' } });
    const res = mockRes();
    await verify(post({ purchase_id: PURCHASE }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: 'purchase_lookup_unavailable', retryable: true });
    expect(mockSinks).toEqual([]);
    expect(mockLogs).toContainEqual(['error', 'checkout_verify_purchase_lookup_failed']);
  });

  it('a genuinely absent purchase is still 404 (unchanged)', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: null });
    const res = mockRes();
    await verify(post({ purchase_id: PURCHASE }), res);
    expect(res.statusCode).toBe(404);
    expect(mockSinks).toEqual([]);
  });

  it('an own purchase that reads cleanly still settles (unchanged)', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: { id: PURCHASE, organization_id: ORG, provider_order_id: 'order_1' }, error: null });
    const res = mockRes();
    await verify(post({ purchase_id: PURCHASE, payment_id: 'pay_1', signature: 's' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockSinks).toEqual(['provider:verifyPayment', 'fulfill']);
  });
});

describe('checkout/create-order', () => {
  const inserted = (): Res => ({ data: { id: PURCHASE }, error: null });

  it('package lookup error -> 503, the DB message never reaches the client, no purchase, no provider call', async () => {
    mockScript['credit_packages:select'] = () => ({ data: null, error: { message: 'secret internal detail' } });
    const res = mockRes();
    await createOrder(post({ package_id: 'pkg' }), res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(mockWrites).toEqual([]);
    expect(mockSinks).toEqual([]);
  });

  it.each([
    ['an error', { data: null, error: { message: 'timeout' } } as Res],
    ['0 rows', { data: [], error: null } as Res],
  ])('provider order id not recorded (%s) -> 503, order NOT handed out, row closed as failed', async (_label, recordResult) => {
    mockScript['credit_packages:select'] = () => PKG_OK;
    mockScript['credit_purchases:insert'] = inserted;
    mockScript['credit_purchases:update'] = (_op, payload) =>
      ((payload as any)?.provider_order_id ? recordResult : { data: null, error: null });
    const res = mockRes();
    await createOrder(post({ package_id: 'pkg' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: 'order_record_failed' });
    expect(JSON.stringify(res.body)).not.toMatch(/rzp_key|tok|order_1/);
    expect(mockWrites.filter((w) => w.op === 'update').map((w) => w.payload)).toEqual([
      { provider: 'razorpay', provider_order_id: 'order_1' },
      { status: 'failed' },
    ]);
    expect(mockLogs).toContainEqual(['error', 'checkout_provider_order_record_failed']);
  });

  it('a failed "failed" flip after a provider failure is logged, not swallowed', async () => {
    mockScript['credit_packages:select'] = () => PKG_OK;
    mockScript['credit_purchases:insert'] = inserted;
    mockScript['credit_purchases:update'] = () => ({ data: null, error: { message: 'down' } });
    const orch = jest.requireMock('../../services/payments/orchestrator');
    const orig = orch.createOrder;
    orch.createOrder = async () => ({ order: null, provider: null, attempts: [] });
    try {
      const res = mockRes();
      await createOrder(post({ package_id: 'pkg' }), res);
      expect(res.statusCode).toBe(502);
      expect(mockLogs).toContainEqual(['error', 'checkout_purchase_fail_mark_failed']);
    } finally {
      orch.createOrder = orig;
    }
  });

  // MUTANT SURVIVOR (2026-11-12): the same log event is written at TWO sites
  // (the failed flip after a provider failure, and the close after an
  // unrecorded order id). This pins the SECOND one on its own path.
  it('order id not recorded AND the close flip fails -> 503, the close failure is logged', async () => {
    mockScript['credit_packages:select'] = () => PKG_OK;
    mockScript['credit_purchases:insert'] = inserted;
    mockScript['credit_purchases:update'] = (_op, payload) =>
      ((payload as any)?.provider_order_id ? { data: null, error: { message: 'timeout' } } : { data: null, error: { message: 'down' } });
    const res = mockRes();
    await createOrder(post({ package_id: 'pkg' }), res);
    expect(res.statusCode).toBe(503);
    expect(mockLogs).toContainEqual(['error', 'checkout_provider_order_record_failed']);
    expect(mockLogs).toContainEqual(['error', 'checkout_purchase_fail_mark_failed']);
  });

  it('the recorded happy path still returns the order (unchanged)', async () => {
    mockScript['credit_packages:select'] = () => PKG_OK;
    mockScript['credit_purchases:insert'] = inserted;
    mockScript['credit_purchases:update'] = () => ({ data: [{ id: PURCHASE }], error: null });
    const res = mockRes();
    await createOrder(post({ package_id: 'pkg' }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ ok: true, provider_order_id: 'order_1', key_id: 'rzp_key' });
  });
});
