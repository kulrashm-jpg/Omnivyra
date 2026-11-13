/**
 * pages/api/stripe/webhook.ts end to end (signature -> processStripeWebhookEvent -> HTTP answer):
 *  1. a subscription-ledger failure answers 500 at the ROUTE (Stripe retries); success answers 200;
 *  2. the route's markEvent READS its write result and logs a failure (05, 2026-11-13). On main the UPDATE targets the
 *     immutable parent payment_provider_events row and its immutable_update trigger (migration 20260663) rejects it;
 *     the failure used to be discarded silently. The mark never changes the HTTP answer.
 * The DB layer is faked; the update rejection mimics the trigger's LEDGER_IMMUTABLE error.
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';

const SECRET = 'whsec_test_placeholder_not_a_real_secret';
let markUpdateError: { message: string } | null = null;
const markUpdates: Array<Record<string, unknown>> = [];
let ledgerOutcome: { applied: boolean; reason?: string } = { applied: true };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table === 'credit_purchases') {
      // findPurchaseByProviderEventId: no purchase matches a subscription event (org comes from metadata).
      const p: any = {};
      p.select = () => p; p.eq = () => p; p.or = () => p;
      p.maybeSingle = async () => ({ data: null, error: null });
      return p;
    }
    if (table !== 'payment_provider_events') throw new Error(`hostile fake: unexpected table ${table}`);
    const q: any = {};
    q.update = (payload: Record<string, unknown>) => { markUpdates.push(payload); return q; };
    q.eq = async () => ({ data: null, error: markUpdateError });
    return q;
  },
}));
jest.mock('../../services/purchaseService', () => ({
  recordPaymentProviderEvent: async () => ({ id: 'ppe_1', duplicate: false, processingStatus: 'recorded' }),
  completePurchase: async () => ({ success: false, reason: 'unused' }),
  failPurchase: async () => undefined,
}));
jest.mock('../../services/billingSubscriptionService', () => ({
  ...jest.requireActual('../../services/billingSubscriptionService'),
  applyStripeSubscriptionEvent: async () => ledgerOutcome,
}));

import handler from '../../../pages/api/stripe/webhook';

function signedRequest(event: Record<string, unknown>) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  const req: any = new EventEmitter();
  req.method = 'POST';
  req.headers = { 'stripe-signature': `t=${t},v1=${v1}` };
  setImmediate(() => { req.emit('data', Buffer.from(raw)); req.emit('end'); });
  return req;
}
async function deliver(event: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await (handler as any)(signedRequest(event), res);
  return res;
}
const subEvent = {
  id: 'evt_route_1', type: 'customer.subscription.updated', created: Math.floor(Date.now() / 1000),
  data: { object: { id: 'sub_1', metadata: { organization_id: 'org-A' } } }, livemode: false,
};

let errSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  // Hermetic: the config schema (loaded lazily inside the request) requires ENCRYPTION_KEY. Same 64-hex placeholder
  // as .github/workflows/campaign-generation-contracts.yml; not a real key.
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  markUpdateError = null; markUpdates.length = 0; ledgerOutcome = { applied: true };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { errSpy.mockRestore(); delete process.env.STRIPE_WEBHOOK_SECRET; });
const markLogs = () => errSpy.mock.calls.filter((c) => String(c[0]).includes('processing-state mark NOT persisted'));

describe('stripe webhook route', () => {
  it('a subscription-ledger FAILURE answers 500 at the route (Stripe retries)', async () => {
    ledgerOutcome = { applied: false, reason: 'subscription_event_contention' };
    const res = await deliver(subEvent);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'webhook_processing_failed' });
    expect(markUpdates.map((u) => u.processing_status)).toEqual(['failed']);
  });

  it('CONTROL: an applied event answers 200 and is marked processed', async () => {
    const res = await deliver(subEvent);
    expect(res.statusCode).toBe(200);
    expect(markUpdates.map((u) => u.processing_status)).toEqual(['processed']);
    expect(markLogs()).toHaveLength(0);
  });

  it('a REJECTED mark (immutable_update trigger) is LOGGED, with ids and the db error, and does not change the 200', async () => {
    markUpdateError = { message: 'LEDGER_IMMUTABLE: row in payment_provider_events is append-only' };
    const res = await deliver(subEvent);
    expect(res.statusCode).toBe(200);
    expect(markLogs()).toHaveLength(1);
    expect(markLogs()[0][1]).toEqual({
      payment_provider_event_id: 'ppe_1', wanted_status: 'processed',
      db_error: 'LEDGER_IMMUTABLE: row in payment_provider_events is append-only',
    });
  });

  it('a rejected mark on a FAILED ledger write is logged too, and the answer stays 500', async () => {
    markUpdateError = { message: 'LEDGER_IMMUTABLE' };
    ledgerOutcome = { applied: false, reason: 'no_org' };
    const res = await deliver(subEvent);
    expect(res.statusCode).toBe(500);
    expect(markLogs()[0][1]).toMatchObject({ wanted_status: 'failed' });
  });
});
