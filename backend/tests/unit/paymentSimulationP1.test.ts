/**
 * P1 CONTROLLED SIMULATION — end-to-end payment scenarios against the CERTIFIED
 * implementation (281e0f3a), with a mocked provider and an in-memory
 * `credit_purchases`.
 *
 * SIMULATED EVIDENCE. This is not a real Razorpay transaction and must never be
 * reported as one. What it does establish is whether the deployed logic behaves
 * correctly under each scenario the real operator test will exercise, and which
 * assertions the real test could still falsify.
 *
 * Real services under test (not re-implemented):
 *   purchaseService.completePurchase / reopenSystemClosedPurchase
 *   purchaseClosureService.{fulfillProviderConfirmedPurchase,
 *                           closePurchaseFromClient,
 *                           expireStalePendingPurchases}
 *
 * Mocked at the leaves only:
 *   creditExecutionService  → counts grants, enforces UNIQUE(idempotency_key)
 *   topupInvoiceService     → counts invoices, deterministic per purchase
 *   payments/orchestrator   → controls what "the provider says"
 *
 * The webhook and verify ROUTES are Next handlers; their settlement logic is
 * reproduced here exactly as written in the certified source (match purchase by
 * provider_order_id → already-fulfilled short-circuit → fulfil), so route
 * composition is exercised without a Next runtime.
 */

// ── in-memory credit_purchases ───────────────────────────────────────────────
interface Row {
  id: string; organization_id: string; credits: number; amount_paid: number;
  currency: string; status: string; fulfillment_status: string | null;
  reference_id: string | null; provider: string | null; provider_order_id: string | null;
  provider_payload: Record<string, unknown>; created_at: string; [k: string]: unknown;
}
const db: { rows: Row[] } = { rows: [] };
type Filter = { op: 'eq' | 'neq' | 'lt'; col: string; val: unknown };

/** Opt-in single-shot failures, so DB-error branches are reachable. */
const fail = { update: false, select: false, message: 'simulated db failure' };

function applyFilters(rows: Row[], f: Filter[]): Row[] {
  return rows.filter((r) => f.every((x) => {
    const v = r[x.col];
    if (x.op === 'eq') return v === x.val;
    if (x.op === 'neq') return v !== x.val;
    return String(v) < String(x.val);
  }));
}

function makeBuilder(mode: 'select' | 'update', values?: Record<string, unknown>) {
  const filters: Filter[] = [];
  let limitN: number | null = null;
  const run = () => {
    if (mode === 'update' && fail.update) { fail.update = false; return { data: [], error: { message: fail.message } }; }
    if (mode === 'select' && fail.select) { fail.select = false; return { data: [], error: { message: fail.message } }; }
    const matched = applyFilters(db.rows, filters);
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
const fakeTable = () => ({
  select: () => makeBuilder('select'),
  update: (v: Record<string, unknown>) => makeBuilder('update', v),
  insert: (v: Record<string, unknown>) => { db.rows.push(v as Row); return makeBuilder('select'); },
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => fakeTable() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => fakeTable() } }));

// ── leaf effects ─────────────────────────────────────────────────────────────
const grants: Array<{ orgId: string; amount: number; key: string }> = [];
let creditFails = false;
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: jest.fn(async (a: any) => {
    if (creditFails) { creditFails = false; throw new Error('simulated credit ledger failure'); }
    // Mirrors UNIQUE(idempotency_key): a repeat is a no-op, not a second grant.
    if (grants.some((g) => g.key === a.idempotencyKey)) return { deduped: true };
    grants.push({ orgId: a.orgId, amount: a.amount, key: a.idempotencyKey });
    return { ok: true };
  }),
  makeIdempotencyKey: (o: string, t: string, i: string) => `${o}:${t}:${i}`,
}));
const invoices: string[] = [];
let invoiceFails = false;
jest.mock('../../services/billing/topupInvoiceService', () => ({
  generateTopupInvoice: jest.fn(async (id: string) => {
    if (invoiceFails) { invoiceFails = false; throw new Error('simulated invoice failure'); }
    if (!invoices.includes(id)) invoices.push(id);   // deterministic number + UNIQUE
    return { invoiceNumber: `INV-SIM-${id}` };
  }),
}));
jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => ({ requestId: 'sim', correlationId: 'sim' }),
}));
const providerOutcome = jest.fn();
jest.mock('../../services/payments/orchestrator', () => ({
  resolveProviderOrderOutcome: (...a: unknown[]) => providerOutcome(...a),
}));

import {
  fulfillProviderConfirmedPurchase, closePurchaseFromClient, expireStalePendingPurchases,
} from '../../services/billing/purchaseClosureService';
import { completePurchase, reopenSystemClosedPurchase } from '../../services/purchaseService';

const ORG = 'org_sim';
let seq = 0;
function seed(over: Partial<Row> = {}): Row {
  seq += 1;
  const row: Row = {
    id: over.id ?? `pur_${seq}`, organization_id: ORG, credits: 250, amount_paid: 2520,
    currency: 'INR', status: 'pending', fulfillment_status: 'pending', reference_id: null,
    provider: 'razorpay', provider_order_id: `order_sim_${seq}`, provider_payload: {},
    created_at: new Date().toISOString(), ...over,
  };
  db.rows.push(row); return row;
}
const get = (id: string) => db.rows.find((r) => r.id === id)!;
const grantsFor = (id: string) => grants.filter((g) => g.key.endsWith(`:${id}`));
const invoicesFor = (id: string) => invoices.filter((i) => i === id);

/** Razorpay `payment.captured` payload, real shape. */
const rzpCaptured = (orderId: string, paymentId: string, amountSubunits = 252000, currency = 'INR') => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured', amount: amountSubunits, currency } } },
});

/**
 * Certified `extractSuccess` from pages/api/webhooks/payments/[provider].ts.
 * Post-hardening it also carries the provider-stated amount + currency, which
 * the financial gate compares against the purchase.
 */
function extractSuccess(provider: string, evt: any):
  { orderId: string; paymentId: string; amountSubunits?: number; currency?: string } | null {
  if (provider === 'razorpay') {
    if (evt?.event !== 'payment.captured') return null;
    const e = evt?.payload?.payment?.entity ?? {};
    if (!e.order_id) return null;
    return {
      orderId: String(e.order_id), paymentId: String(e.id ?? ''),
      amountSubunits: Number.isFinite(Number(e.amount)) ? Number(e.amount) : undefined,
      currency: typeof e.currency === 'string' && e.currency ? String(e.currency).toUpperCase() : undefined,
    };
  }
  if (!String(evt?.type ?? '').toUpperCase().includes('SUCCESS')) return null;
  const orderId = evt?.data?.order?.order_id;
  if (!orderId) return null;
  const cfAmount = Number(evt?.data?.order?.order_amount);
  const cfCur = evt?.data?.order?.order_currency;
  return {
    orderId: String(orderId), paymentId: String(evt?.data?.payment?.cf_payment_id ?? ''),
    amountSubunits: Number.isFinite(cfAmount) ? Math.round(cfAmount * 100) : undefined,
    currency: typeof cfCur === 'string' && cfCur ? String(cfCur).toUpperCase() : undefined,
  };
}

/** Certified webhook route settlement path. */
async function deliverWebhook(provider: string, evt: any) {
  const success = extractSuccess(provider, evt);
  if (!success) return { allocated: false, note: 'not_a_success_event' };
  const purchase = db.rows.find((r) => r.provider_order_id === success.orderId);
  if (!purchase) return { allocated: false, note: 'payment_webhook_unmatched_order' };
  if (purchase.status === 'completed' && purchase.fulfillment_status === 'completed') {
    return { allocated: true, note: 'payment_webhook_duplicate' };
  }
  const f = await fulfillProviderConfirmedPurchase(purchase.id, success.paymentId || undefined, { amountSubunits: success.amountSubunits, currency: success.currency });
  return { allocated: f.ok, note: f.detail ?? 'fulfilled' };
}

/** Certified verify route settlement path (signature already checked upstream). */
async function deliverVerify(purchaseId: string, paymentId: string, signatureValid = true) {
  if (!signatureValid) {
    const c = await closePurchaseFromClient({ purchaseId, organizationId: ORG, reason: 'client_reported_failure' });
    return { ok: c.action === 'fulfilled', action: c.action };
  }
  const f = await fulfillProviderConfirmedPurchase(purchaseId, paymentId || undefined);
  return { ok: f.ok, action: f.ok ? 'fulfilled' : 'failed' };
}

beforeEach(() => {
  db.rows = []; grants.length = 0; invoices.length = 0; seq = 0;
  fail.update = false; fail.select = false; creditFails = false; invoiceFails = false;
  providerOutcome.mockReset();
  providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_sim', providerRawStatus: 'paid', providerAmountSubunits: 252000, providerCurrency: 'INR' });
});

// ═══ SIM 1 — successful payment ════════════════════════════════════════════
describe('SIM 1 — successful payment', () => {
  it('provider paid → completed, exactly one grant, exactly one invoice', async () => {
    const p = seed();
    const r = await deliverVerify(p.id, 'pay_1');
    expect(r.ok).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(get(p.id).fulfillment_status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(grantsFor(p.id)[0].amount).toBe(250);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 2 / 3 — ordering ══════════════════════════════════════════════════
describe('SIM 2 — webhook-first, verify second', () => {
  it('one grant, one invoice', async () => {
    const p = seed();
    await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_w'));
    const v = await deliverVerify(p.id, 'pay_w');
    expect(v.ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});
describe('SIM 3 — verify-first, webhook second', () => {
  it('one grant, one invoice; webhook is a duplicate no-op', async () => {
    const p = seed();
    await deliverVerify(p.id, 'pay_v');
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_v'));
    expect(w.note).toBe('payment_webhook_duplicate');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 4 — replay ════════════════════════════════════════════════════════
describe('SIM 4 — webhook replay ×3', () => {
  it('first grants, second and third are no-ops', async () => {
    const p = seed();
    const e = rzpCaptured(p.provider_order_id!, 'pay_r');
    await deliverWebhook('razorpay', e);
    expect(grantsFor(p.id)).toHaveLength(1);
    await deliverWebhook('razorpay', e);
    await deliverWebhook('razorpay', e);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
    expect(get(p.id).status).toBe('completed');
  });
});

// ═══ SIM 5 — client failure vs provider success ════════════════════════════
describe('SIM 5 — client says failed, provider says paid', () => {
  it('provider wins; purchase completed, one grant, one invoice', async () => {
    const p = seed();
    const r = await deliverVerify(p.id, '', false);   // signature rejected
    expect(r.action).toBe('fulfilled');
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('no permanent failed purchase results from a client claim', async () => {
    const p = seed();
    await deliverVerify(p.id, '', false);
    expect(get(p.id).status).not.toBe('failed');
  });
});

// ═══ SIM 6 — browser disappears, webhook recovers ══════════════════════════
describe('SIM 6 — browser disappears', () => {
  it('webhook alone completes fulfilment without any client call', async () => {
    const p = seed();
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_b'));
    expect(w.allocated).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 7 — browser gone + webhook delayed → reconciliation ═══════════════
describe('SIM 7 — delayed webhook, reconciliation recovers', () => {
  it('stale pending + provider paid → fulfilled once; re-run adds nothing', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    const r1 = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r1.fulfilled).toBe(1);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    const r2 = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r2.scanned).toBe(0);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 8 — expiry vs payment race ════════════════════════════════════════
describe('SIM 8 — expiry races', () => {
  const old = () => new Date(Date.now() - 120 * 60_000).toISOString();
  it('A: provider unpaid → closed, no credits, no invoice', async () => {
    const p = seed({ created_at: old() });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.closed).toBe(1);
    expect(get(p.id).status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });
  it('B: provider unknown → remains pending, no forced failure', async () => {
    const p = seed({ created_at: old() });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'timeout' });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.deferred).toBe(1);
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('C: provider paid → completed, one grant, one invoice', async () => {
    const p = seed({ created_at: old() });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.fulfilled).toBe(1);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('D: system-closed then provider later paid → reopen, fulfil exactly once', async () => {
    const p = seed({ created_at: old() });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe('failed');
    providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_late', providerAmountSubunits: 252000, providerCurrency: 'INR' });
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_late'));
    expect(w.allocated).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('D-negative: a provider-declined purchase can never be reopened', async () => {
    const p = seed({ status: 'failed', fulfillment_status: 'failed', provider_payload: {} });
    expect(await reopenSystemClosedPurchase(p.id)).toBe(false);
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_x');
    expect(f.ok).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
});

// ═══ SIM 9 — duplicate Buy click ═══════════════════════════════════════════
describe('SIM 9 — user clicks Buy twice', () => {
  it('creates two independent purchases; paying both grants twice (real double charge)', async () => {
    const a = seed(); const b = seed();               // two create-order calls
    expect(a.id).not.toBe(b.id);
    expect(a.provider_order_id).not.toBe(b.provider_order_id);
    await deliverWebhook('razorpay', rzpCaptured(a.provider_order_id!, 'pay_a'));
    await deliverWebhook('razorpay', rzpCaptured(b.provider_order_id!, 'pay_b'));
    // Each is a distinct provider payment, so this is correct accounting —
    // but the user has been charged twice for the same intent.
    expect(grantsFor(a.id)).toHaveLength(1);
    expect(grantsFor(b.id)).toHaveLength(1);
    expect(grants).toHaveLength(2);
    expect(invoices).toHaveLength(2);
  });
  it('an unpaid duplicate order is closed by expiry, costing nothing', async () => {
    const a = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(a.id).status).toBe('failed');
    expect(grants).toHaveLength(0);
  });
});

// ═══ SIM 10 — provider unknown ═════════════════════════════════════════════
describe('SIM 10 — provider lookup failures', () => {
  it.each([
    ['network timeout', { outcome: 'unknown', reason: 'ETIMEDOUT' }],
    ['http 500',        { outcome: 'unknown', reason: 'razorpay_order_fetch_failed:500' }],
    ['malformed body',  { outcome: 'unknown', reason: 'razorpay_order_fetch_error:invalid json' }],
  ])('%s → unknown: no false failure, no false success', async (_l, out) => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue(out);
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.deferred).toBe(1);
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });
  it('a later PAID lookup recovers the deferred purchase', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'ETIMEDOUT' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe('pending');
    providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_later', providerAmountSubunits: 252000, providerCurrency: 'INR' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 11 — database failures ════════════════════════════════════════════
describe('SIM 11 — database failure handling', () => {
  it('expiry UPDATE failure → deferred_unknown/db_error, NEVER already_completed', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
    fail.update = true;
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.deferred).toBe(1);
    expect(r.details[0].detail).toBe('db_error');
    expect(r.details[0].action).not.toBe('already_completed');
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('credit-ledger failure leaves the row recoverable, never falsely fulfilled', async () => {
    const p = seed();
    creditFails = true;
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_dbfail');
    expect(f.ok).toBe(false);
    expect(get(p.id).fulfillment_status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
    // Recovery on retry, exactly once.
    const again = await fulfillProviderConfirmedPurchase(p.id, 'pay_dbfail');
    expect(again.ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('a throwing row does not poison the sweep (head-of-line isolation)', async () => {
    const old = new Date(Date.now() - 120 * 60_000).toISOString();
    const bad = seed({ created_at: old }); const g1 = seed({ created_at: old }); const g2 = seed({ created_at: old });
    providerOutcome.mockImplementation(async (_p: string, orderId: string) => {
      if (orderId === bad.provider_order_id) throw new Error('poison row');
      return { outcome: 'unpaid', providerRawStatus: 'created' };
    });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.scanned).toBe(3);
    expect(r.errored).toBe(1);
    expect(r.closed).toBe(2);
    expect(get(bad.id).status).toBe('pending');     // retried next sweep
    expect(get(g1.id).status).toBe('failed');
    expect(get(g2.id).status).toBe('failed');
    expect(grants).toHaveLength(0);
  });
});

// ═══ SIM 12 — invoice failure ══════════════════════════════════════════════
describe('SIM 12 — invoice failure after successful fulfilment', () => {
  it('credits granted once; invoice repairable without a second grant', async () => {
    const p = seed();
    invoiceFails = true;
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_inv');
    expect(f.ok).toBe(true);                        // fulfilment is not blocked by invoicing
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(0);      // invoice missing
    await fulfillProviderConfirmedPurchase(p.id, 'pay_inv');   // retry / reconcile
    expect(grantsFor(p.id)).toHaveLength(1);        // still exactly one grant
    expect(invoicesFor(p.id)).toHaveLength(1);      // invoice repaired
  });
});

// ═══ SIM 13 — idempotency stress ═══════════════════════════════════════════
describe('SIM 13 — idempotency stress, interleaved ×15', () => {
  it('one grant, one invoice, one completion across every ordering', async () => {
    const p = seed();
    const e = rzpCaptured(p.provider_order_id!, 'pay_stress');
    const ops = [
      () => deliverWebhook('razorpay', e), () => deliverVerify(p.id, 'pay_stress'),
      () => deliverWebhook('razorpay', e), () => completePurchase(p.id, 'pay_stress'),
      () => deliverVerify(p.id, 'pay_stress'), () => deliverWebhook('razorpay', e),
      () => completePurchase(p.id, 'pay_stress'), () => deliverVerify(p.id, 'pay_stress'),
      () => deliverWebhook('razorpay', e), () => completePurchase(p.id, 'pay_stress'),
      () => deliverVerify(p.id, 'pay_stress'), () => deliverWebhook('razorpay', e),
      () => completePurchase(p.id, 'pay_stress'), () => deliverVerify(p.id, 'pay_stress'),
      () => completePurchase(p.id, 'pay_stress'),
    ];
    for (const op of ops) await op();
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
    expect(get(p.id).status).toBe('completed');
  });
  it('concurrent (Promise.all) delivery still grants once', async () => {
    const p = seed();
    const e = rzpCaptured(p.provider_order_id!, 'pay_conc');
    await Promise.all([
      deliverWebhook('razorpay', e), deliverVerify(p.id, 'pay_conc'),
      deliverWebhook('razorpay', e), completePurchase(p.id, 'pay_conc'),
    ]);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ SIM 14 — multiple independent payments ════════════════════════════════
describe('SIM 14 — two payments do not cross-contaminate', () => {
  it('A +250 and B +250 = +500, correct invoice association', async () => {
    const a = seed(); const b = seed();
    await deliverWebhook('razorpay', rzpCaptured(a.provider_order_id!, 'pay_A'));
    await deliverWebhook('razorpay', rzpCaptured(b.provider_order_id!, 'pay_B'));
    expect(grantsFor(a.id)).toHaveLength(1);
    expect(grantsFor(b.id)).toHaveLength(1);
    expect(grants.reduce((s, g) => s + g.amount, 0)).toBe(500);
    expect(invoices).toEqual([a.id, b.id]);
  });
  it("A's event cannot fulfil B", async () => {
    const a = seed(); const b = seed();
    await deliverWebhook('razorpay', rzpCaptured(a.provider_order_id!, 'pay_A'));
    expect(get(b.id).status).toBe('pending');
    expect(grantsFor(b.id)).toHaveLength(0);
  });
});

// ═══ SIM 15 — provider order mismatch ══════════════════════════════════════
describe('SIM 15 — webhook order id matches no local purchase', () => {
  it('no fulfilment, no grant, no invoice; classified unmatched', async () => {
    const p = seed();
    const w = await deliverWebhook('razorpay', rzpCaptured('order_does_not_exist', 'pay_x'));
    expect(w.allocated).toBe(false);
    expect(w.note).toBe('payment_webhook_unmatched_order');
    expect(get(p.id).status).toBe('pending');
    expect(grants).toHaveLength(0);
    expect(invoices).toHaveLength(0);
  });
});

// ═══ SIM 16 — AMOUNT integrity ═════════════════════════════════════════════
describe('SIM 16 — amount mismatch (R1 — was a GAP, now gated)', () => {
  it('an underpaid capture is BLOCKED: no completion, no credits, no invoice', async () => {
    const p = seed({ amount_paid: 2520 });          // expected ₹2,520
    // Provider reports ₹1 captured for this order.
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_underpaid', 100));
    expect(w.allocated).toBe(false);
    expect(get(p.id).status).not.toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });
  it('an overpaid capture is BLOCKED too — mismatch is symmetric', async () => {
    const p = seed({ amount_paid: 2520 });
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_over', 999999));
    expect(w.allocated).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('an exact capture still fulfils normally', async () => {
    const p = seed({ amount_paid: 2520 });
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_exact', 252000));
    expect(w.allocated).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('a payload with no amount is BLOCKED as UNKNOWN, not granted', async () => {
    const p = seed();
    const evt: any = rzpCaptured(p.provider_order_id!, 'pay_noamt');
    delete evt.payload.payment.entity.amount;
    const w = await deliverWebhook('razorpay', evt);
    expect(w.allocated).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
});

// ═══ SIM 17 — CURRENCY integrity ═══════════════════════════════════════════
describe('SIM 17 — currency mismatch (R2 — was a GAP, now gated)', () => {
  it('a foreign-currency capture against an INR purchase is BLOCKED', async () => {
    const p = seed({ currency: 'INR', amount_paid: 2520 });
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_usd', 252000, 'USD'));
    expect(w.allocated).toBe(false);
    expect(get(p.id).status).not.toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });
  it('no FX is applied — a numerically equal USD amount is still refused', async () => {
    const p = seed({ currency: 'INR', amount_paid: 2520 });
    const w = await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_fx', 252000, 'USD'));
    expect(w.allocated).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('a payload with no currency is BLOCKED as UNKNOWN', async () => {
    const p = seed();
    const evt: any = rzpCaptured(p.provider_order_id!, 'pay_nocur');
    delete evt.payload.payment.entity.currency;
    const w = await deliverWebhook('razorpay', evt);
    expect(w.allocated).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
});

// ═══ SIM 18 — provider state mapping ═══════════════════════════════════════
describe('SIM 18 — which provider states are treated as paid', () => {
  it.each([
    ['paid',       'paid',    'completed', 1],
    ['created',    'unpaid',  'failed',    0],
    ['attempted',  'unpaid',  'failed',    0],
    ['failed',     'unpaid',  'failed',    0],
  ])('order status %s → %s → purchase %s, grants=%i', async (_raw, outcome, expectedStatus, expectedGrants) => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome, providerRawStatus: _raw, providerPaymentId: 'pay_s', providerAmountSubunits: 252000, providerCurrency: 'INR' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe(expectedStatus);
    expect(grantsFor(p.id)).toHaveLength(expectedGrants);
  });
  it('unknown never grants and never fails', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'x' });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
  });
});

// ═══ SIM 19 — refund ═══════════════════════════════════════════════════════
describe('SIM 19 — refund events', () => {
  it('a refund event is not recognised and has no effect on a completed purchase', async () => {
    const p = seed();
    await deliverWebhook('razorpay', rzpCaptured(p.provider_order_id!, 'pay_ref'));
    expect(grantsFor(p.id)).toHaveLength(1);
    const refund = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_ref' } } } };
    const w = await deliverWebhook('razorpay', refund);
    expect(w.allocated).toBe(false);
    expect(w.note).toBe('not_a_success_event');
    expect(get(p.id).status).toBe('completed');     // unchanged
    expect(grantsFor(p.id)).toHaveLength(1);        // credits NOT reversed
  });
});
