/**
 * P1 HARDENING — amount + currency authority (R1 / R2).
 *
 * Proves that `provider says PAID` is no longer sufficient to move money: the
 * provider-stated amount and currency must also match what the purchase was
 * for, on EVERY settlement path (verify, webhook, expiry, reconciliation,
 * late-success reopen).
 *
 * Two layers are exercised:
 *   1. the pure validator, across well-formed / malformed / missing inputs;
 *   2. the real fulfillment chokepoint, so a mismatch is proven to grant
 *      nothing rather than merely to return a flag.
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

function applyFilters(rows: Row[], f: Filter[]): Row[] {
  return rows.filter((r) => f.every((x) => {
    const v = r[x.col];
    if (x.op === 'eq') return v === x.val;
    if (x.op === 'neq') return v !== x.val;
    return String(v) < String(x.val);
  }));
}
function makeBuilder(mode: 'select' | 'update', values?: Record<string, unknown>) {
  const filters: Filter[] = []; let limitN: number | null = null;
  const run = () => {
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

const grants: Array<{ amount: number; key: string }> = [];
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: jest.fn(async (a: any) => {
    if (grants.some((g) => g.key === a.idempotencyKey)) return { deduped: true };
    grants.push({ amount: a.amount, key: a.idempotencyKey }); return { ok: true };
  }),
  makeIdempotencyKey: (o: string, t: string, i: string) => `${o}:${t}:${i}`,
}));
const invoices: string[] = [];
jest.mock('../../services/billing/topupInvoiceService', () => ({
  generateTopupInvoice: jest.fn(async (id: string) => {
    if (!invoices.includes(id)) invoices.push(id);
    return { invoiceNumber: `INV-${id}` };
  }),
}));
jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => ({ requestId: 't', correlationId: 't' }),
}));
const providerOutcome = jest.fn();
jest.mock('../../services/payments/orchestrator', () => ({
  resolveProviderOrderOutcome: (...a: unknown[]) => providerOutcome(...a),
}));

import { validateProviderFinancials, toSubunits } from '../../services/billing/paymentFinancialValidator';
import {
  fulfillProviderConfirmedPurchase, expireStalePendingPurchases,
} from '../../services/billing/purchaseClosureService';
import { reconcile } from '../../services/billing/commercialReconciliationService';

const ORG = 'org_fv';
let seq = 0;
function seed(over: Partial<Row> = {}): Row {
  seq += 1;
  const row: Row = {
    id: over.id ?? `pur_${seq}`, organization_id: ORG, credits: 250, amount_paid: 2520,
    currency: 'INR', status: 'pending', fulfillment_status: 'pending', reference_id: null,
    provider: 'razorpay', provider_order_id: `order_${seq}`, provider_payload: {},
    created_at: new Date().toISOString(), ...over,
  };
  db.rows.push(row); return row;
}
const get = (id: string) => db.rows.find((r) => r.id === id)!;
const grantsFor = (id: string) => grants.filter((g) => g.key.endsWith(`:${id}`));
const invoicesFor = (id: string) => invoices.filter((i) => i === id);
/** Correct financials for the default seed: ₹2,520 INR. */
const GOOD = { amountSubunits: 252000, currency: 'INR' };

beforeEach(() => {
  db.rows = []; grants.length = 0; invoices.length = 0; seq = 0;
  providerOutcome.mockReset();
  providerOutcome.mockResolvedValue({
    outcome: 'paid', providerPaymentId: 'pay_ok',
    providerAmountSubunits: 252000, providerCurrency: 'INR', providerRawStatus: 'paid',
  });
});

// ═══ THE VALIDATOR ═════════════════════════════════════════════════════════
describe('validator — exact, integer, no conversion', () => {
  const base = { expectedAmountMajor: 2520, expectedCurrency: 'INR' };

  it('1 — correct amount + currency → VALID', () => {
    expect(validateProviderFinancials({ ...base, provider: GOOD })).toMatchObject({ ok: true, code: 'VALID' });
  });
  it('5 — amount too low → AMOUNT_MISMATCH', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 100, currency: 'INR' } }))
      .toMatchObject({ ok: false, code: 'AMOUNT_MISMATCH' });
  });
  it('6 — amount too high → AMOUNT_MISMATCH', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 999999, currency: 'INR' } }))
      .toMatchObject({ ok: false, code: 'AMOUNT_MISMATCH' });
  });
  it('7 — amount zero → UNKNOWN (unusable, not a mismatch to chase)', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 0, currency: 'INR' } }))
      .toMatchObject({ ok: false, code: 'UNKNOWN', detail: 'provider_amount_non_positive' });
  });
  it('8 — amount missing → UNKNOWN', () => {
    expect(validateProviderFinancials({ ...base, provider: { currency: 'INR' } }))
      .toMatchObject({ ok: false, code: 'UNKNOWN', detail: 'provider_amount_missing' });
  });
  it('9 — currency mismatch → CURRENCY_MISMATCH (checked before amount)', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 252000, currency: 'USD' } }))
      .toMatchObject({ ok: false, code: 'CURRENCY_MISMATCH' });
  });
  it('10 — currency missing → UNKNOWN', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 252000 } }))
      .toMatchObject({ ok: false, code: 'UNKNOWN', detail: 'provider_currency_missing' });
  });
  it('11 — malformed amount → UNKNOWN', () => {
    for (const bad of [NaN, Infinity, 'abc' as unknown as number, 2520.5]) {
      expect(validateProviderFinancials({ ...base, provider: { amountSubunits: bad as number, currency: 'INR' } }).code)
        .toBe('UNKNOWN');
    }
  });
  it('12 — malformed currency → UNKNOWN', () => {
    for (const bad of ['IN', 'INRR', '123', '  ']) {
      expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 252000, currency: bad } }).code)
        .toBe('UNKNOWN');
    }
  });
  it('13 — provider financials entirely absent → UNKNOWN', () => {
    expect(validateProviderFinancials({ ...base, provider: null })).toMatchObject({ ok: false, code: 'UNKNOWN' });
  });
  it('never converts currency — USD amount equal in number is still a mismatch', () => {
    const r = validateProviderFinancials({ ...base, provider: { amountSubunits: 252000, currency: 'USD' } });
    expect(r.code).toBe('CURRENCY_MISMATCH');
    expect(r.ok).toBe(false);
  });
  it('case-insensitive currency, exact integer amount', () => {
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 252000, currency: 'inr' } }).ok).toBe(true);
    expect(validateProviderFinancials({ ...base, provider: { amountSubunits: 251999, currency: 'INR' } }).code)
      .toBe('AMOUNT_MISMATCH');
  });
  it('expected side unusable → UNKNOWN, never a pass', () => {
    expect(validateProviderFinancials({ expectedAmountMajor: 0, expectedCurrency: 'INR', provider: GOOD }).code).toBe('UNKNOWN');
    expect(validateProviderFinancials({ expectedAmountMajor: 2520, expectedCurrency: '', provider: GOOD }).code).toBe('UNKNOWN');
  });
  it('toSubunits is integer-exact', () => {
    expect(toSubunits(2520)).toBe(252000);
    expect(toSubunits(46.2)).toBe(4620);      // no float drift
  });
});

// ═══ §13 — THE EXACT VULNERABILITY REPRODUCTION ════════════════════════════
describe('§13 — the simulation that exposed R1/R2, re-run against the gate', () => {
  it('₹2,520 purchase + PAID ₹1 INR → BLOCKED, 0 credits, 0 invoice', async () => {
    const p = seed({ amount_paid: 2520, currency: 'INR' });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_underpaid', { amountSubunits: 100, currency: 'INR' });

    expect(f.ok).toBe(false);
    expect(f.code).toBe('AMOUNT_MISMATCH');
    expect(get(p.id).status).not.toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });

  it('₹2,520 purchase + PAID ₹2,520 INR → completed, +250 once, 1 invoice', async () => {
    const p = seed({ amount_paid: 2520, currency: 'INR' });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_ok', GOOD);

    expect(f.ok).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(grantsFor(p.id)[0].amount).toBe(250);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });

  it('₹2,520 INR purchase + PAID 2,520 USD → BLOCKED', async () => {
    const p = seed({ amount_paid: 2520, currency: 'INR' });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_usd', { amountSubunits: 252000, currency: 'USD' });

    expect(f.ok).toBe(false);
    expect(f.code).toBe('CURRENCY_MISMATCH');
    expect(get(p.id).status).not.toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
  });
});

// ═══ EVERY SETTLEMENT PATH IS GATED ════════════════════════════════════════
describe('every fulfillment entry point enforces the gate', () => {
  it('2 — webhook path: good financials fulfil', async () => {
    const p = seed();
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_w', GOOD);
    expect(f.ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
  it('webhook path: bad financials blocked', async () => {
    const p = seed();
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_w', { amountSubunits: 1, currency: 'INR' });
    expect(f.ok).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('verify path (no financials supplied) resolves the provider authoritatively', async () => {
    const p = seed();
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_v');    // nothing passed in
    expect(providerOutcome).toHaveBeenCalled();                          // provider was asked
    expect(f.ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
  it('verify path is blocked when the authoritative amount disagrees', async () => {
    const p = seed();
    providerOutcome.mockResolvedValue({
      outcome: 'paid', providerPaymentId: 'pay_v', providerAmountSubunits: 100, providerCurrency: 'INR',
    });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_v');
    expect(f.ok).toBe(false);
    expect(f.code).toBe('AMOUNT_MISMATCH');
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('verify path is blocked when the provider states PAID with no amount', async () => {
    const p = seed();
    providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_v' }); // legacy-shaped
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_v');
    expect(f.ok).toBe(false);
    expect(f.code).toBe('UNKNOWN');
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('3 — expiry sweep: paid + matching financials fulfils', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.fulfilled).toBe(1);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
  it('expiry sweep: paid but mismatched amount does NOT fulfil and does NOT close', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({
      outcome: 'paid', providerPaymentId: 'pay_x', providerAmountSubunits: 100, providerCurrency: 'INR',
    });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.fulfilled).toBe(0);
    expect(grantsFor(p.id)).toHaveLength(0);
    expect(invoicesFor(p.id)).toHaveLength(0);
    expect(get(p.id).status).not.toBe('completed');
  });

  it('reconciliation: repair is gated and cannot settle a mismatch', async () => {
    const p = seed({ status: 'completed', fulfillment_status: 'event_recorded' });
    providerOutcome.mockResolvedValue({
      outcome: 'paid', providerPaymentId: 'pay_r', providerAmountSubunits: 100, providerCurrency: 'INR',
    });
    const r = await reconcile({ kind: 'global' }, false);
    expect(r.found).toBe(1);
    expect(r.repaired).toBe(0);
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('4 — reconciliation repairs when financials match', async () => {
    const p = seed({ status: 'completed', fulfillment_status: 'event_recorded' });
    const r = await reconcile({ kind: 'global' }, false);
    expect(r.repaired).toBe(1);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });

  it('late success: reopen is gated — a mismatched late payment cannot resurrect a closure', async () => {
    const p = seed({
      status: 'failed', fulfillment_status: 'failed',
      provider_payload: { closure: { reason: 'stale_pending_expiry', reopenable: true } },
    });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_late', { amountSubunits: 1, currency: 'INR' });
    expect(f.ok).toBe(false);
    expect(get(p.id).status).toBe('failed');       // still closed
    expect(grantsFor(p.id)).toHaveLength(0);
  });
  it('late success with matching financials still reopens and fulfils once', async () => {
    const p = seed({
      status: 'failed', fulfillment_status: 'failed',
      provider_payload: { closure: { reason: 'stale_pending_expiry', reopenable: true } },
    });
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_late', GOOD);
    expect(f.ok).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
});

// ═══ RECOVERY ══════════════════════════════════════════════════════════════
describe('recovery after a blocked settlement', () => {
  it('14 — mismatch, then a corrected authoritative response fulfils exactly once', async () => {
    const p = seed();
    const bad = await fulfillProviderConfirmedPurchase(p.id, 'pay_1', { amountSubunits: 100, currency: 'INR' });
    expect(bad.ok).toBe(false);
    expect(grantsFor(p.id)).toHaveLength(0);

    const good = await fulfillProviderConfirmedPurchase(p.id, 'pay_1', GOOD);
    expect(good.ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('15 — UNKNOWN, then valid → fulfils once', async () => {
    const p = seed();
    expect((await fulfillProviderConfirmedPurchase(p.id, 'pay_1', { currency: 'INR' })).code).toBe('UNKNOWN');
    expect(grantsFor(p.id)).toHaveLength(0);
    expect((await fulfillProviderConfirmedPurchase(p.id, 'pay_1', GOOD)).ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
  it('16 — currency mismatch, then corrected → fulfils once', async () => {
    const p = seed();
    expect((await fulfillProviderConfirmedPurchase(p.id, 'p', { amountSubunits: 252000, currency: 'USD' })).code)
      .toBe('CURRENCY_MISMATCH');
    expect((await fulfillProviderConfirmedPurchase(p.id, 'p', GOOD)).ok).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
  it('a blocked purchase remains recoverable by the expiry sweep', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    await fulfillProviderConfirmedPurchase(p.id, 'p', { amountSubunits: 100, currency: 'INR' });
    expect(get(p.id).status).toBe('pending');       // untouched, still sweepable
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(r.fulfilled).toBe(1);
    expect(grantsFor(p.id)).toHaveLength(1);
  });
});

// ═══ EXACTLY-ONCE PRESERVED ════════════════════════════════════════════════
describe('exactly-once survives the added validation', () => {
  it('17/18 — valid settlement ×6 (webhook-shaped and verify-shaped) grants once', async () => {
    const p = seed();
    for (let i = 0; i < 3; i++) await fulfillProviderConfirmedPurchase(p.id, 'pay_s', GOOD);
    for (let i = 0; i < 3; i++) await fulfillProviderConfirmedPurchase(p.id, 'pay_s');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
    expect(get(p.id).status).toBe('completed');
  });
  it('19 — interleaved verify + webhook + reconcile grants once', async () => {
    const p = seed();
    await fulfillProviderConfirmedPurchase(p.id, 'pay_i', GOOD);
    await reconcile({ kind: 'global' }, false);
    await fulfillProviderConfirmedPurchase(p.id, 'pay_i');
    await reconcile({ kind: 'global' }, false);
    await fulfillProviderConfirmedPurchase(p.id, 'pay_i', GOOD);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('20 — concurrent settlement attempts grant once', async () => {
    const p = seed();
    await Promise.all([
      fulfillProviderConfirmedPurchase(p.id, 'pay_c', GOOD),
      fulfillProviderConfirmedPurchase(p.id, 'pay_c', GOOD),
      fulfillProviderConfirmedPurchase(p.id, 'pay_c'),
      fulfillProviderConfirmedPurchase(p.id, 'pay_c', GOOD),
    ]);
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoicesFor(p.id)).toHaveLength(1);
  });
  it('validation runs BEFORE fulfillment — a blocked attempt leaves no partial state', async () => {
    const p = seed();
    await fulfillProviderConfirmedPurchase(p.id, 'pay_b', { amountSubunits: 100, currency: 'INR' });
    expect(get(p.id).status).toBe('pending');
    expect(get(p.id).fulfillment_status).toBe('pending');
    expect(grants).toHaveLength(0);
    expect(invoices).toHaveLength(0);
  });
});
