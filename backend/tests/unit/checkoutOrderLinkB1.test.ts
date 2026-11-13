/**
 * B1 (financial-writes contract; e9 BLOCKING, e1 approved) - checkout/create-order must never hand the client a
 * provider order that the purchase does not record. Purchase closure resolves a paid order ONLY through
 * credit_purchases.provider_order_id; supabase-js returns write errors instead of throwing, so the unread link
 * write let a customer pay an order that could never be matched or closed.
 * Drives the REAL handler; the access wrapper, route factory, payment orchestrator and data layer are faked.
 */
export {};

type Row = Record<string, unknown>;
const mockState: {
  purchases: Row[]; failUpdate: { message: string } | null; updateZeroRows: boolean; failMark: { message: string } | null;
  orderOk: boolean; updates: Row[];
} = { purchases: [], failUpdate: null, updateZeroRows: false, failMark: null, orderOk: true, updates: [] };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withOrgAccess', () => ({
  withOrgAccess: (h: (req: any, res: any) => unknown) => (req: any, res: any) => { req.orgAccess = { orgId: 'org-1' }; return h(req, res); },
}));
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: async () => ({ principal: { userId: 'u-1' } }) }));
jest.mock('../../services/pricingConfigService', () => ({ getFxConfig: async () => ({}) }));
jest.mock('../../services/payments/orchestrator', () => ({
  createOrder: async () => (mockState.orderOk
    ? { order: { providerOrderId: 'order_ABC', amountSubunits: 10000 }, provider: 'razorpay', attempts: [{ provider: 'razorpay', ok: true }] }
    : { order: null, provider: null, attempts: [{ provider: 'razorpay', ok: false }] }),
  getProviderCredentials: () => ({ keyId: 'rzp_test_key' }),
  getActiveMode: () => 'test',
}));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      let patch: Row | null = null;
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => (table === 'credit_packages'
        ? { data: { id: 'pkg-1', credits: 100, price: 100, sku: 'p100', canonical_usd_price: null, is_active: true }, error: null }
        : { data: null, error: null });
      b.insert = () => ({ select: () => ({ single: async () => { mockState.purchases.push({ id: 'pur-1', status: 'pending' }); return { data: { id: 'pur-1' }, error: null }; } }) });
      b.update = (p: Row) => { patch = p; return b; };
      b.then = (res: any, rej: any) => {
        // a non-.select() update resolves here (the "mark failed" write)
        mockState.updates.push({ ...patch });
        const isMark = patch && (patch as Row).status === 'failed';
        const err = isMark ? mockState.failMark : null;
        if (!err && patch) Object.assign(mockState.purchases[0] ?? {}, patch);
        return Promise.resolve({ data: null, error: err }).then(res, rej);
      };
      const origSelect = b.select;
      b.select = (...a: unknown[]) => {
        if (!patch) return origSelect(...a);
        // the link update: .update(...).eq(...).select('id')
        return Promise.resolve((() => {
          mockState.updates.push({ ...patch });
          if (mockState.failUpdate) return { data: null, error: mockState.failUpdate };
          if (mockState.updateZeroRows) return { data: [], error: null };
          Object.assign(mockState.purchases[0], patch);
          return { data: [{ id: 'pur-1' }], error: null };
        })());
      };
      return b;
    },
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/billing/checkout/create-order').default;
const { logger } = require('../../services/logger');
/* eslint-enable @typescript-eslint/no-var-requires */

function call() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return Promise.resolve(handler({ method: 'POST', body: { package_id: 'pkg-1', currency: 'INR' }, query: {}, headers: {} }, res)).then(() => res);
}
const errorEvents = () => (logger.error as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);

beforeEach(() => {
  mockState.purchases = []; mockState.failUpdate = null; mockState.updateZeroRows = false; mockState.failMark = null;
  mockState.orderOk = true; mockState.updates = [];
  (logger.error as jest.Mock).mockClear();
});

it('CONTROL: the link is recorded -> 201 with the provider order id', async () => {
  const res = await call();
  expect(res.statusCode).toBe(201);
  expect(res.body).toMatchObject({ ok: true, purchase_id: 'pur-1', provider_order_id: 'order_ABC' });
  expect(mockState.purchases[0]).toMatchObject({ provider: 'razorpay', provider_order_id: 'order_ABC' });
  expect(errorEvents()).toEqual([]);
});

it('the link write FAILS -> 503 order_link_failed, NO order id to the client, purchase marked failed, logged', async () => {
  mockState.failUpdate = { message: 'connection reset' };
  const res = await call();
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ ok: false, error: 'order_link_failed' });
  expect(JSON.stringify(res.body)).not.toContain('order_ABC');
  expect(errorEvents()).toContain('checkout_order_link_failed');
  expect(mockState.purchases[0].status).toBe('failed');
});

it('the link write matches 0 rows -> 503 (a null error is not an answer)', async () => {
  mockState.updateZeroRows = true;
  const res = await call();
  expect(res.statusCode).toBe(503);
  expect(JSON.stringify(res.body)).not.toContain('order_ABC');
  expect((logger.error as jest.Mock).mock.calls.find((c: unknown[]) => c[0] === 'checkout_order_link_failed')[1]).toMatchObject({ message: 'matched 0 rows' });
});

it('order creation fails AND the mark-failed write fails -> still 502, and the unrecorded mark is logged', async () => {
  mockState.orderOk = false;
  mockState.failMark = { message: 'timeout' };
  const res = await call();
  expect(res.statusCode).toBe(502);
  expect(errorEvents()).toContain('checkout_purchase_mark_failed_unrecorded');
});
