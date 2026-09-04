/**
 * P1 CONTROLLED END-TO-END SIMULATION — 24 scenarios against the certified
 * hardened source (3d72d9dc).
 *
 *   CONTROLLED SIMULATION          = YES
 *   REAL RAZORPAY PAYMENT          = NO
 *   REAL RAZORPAY WEBHOOK DELIVERY = NO
 *   REAL BROWSER CHECKOUT          = NO
 *   PRODUCTION FINANCIAL DATA      = NO
 *
 * Nothing here is real provider evidence and it must never be reported as such.
 * What it does establish: once the provider states what happened, Omnivyra
 * processes that truth correctly.
 *
 * REAL (not mocked):
 *   pages/api/webhooks/payments/[provider]  — the actual route handler, entered
 *                                             through its raw-body stream, with
 *                                             a genuine HMAC-SHA256 signature.
 *                                             Signature verification is NOT
 *                                             bypassed.
 *   orchestrator webhook handler + RazorpayAdapter.verifyWebhookSignature
 *   purchaseService, purchaseClosureService, paymentFinancialValidator,
 *   commercialReconciliationService, expiry sweep, idempotency
 *
 * MOCKED (external boundary only):
 *   Razorpay HTTP (order/payment lookup) — via resolveProviderOrderOutcome
 *   credit ledger + invoice writers      — counted, with UNIQUE semantics
 *   database                             — in-memory, isolated
 */

import crypto from 'crypto';

// ── env must be set before any orchestrator credential read ──────────────────
const WEBHOOK_SECRET = 'sim_only_not_a_real_secret_0123456789abcdef';
process.env.PAYMENT_PROVIDER_MODE = 'test';
process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_simulation';
process.env.RAZORPAY_TEST_KEY_SECRET = 'sim_api_secret_not_real';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

// ── isolated in-memory database ─────────────────────────────────────────────
interface Row { [k: string]: unknown }
const db: { credit_purchases: Row[]; payment_provider_events: Row[] } = {
  credit_purchases: [], payment_provider_events: [],
};
type Filter = { op: 'eq' | 'neq' | 'lt'; col: string; val: unknown };
const fail = { update: false, message: 'simulated db failure' };

function applyFilters(rows: Row[], f: Filter[]): Row[] {
  return rows.filter((r) => f.every((x) => {
    const v = r[x.col];
    if (x.op === 'eq') return v === x.val;
    if (x.op === 'neq') return v !== x.val;
    return String(v) < String(x.val);
  }));
}

function makeBuilder(table: keyof typeof db, mode: 'select' | 'update' | 'insert', values?: Row) {
  const filters: Filter[] = []; let limitN: number | null = null;
  const run = () => {
    if (mode === 'update' && fail.update) { fail.update = false; return { data: [], error: { message: fail.message } }; }
    if (mode === 'insert') {
      // UNIQUE(provider, provider_event_id) on payment_provider_events.
      if (table === 'payment_provider_events') {
        const dup = db[table].find((r) => r.provider === values!.provider
          && r.provider_event_id === values!.provider_event_id);
        if (dup) return { data: [], error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { id: `${table}_${db[table].length + 1}`, ...values };
      db[table].push(row);
      return { data: [row], error: null };
    }
    const matched = applyFilters(db[table], filters);
    if (mode === 'select') return { data: limitN == null ? matched : matched.slice(0, limitN), error: null };
    for (const r of matched) Object.assign(r, values);
    return { data: matched, error: null };
  };
  const api: any = {
    eq(c: string, v: unknown) { filters.push({ op: 'eq', col: c, val: v }); return api; },
    neq(c: string, v: unknown) { filters.push({ op: 'neq', col: c, val: v }); return api; },
    lt(c: string, v: unknown) { filters.push({ op: 'lt', col: c, val: v }); return api; },
    order() { return api; }, limit(n: number) { limitN = n; return api; }, select() { return api; },
    single() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: r.error }); },
    maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: r.error }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve(run()).then(res); },
  };
  return api;
}
const fakeFrom = (t: string) => ({
  select: () => makeBuilder(t as keyof typeof db, 'select'),
  update: (v: Row) => makeBuilder(t as keyof typeof db, 'update', v),
  insert: (v: Row) => makeBuilder(t as keyof typeof db, 'insert', v),
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeFrom(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeFrom(t) } }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeFrom(t) } }), { virtual: true });

// ── leaf effects ────────────────────────────────────────────────────────────
const grants: Array<{ amount: number; key: string }> = [];
let creditFails = false;
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: jest.fn(async (a: any) => {
    if (creditFails) { creditFails = false; throw new Error('simulated credit ledger failure'); }
    if (grants.some((g) => g.key === a.idempotencyKey)) return { deduped: true };  // UNIQUE
    grants.push({ amount: a.amount, key: a.idempotencyKey }); return { ok: true };
  }),
  makeIdempotencyKey: (o: string, t: string, i: string) => `${o}:${t}:${i}`,
}));
const invoices: string[] = [];
let invoiceFails = false;
jest.mock('../../services/billing/topupInvoiceService', () => ({
  generateTopupInvoice: jest.fn(async (id: string) => {
    if (invoiceFails) { invoiceFails = false; throw new Error('simulated invoice failure'); }
    if (!invoices.includes(id)) invoices.push(id);              // deterministic + UNIQUE
    return { invoiceNumber: `INV-SIM-${id}` };
  }),
}));
jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => ({ requestId: 'sim', correlationId: 'sim' }),
  getOrCreateRequestId: () => 'sim',
  runWithRequestContext: (_c: unknown, fn: () => unknown) => fn(),
}));
// Route wrapper is a pass-through; signature verification is NOT bypassed.
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}), { virtual: true });

/** The ONLY external boundary: what Razorpay says when asked. */
const providerOutcome = jest.fn();
jest.mock('../../services/payments/orchestrator', () => {
  const actual = jest.requireActual('../../services/payments/orchestrator');
  return { ...actual, resolveProviderOrderOutcome: (...a: unknown[]) => providerOutcome(...a) };
});
jest.mock('@/backend/services/payments/orchestrator', () => {
  const actual = jest.requireActual('../../services/payments/orchestrator');
  return { ...actual, resolveProviderOrderOutcome: (...a: unknown[]) => providerOutcome(...a) };
}, { virtual: true });

import webhookHandler from '../../../pages/api/webhooks/payments/[provider]';
import {
  fulfillProviderConfirmedPurchase, expireStalePendingPurchases,
} from '../../services/billing/purchaseClosureService';
import { reconcile } from '../../services/billing/commercialReconciliationService';

// ── provider simulator ──────────────────────────────────────────────────────
const ORG = 'org_sim_e2e';
let seq = 0;

interface SimOrder { orderId: string; paymentId: string; amountSubunits: number; currency: string; purchaseId: string }

/** createOrder() — a purchase + provider order, priced from the purchase itself. */
function simCreateOrder(amountMajor = 2520, currency = 'INR', credits = 250): SimOrder {
  seq += 1;
  const purchaseId = `pur_${seq}`;
  db.credit_purchases.push({
    id: purchaseId, organization_id: ORG, credits, amount_paid: amountMajor, currency,
    status: 'pending', fulfillment_status: 'pending', reference_id: null,
    provider: 'razorpay', provider_order_id: `order_sim_${seq}`, provider_payload: {},
    created_at: new Date().toISOString(),
  });
  return {
    orderId: `order_sim_${seq}`, paymentId: `pay_sim_${seq}`,
    // Amount comes from the purchase, never hardcoded into the assertion.
    amountSubunits: Math.round(amountMajor * 100), currency, purchaseId,
  };
}

/** capturePayment()/fetchOrder() — what an authoritative lookup would return. */
function simProviderPaid(o: SimOrder, over: Partial<{ amountSubunits: number; currency: string }> = {}) {
  providerOutcome.mockResolvedValue({
    outcome: 'paid', providerPaymentId: o.paymentId, providerRawStatus: 'paid',
    providerAmountSubunits: over.amountSubunits ?? o.amountSubunits,
    providerCurrency: over.currency ?? o.currency,
  });
}
const simProviderUnpaid = () => providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
const simProviderUnknown = (reason: string) => providerOutcome.mockResolvedValue({ outcome: 'unknown', reason });

/** A Razorpay-shaped payment.captured payload. */
const rzpEvent = (o: SimOrder, over: Partial<{ amount: number; currency: string; orderId: string; paymentId: string }> = {}) => ({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: over.paymentId ?? o.paymentId,
        order_id: over.orderId ?? o.orderId,
        status: 'captured',
        captured: true,
        amount: over.amount ?? o.amountSubunits,
        currency: over.currency ?? o.currency,
      },
    },
  },
});

/** deliverWebhook() — enters the REAL route with a REAL signature. */
async function simDeliverWebhook(evt: unknown, opts: { signature?: 'valid' | 'invalid' | 'missing' } = {}) {
  const raw = JSON.stringify(evt);
  const mode = opts.signature ?? 'valid';
  const sig = mode === 'valid'
    ? crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')
    : mode === 'invalid'
      ? crypto.createHmac('sha256', 'the_wrong_secret').update(raw).digest('hex')
      : undefined;

  const headers: Record<string, string> = {};
  if (sig) headers['x-razorpay-signature'] = sig;

  const req: any = {
    method: 'POST', query: { provider: 'razorpay' }, headers,
    on(ev: string, cb: (c?: unknown) => void) {
      if (ev === 'data') cb(raw);
      if (ev === 'end') cb();
      return req;
    },
  };
  const res: any = {
    _status: 0, _json: null,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader() { return this; }, end() { return this; },
  };
  await (webhookHandler as any)(req, res);
  return { status: res._status, body: res._json };
}
const simRedeliverWebhook = simDeliverWebhook;   // provider redelivery = identical payload

const get = (id: string) => db.credit_purchases.find((r) => r.id === id) as any;
const grantsFor = (id: string) => grants.filter((g) => g.key.endsWith(`:${id}`));
const invoicesFor = (id: string) => invoices.filter((i) => i === id);
const balance = () => grants.reduce((s, g) => s + g.amount, 0);

beforeEach(() => {
  db.credit_purchases = []; db.payment_provider_events = [];
  grants.length = 0; invoices.length = 0; seq = 0;
  fail.update = false; creditFails = false; invoiceFails = false;
  providerOutcome.mockReset();
  providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
});

// ═══ 1 — WEBHOOK TEST EVENT ════════════════════════════════════════════════
describe('S1 — webhook test event (valid signature, real handler)', () => {
  it('accepted, purchase completed, +250 once, one invoice', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o));
    expect(r.status).toBe(200);
    expect((r.body as any).allocated).toBe(true);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(grantsFor(o.purchaseId)[0].amount).toBe(250);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
    expect(db.payment_provider_events).toHaveLength(1);
  });
});

// ═══ 2 — NORMAL PAYMENT ════════════════════════════════════════════════════
describe('S2 — normal payment', () => {
  it('order → capture → webhook → completed, +250, 1 invoice', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const before = balance();
    const r = await simDeliverWebhook(rzpEvent(o));
    expect(r.status).toBe(200);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(get(o.purchaseId).fulfillment_status).toBe('completed');
    expect(balance() - before).toBe(250);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 3 — VERIFY-FIRST ══════════════════════════════════════════════════════
describe('S3 — verify-first, webhook second', () => {
  it('verify performs the authoritative lookup and fulfils; webhook then dedupes', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const v = await fulfillProviderConfirmedPurchase(o.purchaseId);   // no financials → lookup
    expect(v.ok).toBe(true);
    expect(providerOutcome).toHaveBeenCalled();
    expect(grantsFor(o.purchaseId)).toHaveLength(1);

    const w = await simDeliverWebhook(rzpEvent(o));
    expect(w.status).toBe(200);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 4 — WEBHOOK-FIRST ═════════════════════════════════════════════════════
describe('S4 — webhook-first, verify second', () => {
  it('webhook fulfils; later verify is idempotent', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o));
    expect(get(o.purchaseId).status).toBe('completed');
    const v = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(v.ok).toBe(true);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 5 — REPLAY ×4 ═════════════════════════════════════════════════════════
describe('S5 — webhook replay ×4', () => {
  it('cumulative effect is +250 and one invoice', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const evt = rzpEvent(o);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await simRedeliverWebhook(evt));
    results.forEach((r) => expect(r.status).toBe(200));
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
    expect(balance()).toBe(250);
    // Append-only event ledger deduped the redeliveries.
    expect(db.payment_provider_events).toHaveLength(1);
  });
});

// ═══ 6 — SIGNATURE ═════════════════════════════════════════════════════════
describe('S6 — signature verification (real, not bypassed)', () => {
  it('invalid signature → 401, no financial effect', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o), { signature: 'invalid' });
    expect(r.status).toBe(401);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
  });
  it('missing signature → 401, no financial effect', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o), { signature: 'missing' });
    expect(r.status).toBe(401);
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
  it('a signature failure does not destroy a legitimately paid purchase', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o), { signature: 'invalid' });
    expect(get(o.purchaseId).status).toBe('pending');
    const v = await fulfillProviderConfirmedPurchase(o.purchaseId);   // authoritative path
    expect(v.ok).toBe(true);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 7 — CLIENT FAILURE / PROVIDER SUCCESS ═════════════════════════════════
describe('S7 — browser reports failure, provider captured', () => {
  it('webhook completes it; no permanent failed purchase', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    // success callback deliberately never runs
    const r = await simDeliverWebhook(rzpEvent(o));
    expect(r.status).toBe(200);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 8 — BROWSER DISAPPEARANCE ═════════════════════════════════════════════
describe('S8 — browser disappears entirely', () => {
  it('webhook alone recovers; replay adds nothing', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o));
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    await simRedeliverWebhook(rzpEvent(o));
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 9 — DELAYED WEBHOOK → RECONCILIATION ══════════════════════════════════
describe('S9 — webhook withheld, reconciliation recovers', () => {
  it('reconciliation fulfils; the late webhook then adds nothing', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    // Paid-but-unfulfilled shape reconciliation looks for.
    Object.assign(get(o.purchaseId), { status: 'completed', fulfillment_status: 'event_recorded' });
    const r = await reconcile({ kind: 'global' }, false);
    expect(r.repaired).toBe(1);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);

    await simDeliverWebhook(rzpEvent(o));
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 10/11/12 — EXPIRY ═════════════════════════════════════════════════════
describe('S10-S12 — expiry sweep against provider truth', () => {
  const aged = (o: SimOrder) => Object.assign(get(o.purchaseId), {
    created_at: new Date(Date.now() - 120 * 60_000).toISOString(),
  });
  it('S10 unpaid → failed, no credits, no invoice', async () => {
    const o = simCreateOrder(); aged(o); simProviderUnpaid();
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.closed).toBe(1);
    expect(get(o.purchaseId).status).toBe('failed');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
  });
  it('S11 unknown → stays pending (uncertainty is neither paid nor failed)', async () => {
    const o = simCreateOrder(); aged(o); simProviderUnknown('timeout');
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.deferred).toBe(1);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
  it('S12 paid → completed, +250, 1 invoice', async () => {
    const o = simCreateOrder(); aged(o); simProviderPaid(o);
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.fulfilled).toBe(1);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 13 — LATE SUCCESS AFTER SYSTEM CLOSURE ════════════════════════════════
describe('S13 — late success after a system closure', () => {
  const closed = (o: SimOrder) => Object.assign(get(o.purchaseId), {
    status: 'failed', fulfillment_status: 'failed',
    provider_payload: { closure: { reason: 'stale_pending_expiry', reopenable: true } },
  });
  it('matching financials → reopen, fulfil once; replay adds nothing', async () => {
    const o = simCreateOrder(); closed(o); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o));
    expect(r.status).toBe(200);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    await simRedeliverWebhook(rzpEvent(o));
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
  it('wrong amount → AMOUNT_MISMATCH, no reopen, no fulfilment', async () => {
    const o = simCreateOrder(); closed(o); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o, { amount: 100 }));
    expect(get(o.purchaseId).status).toBe('failed');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
  });
  it('wrong currency → CURRENCY_MISMATCH, no reopen, no fulfilment', async () => {
    const o = simCreateOrder(); closed(o); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o, { currency: 'USD' }));
    expect(get(o.purchaseId).status).toBe('failed');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
});

// ═══ 14 — AMOUNT MISMATCH ══════════════════════════════════════════════════
describe('S14 — amount mismatch is symmetric', () => {
  it('underpaid (₹1 vs ₹2,520) → blocked', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o, { amount: 100 }));
    expect(r.status).toBe(200);                       // signature fine, settlement refused
    expect((r.body as any).allocated).toBe(false);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
  });
  it('overpaid (₹5,040 vs ₹2,520) → blocked', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o, { amount: 504000 }));
    expect((r.body as any).allocated).toBe(false);
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
});

// ═══ 15 — CURRENCY MISMATCH ════════════════════════════════════════════════
describe('S15 — currency mismatch, no FX', () => {
  it('USD capture against INR purchase → blocked', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o, { currency: 'USD' }));
    expect((r.body as any).allocated).toBe(false);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
  it('numerically equal USD is still refused — no conversion', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o, { amount: o.amountSubunits, currency: 'USD' }));
    expect((r.body as any).allocated).toBe(false);
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
});

// ═══ 16 — MISSING / MALFORMED FINANCIALS ═══════════════════════════════════
describe('S16 — malformed financials never settle', () => {
  it.each([
    ['amount missing',  (e: any) => { delete e.payload.payment.entity.amount; }],
    ['currency missing',(e: any) => { delete e.payload.payment.entity.currency; }],
    ['amount NaN',      (e: any) => { e.payload.payment.entity.amount = 'not-a-number'; }],
    ['amount Infinity', (e: any) => { e.payload.payment.entity.amount = Infinity; }],
    ['amount zero',     (e: any) => { e.payload.payment.entity.amount = 0; }],
  ])('%s → blocked, no credits, no invoice', async (_label, mutate) => {
    const o = simCreateOrder(); simProviderPaid(o);
    const evt: any = rzpEvent(o); mutate(evt);
    const r = await simDeliverWebhook(evt);
    expect((r.body as any).allocated).toBe(false);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
  });
});

// ═══ 17 — PROVIDER UNKNOWN / TIMEOUT ═══════════════════════════════════════
describe('S17 — provider lookup failures then recovery', () => {
  it.each([
    ['timeout',   'ETIMEDOUT'],
    ['http 500',  'razorpay_order_fetch_failed:500'],
    ['malformed', 'razorpay_order_fetch_error:invalid json'],
  ])('%s → UNKNOWN, no grant, recoverable', async (_l, reason) => {
    const o = simCreateOrder(); simProviderUnknown(reason);
    const f = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(f.ok).toBe(false);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
  it('a later PAID lookup settles it exactly once', async () => {
    const o = simCreateOrder(); simProviderUnknown('ETIMEDOUT');
    await fulfillProviderConfirmedPurchase(o.purchaseId);
    simProviderPaid(o);
    const f = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(f.ok).toBe(true);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 18 — ORDER MISMATCH ═══════════════════════════════════════════════════
describe('S18 — webhook order id matches no purchase', () => {
  it('unmatched → no grant, no invoice, purchase untouched', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const r = await simDeliverWebhook(rzpEvent(o, { orderId: 'order_does_not_exist', paymentId: 'pay_x' }));
    expect(r.status).toBe(200);
    expect((r.body as any).allocated).toBe(false);
    expect(get(o.purchaseId).status).toBe('pending');
    expect(grants).toHaveLength(0);
    expect(invoices).toHaveLength(0);
  });
});

// ═══ 19 — CONCURRENCY ══════════════════════════════════════════════════════
describe('S19 — concurrent settlement, 16 attempts', () => {
  it('one completion, one grant, one invoice', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    const evt = rzpEvent(o);
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 4; i++) {
      ops.push(simDeliverWebhook(evt));
      ops.push(fulfillProviderConfirmedPurchase(o.purchaseId));
      ops.push(reconcile({ kind: 'global' }, false));
      ops.push(simRedeliverWebhook(evt));
    }
    await Promise.all(ops);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
    expect(get(o.purchaseId).status).toBe('completed');
  });
});

// ═══ 20 — DATABASE FAILURE ═════════════════════════════════════════════════
describe('S20 — database failure handling', () => {
  it('db_error is distinguishable from already_completed and is retryable', async () => {
    const o = simCreateOrder();
    Object.assign(get(o.purchaseId), { created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    simProviderUnpaid();
    fail.update = true;
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.deferred).toBe(1);
    expect(r.details[0].detail).toBe('db_error');
    expect(r.details[0].action).not.toBe('already_completed');
    expect(get(o.purchaseId).status).toBe('pending');
  });
  it('credit-ledger failure leaves it retryable; retry grants exactly once', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    creditFails = true;
    const bad = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(bad.ok).toBe(false);
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
    const good = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(good.ok).toBe(true);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
  it('a poison row does not corrupt other purchases', async () => {
    const aged = () => new Date(Date.now() - 120 * 60_000).toISOString();
    const bad = simCreateOrder(); const g1 = simCreateOrder(); const g2 = simCreateOrder();
    [bad, g1, g2].forEach((o) => Object.assign(get(o.purchaseId), { created_at: aged() }));
    providerOutcome.mockImplementation(async (_p: string, orderId: string) => {
      if (orderId === bad.orderId) throw new Error('poison row');
      return { outcome: 'unpaid', providerRawStatus: 'created' };
    });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.scanned).toBe(3); expect(r.errored).toBe(1); expect(r.closed).toBe(2);
    expect(get(bad.purchaseId).status).toBe('pending');
    expect(get(g1.purchaseId).status).toBe('failed');
    expect(grants).toHaveLength(0);
  });
});

// ═══ 21 — MULTIPLE PURCHASES ═══════════════════════════════════════════════
describe('S21 — two purchases, no cross-fulfilment', () => {
  it('pay A then B → +500 total, correct association', async () => {
    const a = simCreateOrder(); const b = simCreateOrder();
    simProviderPaid(a);
    await simDeliverWebhook(rzpEvent(a));
    expect(get(a.purchaseId).status).toBe('completed');
    expect(get(b.purchaseId).status).toBe('pending');
    expect(grantsFor(b.purchaseId)).toHaveLength(0);

    simProviderPaid(b);
    await simDeliverWebhook(rzpEvent(b));
    expect(grantsFor(a.purchaseId)).toHaveLength(1);
    expect(grantsFor(b.purchaseId)).toHaveLength(1);
    expect(balance()).toBe(500);
    expect(invoices).toEqual([a.purchaseId, b.purchaseId]);
  });
});

// ═══ 22 — INVOICE FAILURE ══════════════════════════════════════════════════
describe('S22 — invoice failure after a successful grant', () => {
  it('one grant; invoice repairable without a second grant', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    invoiceFails = true;
    const f = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(f.ok).toBe(true);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(0);
    await reconcile({ kind: 'global' }, false);            // repair path
    await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
});

// ═══ 23 — REFUND ═══════════════════════════════════════════════════════════
describe('S23 — refund event', () => {
  it('unrecognised; credits are not silently reversed', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    await simDeliverWebhook(rzpEvent(o));
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    const refund = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: o.paymentId } } } };
    const r = await simDeliverWebhook(refund);
    expect(r.status).toBe(200);
    expect((r.body as any).allocated).toBe(false);
    expect(get(o.purchaseId).status).toBe('completed');
    expect(grantsFor(o.purchaseId)).toHaveLength(1);      // NOT reversed
  });
});

// ═══ 24 — DUPLICATE BUY ════════════════════════════════════════════════════
describe('S24 — duplicate Buy (P2, not a financial-integrity failure)', () => {
  it('two Buy actions → two orders; paying both is two real payments', async () => {
    const a = simCreateOrder(); const b = simCreateOrder();
    expect(a.orderId).not.toBe(b.orderId);
    simProviderPaid(a); await simDeliverWebhook(rzpEvent(a));
    simProviderPaid(b); await simDeliverWebhook(rzpEvent(b));
    expect(balance()).toBe(500);
    expect(invoices).toHaveLength(2);
  });
  it('an unpaid duplicate costs nothing — expiry closes it', async () => {
    const a = simCreateOrder();
    Object.assign(get(a.purchaseId), { created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    simProviderUnpaid();
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(a.purchaseId).status).toBe('failed');
    expect(grants).toHaveLength(0);
  });
});

// ═══ 25 — STATE MACHINE ════════════════════════════════════════════════════
describe('S25 — state-machine assertion', () => {
  it('only PAID + matching financials fulfils; UNKNOWN/mismatch never grant', async () => {
    const cases: Array<{ label: string; setup: () => SimOrder; expectStatus: string; expectGrants: number }> = [
      { label: 'pending + paid+match', setup: () => { const o = simCreateOrder(); simProviderPaid(o); return o; }, expectStatus: 'completed', expectGrants: 1 },
      { label: 'pending + paid+wrong amount', setup: () => { const o = simCreateOrder(); simProviderPaid(o, { amountSubunits: 1 }); return o; }, expectStatus: 'pending', expectGrants: 0 },
      { label: 'pending + paid+wrong currency', setup: () => { const o = simCreateOrder(); simProviderPaid(o, { currency: 'USD' }); return o; }, expectStatus: 'pending', expectGrants: 0 },
      { label: 'pending + unknown', setup: () => { const o = simCreateOrder(); simProviderUnknown('x'); return o; }, expectStatus: 'pending', expectGrants: 0 },
    ];
    for (const c of cases) {
      const o = c.setup();
      await fulfillProviderConfirmedPurchase(o.purchaseId);
      expect(`${c.label}:${get(o.purchaseId).status}`).toBe(`${c.label}:${c.expectStatus}`);
      expect(`${c.label}:${grantsFor(o.purchaseId).length}`).toBe(`${c.label}:${c.expectGrants}`);
    }
  });
  it('completed never grants again, whatever the event', async () => {
    const o = simCreateOrder(); simProviderPaid(o);
    await fulfillProviderConfirmedPurchase(o.purchaseId);
    await simDeliverWebhook(rzpEvent(o));
    await reconcile({ kind: 'global' }, false);
    await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(grantsFor(o.purchaseId)).toHaveLength(1);
    expect(invoicesFor(o.purchaseId)).toHaveLength(1);
  });
  it('a provider-declined failure never reopens', async () => {
    const o = simCreateOrder();
    Object.assign(get(o.purchaseId), { status: 'failed', fulfillment_status: 'failed', provider_payload: {} });
    simProviderPaid(o);
    const f = await fulfillProviderConfirmedPurchase(o.purchaseId);
    expect(f.ok).toBe(false);
    expect(get(o.purchaseId).status).toBe('failed');
    expect(grantsFor(o.purchaseId)).toHaveLength(0);
  });
});
