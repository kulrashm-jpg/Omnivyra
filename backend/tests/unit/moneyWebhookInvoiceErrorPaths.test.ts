/**
 * MONEY unread-error sites (owner rule 2026-11-11/12): payment webhooks and
 * the invoice PDF read every database error on the money path.
 *
 *  - stripe/webhook: the purchase lookup runs BEFORE the event is recorded; a
 *    failed read used to answer "no purchase", record the event against
 *    nothing and mark it processed - Stripe's retry was then a 'duplicate' and
 *    the credits were never granted. Now it throws -> 500 -> nothing recorded,
 *    Stripe retries the whole event. The REAL processStripeWebhookEvent runs.
 *  - webhooks/payments/[provider]: a failed read was logged as "unmatched" and
 *    answered 200, so the provider never redelivered. Now 500, no fulfilment.
 *  - invoices/[id]/pdf: a failed invoice read was a 404, a failed line-item
 *    read rendered an invoice with no lines. Both now 503, nothing rendered.
 */
export {};
import { EventEmitter } from 'events';

const ORG = 'a0000000-0000-4000-8000-00000000000a';
type Res = { data: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockSinks: string[] = [];
const mockLogs: string[] = [];

function mockBuilder(table: string) {
  let op = 'select';
  const b: any = {};
  const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
  for (const m of ['select', 'eq', 'or', 'order', 'limit']) b[m] = () => b;
  b.update = () => { op = 'update'; return b; };
  b.insert = () => { op = 'insert'; return b; };
  b.maybeSingle = async () => result();
  b.single = async () => result();
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withOrgAccess', () => ({ withOrgAccess: (h: unknown) => h }));
jest.mock('../../services/logger', () => ({
  logger: { error: (e: string) => mockLogs.push(e), warn: (e: string) => mockLogs.push(e), info: () => undefined },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockBuilder(t) }));
jest.mock('../../services/purchaseService', () => ({
  recordPaymentProviderEvent: async () => { mockSinks.push('recordEvent'); return { id: 'evt-row', duplicate: false }; },
  completePurchase: async () => { mockSinks.push('completePurchase'); return { success: true, purchaseId: 'p', creditsGranted: 1 }; },
  failPurchase: async () => { mockSinks.push('failPurchase'); },
}));
jest.mock('../../services/billingSubscriptionService', () => ({ applyStripeSubscriptionEvent: async () => undefined }));
jest.mock('../../services/payments/stripeWebhookService', () => ({
  ...jest.requireActual('../../services/payments/stripeWebhookService'),
  verifyStripeWebhookSignature: () => ({ ok: true }),
}));
jest.mock('../../services/payments/orchestrator', () => ({
  handleWebhook: async () => ({ verified: true, eventId: 'e1', eventType: 'payment.captured', recorded: true }),
}));
let mockFulfillResult: { ok: boolean; code?: string; detail?: string } = { ok: true };
jest.mock('../../services/billing/purchaseClosureService', () => ({
  fulfillProviderConfirmedPurchase: async () => { mockSinks.push('fulfill'); return mockFulfillResult; },
}));
jest.mock('pdfkit', () => jest.fn().mockImplementation(() => { mockSinks.push('pdf'); throw new Error('stop: pdf rendered'); }));

import stripeWebhook from '../../../pages/api/stripe/webhook';
import providerWebhook from '../../../pages/api/webhooks/payments/[provider]';
import invoicePdf from '../../../pages/api/billing/invoices/[id]/pdf';

function rawReq(body: string, extra: Record<string, unknown>) {
  const req: any = Object.assign(new EventEmitter(), { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, query: {} }, extra);
  setImmediate(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
  return req;
}
function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  r.end = () => r;
  return r;
}

const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
beforeAll(() => { process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_only'; });
afterAll(() => { if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prevSecret; });
beforeEach(() => { mockScript = {}; mockSinks.length = 0; mockLogs.length = 0; mockFulfillResult = { ok: true }; });

const STRIPE_EVENT = JSON.stringify({
  id: 'evt_1', type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_1', object: 'payment_intent', amount: 1000, currency: 'usd', metadata: { organization_id: ORG } } },
});

describe('stripe/webhook', () => {
  it('purchase lookup error -> 500, the event is NOT recorded, nothing granted (Stripe will retry)', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: { message: 'connection reset' } });
    const res = mockRes();
    await stripeWebhook(rawReq(STRIPE_EVENT, {}), res);
    expect(res.statusCode).toBe(500);
    expect(mockSinks).toEqual([]);
  });

  it('control: a clean "no purchase" read still records the event (unchanged)', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: null });
    const res = mockRes();
    await stripeWebhook(rawReq(STRIPE_EVENT, {}), res);
    expect(mockSinks).toContain('recordEvent');
  });

  it('a failed event-status write is logged, not swallowed', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: null });
    mockScript['payment_provider_events:update'] = () => ({ data: null, error: { message: 'down' } });
    const res = mockRes();
    await stripeWebhook(rawReq(STRIPE_EVENT, {}), res);
    expect(mockLogs).toContain('stripe_webhook_mark_event_failed');
  });
});

describe('webhooks/payments/[provider]', () => {
  const CAPTURED = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 100, currency: 'INR' } } } });

  it('purchase lookup error -> 500 retryable (NOT a 200 "unmatched"), no fulfilment', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: null, error: { message: 'timeout' } });
    const res = mockRes();
    await providerWebhook(rawReq(CAPTURED, { query: { provider: 'razorpay' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'purchase_lookup_unavailable', retryable: true });
    expect(mockSinks).toEqual([]);
    expect(mockLogs).toContain('payment_webhook_purchase_lookup_failed');
    expect(mockLogs).not.toContain('payment_webhook_unmatched_order');
  });

  it('fulfilment UNAVAILABLE (transient read failure inside the chokepoint) -> 500, never a 200 "handled"', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: { id: 'p1', status: 'pending', fulfillment_status: 'pending' }, error: null });
    mockFulfillResult = { ok: false, code: 'UNAVAILABLE', detail: 'purchase_read_failed' };
    const res = mockRes();
    await providerWebhook(rawReq(CAPTURED, { query: { provider: 'razorpay' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'fulfillment_unavailable', retryable: true });
  });

  it('control: a non-transient fulfilment refusal keeps the existing 200 + logged block', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: { id: 'p1', status: 'pending', fulfillment_status: 'pending' }, error: null });
    mockFulfillResult = { ok: false, code: 'UNKNOWN', detail: 'provider_unpaid' };
    const res = mockRes();
    await providerWebhook(rawReq(CAPTURED, { query: { provider: 'razorpay' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockLogs).toContain('payment_webhook_fulfillment_blocked');
  });

  it('control: a matched pending purchase is still fulfilled (unchanged)', async () => {
    mockScript['credit_purchases:select'] = () => ({ data: { id: 'p1', status: 'pending', fulfillment_status: 'pending' }, error: null });
    const res = mockRes();
    await providerWebhook(rawReq(CAPTURED, { query: { provider: 'razorpay' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockSinks).toEqual(['fulfill']);
  });
});

describe('billing/invoices/[id]/pdf', () => {
  const get = () => ({ method: 'GET', query: { id: 'inv1', org_id: ORG }, headers: {} }) as any;

  it('invoice lookup error -> 503, NOT 404; nothing rendered', async () => {
    mockScript['invoices:select'] = () => ({ data: null, error: { message: 'down' } });
    const res = mockRes();
    await invoicePdf(get(), res);
    expect(res.statusCode).toBe(503);
    expect(mockSinks).toEqual([]);
  });

  it('line-item lookup error -> 503; an invoice with missing lines is never rendered', async () => {
    mockScript['invoices:select'] = () => ({ data: { id: 'inv1', organization_id: ORG, invoice_number: 'INV-1', currency: 'INR' }, error: null });
    mockScript['invoice_line_items:select'] = () => ({ data: null, error: { message: 'down' } });
    const res = mockRes();
    await invoicePdf(get(), res);
    expect(res.statusCode).toBe(503);
    expect(mockSinks).toEqual([]);
  });

  it('control: an absent invoice is still 404 (unchanged)', async () => {
    const res = mockRes();
    await invoicePdf(get(), res);
    expect(res.statusCode).toBe(404);
  });
});
