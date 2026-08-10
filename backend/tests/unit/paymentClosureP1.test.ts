/**
 * P1 (Truth & Safety) — purchase closure, stale-pending expiry, and the
 * provider-wins race rule.
 *
 * These run the REAL purchaseService + REAL purchaseClosureService against an
 * in-memory `credit_purchases` table, so the assertions are about actual state
 * transitions rather than mock call counts. Only the leaf effects are stubbed:
 *
 *   creditExecutionService  → counts grants (proves no double-grant)
 *   topupInvoiceService     → counts invoices (proves no duplicate invoice)
 *   payments/orchestrator   → controls what "the provider says"
 *
 * Covers matrix tests 3–9 plus the fail-safe `unknown` behaviour.
 */

// ── in-memory credit_purchases ───────────────────────────────────────────────
interface Row {
  id: string;
  organization_id: string;
  credits: number;
  amount_paid: number;
  currency: string;
  status: string;
  fulfillment_status: string | null;
  reference_id: string | null;
  provider: string | null;
  provider_order_id: string | null;
  provider_payload: Record<string, unknown>;
  created_at: string;
  [k: string]: unknown;
}

const db: { rows: Row[] } = { rows: [] };

type Filter = { op: 'eq' | 'neq' | 'lt'; col: string; val: unknown };

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) => filters.every((f) => {
    const v = r[f.col];
    if (f.op === 'eq') return v === f.val;
    if (f.op === 'neq') return v !== f.val;
    return String(v) < String(f.val); // lt — ISO timestamps compare lexically
  }));
}

/**
 * P2-A2: opt-in single-shot UPDATE failure. The real client surfaces transport /
 * permission errors as `{ data: null, error }`; without a way to express that,
 * the DB-error branch in closeOnePurchase is untestable. Off by default and
 * reset in beforeEach, so no existing test changes behaviour.
 */
const failNextUpdate = { on: false, message: 'simulated db failure' };

function makeBuilder(mode: 'select' | 'update', values?: Record<string, unknown>) {
  const filters: Filter[] = [];
  let limitN: number | null = null;

  const run = (): { data: Row[]; error: { message: string } | null } => {
    const matched = applyFilters(db.rows, filters);
    if (mode === 'select') {
      const sliced = limitN == null ? matched : matched.slice(0, limitN);
      return { data: sliced, error: null };
    }
    if (failNextUpdate.on) {
      failNextUpdate.on = false;
      return { data: [], error: { message: failNextUpdate.message } };   // no mutation
    }
    // update — mutate every matched row
    for (const r of matched) Object.assign(r, values);
    return { data: matched, error: null };
  };

  const api: any = {
    eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return api; },
    neq(col: string, val: unknown) { filters.push({ op: 'neq', col, val }); return api; },
    lt(col: string, val: unknown) { filters.push({ op: 'lt', col, val }); return api; },
    order() { return api; },
    limit(n: number) { limitN = n; return api; },
    select() { return api; },
    single() { const { data } = run(); return Promise.resolve({ data: data[0] ?? null, error: data.length ? null : { message: 'not found' } }); },
    // Propagates run()'s error the way the real client does — previously this
    // hardcoded `error: null`, which made a DB failure indistinguishable from
    // "no row matched" (i.e. from a lost CAS race).
    maybeSingle() { const { data, error } = run(); return Promise.resolve({ data: error ? null : (data[0] ?? null), error }); },
    then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve); },
  };
  return api;
}

const fakeTable = () => ({
  select: () => makeBuilder('select'),
  update: (values: Record<string, unknown>) => makeBuilder('update', values),
  insert: (values: Record<string, unknown>) => { db.rows.push(values as Row); return makeBuilder('select'); },
});

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => fakeTable() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => fakeTable() } }));

// ── leaf effects ─────────────────────────────────────────────────────────────
const grants: Array<{ orgId: string; amount: number; idempotencyKey: string }> = [];
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: jest.fn(async (args: any) => {
    // Deterministic-key semantics: a repeated key is a no-op, exactly like the
    // real ledger's UNIQUE(idempotency_key).
    if (grants.some((g) => g.idempotencyKey === args.idempotencyKey)) return { deduped: true };
    grants.push({ orgId: args.orgId, amount: args.amount, idempotencyKey: args.idempotencyKey });
    return { ok: true };
  }),
  makeIdempotencyKey: (org: string, type: string, id: string) => `${org}:${type}:${id}`,
}));

const invoices: string[] = [];
jest.mock('../../services/billing/topupInvoiceService', () => ({
  generateTopupInvoice: jest.fn(async (purchaseId: string) => {
    // Deterministic invoice number + UNIQUE — a retry returns the existing one.
    if (!invoices.includes(purchaseId)) invoices.push(purchaseId);
    return { invoiceNumber: `INV-TEST-${purchaseId}` };
  }),
}));

jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => ({ requestId: 'req_test', correlationId: 'corr_test' }),
}));

// ── the provider's word ──────────────────────────────────────────────────────
const providerOutcome = jest.fn();
jest.mock('../../services/payments/orchestrator', () => ({
  resolveProviderOrderOutcome: (...args: unknown[]) => providerOutcome(...args),
}));

import {
  closePurchaseFromClient,
  expireStalePendingPurchases,
  fulfillProviderConfirmedPurchase,
} from '../../services/billing/purchaseClosureService';
import { completePurchase, reopenSystemClosedPurchase } from '../../services/purchaseService';

const ORG = 'org_p1';

function seed(over: Partial<Row> = {}): Row {
  const row: Row = {
    id: over.id ?? `pur_${db.rows.length + 1}`,
    organization_id: ORG,
    credits: 250,
    amount_paid: 2520,
    currency: 'INR',
    status: 'pending',
    fulfillment_status: 'pending',
    reference_id: null,
    provider: 'razorpay',
    provider_order_id: `order_${db.rows.length + 1}`,
    provider_payload: {},
    created_at: new Date().toISOString(),
    ...over,
  };
  db.rows.push(row);
  return row;
}

const get = (id: string) => db.rows.find((r) => r.id === id)!;
const grantsFor = (id: string) => grants.filter((g) => g.idempotencyKey.endsWith(`:${id}`));

beforeEach(() => {
  db.rows = [];
  grants.length = 0;
  invoices.length = 0;
  failNextUpdate.on = false;
  providerOutcome.mockReset();
  providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('M5 — client-reported closure is a request, not a verdict', () => {
  it('closes a pending purchase when the provider confirms it was never paid', async () => {
    const p = seed();
    const out = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(out.action).toBe('closed');
    expect(get(p.id).status).toBe('failed');
    expect(get(p.id).fulfillment_status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
    // Marked as OUR closure, so a late provider success can still reopen it.
    expect((get(p.id).provider_payload as any).closure).toMatchObject({
      reason: 'client_reported_failure', reopenable: true, source: 'omnivyra',
    });
  });

  it('TEST 7 — provider-confirmed success BEATS a client failure report', async () => {
    const p = seed();
    providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_win', providerRawStatus: 'paid' });

    const out = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(out.action).toBe('fulfilled');
    expect(get(p.id).status).toBe('completed');
    expect(get(p.id).fulfillment_status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(grantsFor(p.id)[0].amount).toBe(250);
    expect(invoices).toEqual([p.id]);
  });

  it('defers instead of closing when the provider cannot be reached', async () => {
    const p = seed();
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'razorpay_order_fetch_error:ETIMEDOUT' });

    const out = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(out.action).toBe('deferred_unknown');
    expect(get(p.id).status).toBe('pending');   // untouched — an outage is not a decline
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('never downgrades a completed purchase', async () => {
    const p = seed({ status: 'completed', fulfillment_status: 'completed' });
    const out = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(out.action).toBe('already_completed');
    expect(get(p.id).status).toBe('completed');
    expect(providerOutcome).not.toHaveBeenCalled();  // terminal — nothing to ask
  });

  it('is idempotent on an already-closed purchase', async () => {
    const p = seed();
    await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });
    const second = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(second.action).toBe('already_closed');
    expect(get(p.id).status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('refuses a purchase belonging to another organization', async () => {
    const p = seed({ organization_id: 'org_other' });
    const out = await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure' });

    expect(out.action).toBe('not_found');
    expect(get(p.id).status).toBe('pending');   // untouched
  });

  it('cannot grant credits — closure never allocates', async () => {
    const p = seed();
    await closePurchaseFromClient({ purchaseId: p.id, organizationId: ORG, reason: 'client_cancelled' });
    expect(grants).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B3 — stale-pending expiry is provider-checked, never clock-only', () => {
  const old = () => new Date(Date.now() - 120 * 60_000).toISOString();

  it('TEST 8 — expires an unresolved purchase past TTL', async () => {
    const p = seed({ created_at: old() });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });

    expect(r.scanned).toBe(1);
    expect(r.closed).toBe(1);
    expect(get(p.id).status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('leaves a fresh pending purchase alone', async () => {
    const p = seed({ created_at: new Date().toISOString() });
    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });

    expect(r.scanned).toBe(0);
    expect(get(p.id).status).toBe('pending');
  });

  it('FULFILLS rather than expires when the provider says paid — the "browser disappeared" recovery', async () => {
    const p = seed({ created_at: old() });
    providerOutcome.mockResolvedValue({ outcome: 'paid', providerPaymentId: 'pay_recovered' });

    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });

    expect(r.fulfilled).toBe(1);
    expect(r.closed).toBe(0);
    expect(get(p.id).status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoices).toEqual([p.id]);
  });

  it('defers a stale purchase when the provider is unreachable', async () => {
    const p = seed({ created_at: old() });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'provider_down' });

    const r = await expireStalePendingPurchases({ ttlMinutes: 30 });

    expect(r.deferred).toBe(1);
    expect(get(p.id).status).toBe('pending');   // retried next sweep
  });

  it('is idempotent across repeated sweeps', async () => {
    seed({ created_at: old() });
    const first = await expireStalePendingPurchases({ ttlMinutes: 30 });
    const second = await expireStalePendingPurchases({ ttlMinutes: 30 });

    expect(first.closed).toBe(1);
    expect(second.scanned).toBe(0);   // no longer pending
    expect(grants).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('expired → late webhook must NOT lose the payment', () => {
  it('reopens a system-closed purchase and fulfills it exactly once', async () => {
    const p = seed({ created_at: new Date(Date.now() - 120 * 60_000).toISOString() });
    await expireStalePendingPurchases({ ttlMinutes: 30 });
    expect(get(p.id).status).toBe('failed');

    // Razorpay finally delivers payment.captured.
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_late');

    expect(f.ok).toBe(true);
    expect(get(p.id).status).toBe('completed');
    expect(get(p.id).fulfillment_status).toBe('completed');
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoices).toEqual([p.id]);
  });

  it('refuses to reopen a purchase the PROVIDER declined', async () => {
    // No closure marker => not ours => a genuine provider failure.
    const p = seed({ status: 'failed', fulfillment_status: 'failed', provider_payload: {} });

    const reopened = await reopenSystemClosedPurchase(p.id);
    const f = await fulfillProviderConfirmedPurchase(p.id, 'pay_x');

    expect(reopened).toBe(false);
    expect(f.ok).toBe(false);
    expect(get(p.id).status).toBe('failed');
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('does not reopen a closure explicitly marked non-reopenable', async () => {
    const p = seed({
      status: 'failed', fulfillment_status: 'failed',
      provider_payload: { closure: { reason: 'provider_declined', reopenable: false } },
    });
    expect(await reopenSystemClosedPurchase(p.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('TESTS 3/4/5/9 — duplicate delivery and replay cannot duplicate money', () => {
  it('TEST 3 — the same provider success applied twice grants once', async () => {
    const p = seed();
    await fulfillProviderConfirmedPurchase(p.id, 'pay_dup');
    await fulfillProviderConfirmedPurchase(p.id, 'pay_dup');

    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoices).toEqual([p.id]);
    expect(get(p.id).status).toBe('completed');
  });

  it('TEST 4 — verify fulfills, a later webhook is a no-op', async () => {
    const p = seed();
    await fulfillProviderConfirmedPurchase(p.id, 'pay_verify');   // verify path
    const webhook = await fulfillProviderConfirmedPurchase(p.id, 'pay_verify'); // webhook path

    expect(webhook.ok).toBe(true);            // idempotent success, not an error
    expect(grantsFor(p.id)).toHaveLength(1);
    expect(invoices).toHaveLength(1);
  });

  it('TEST 5 — webhook fulfills, a later verify is idempotent', async () => {
    const p = seed();
    await fulfillProviderConfirmedPurchase(p.id, 'pay_hook');     // webhook first
    const verify = await completePurchase(p.id, 'pay_hook');      // verify second

    expect(verify.success).toBe(true);
    expect(grantsFor(p.id)).toHaveLength(1);
  });

  it('TEST 9 — reconciliation replay of a paid-but-unfulfilled row grants once', async () => {
    // The exact shape commercialReconciliationService repairs.
    const p = seed({ status: 'completed', fulfillment_status: 'event_recorded' });

    await completePurchase(p.id, 'pay_recon');
    await completePurchase(p.id, 'pay_recon');   // replay

    expect(grantsFor(p.id)).toHaveLength(1);
    expect(get(p.id).fulfillment_status).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('P2-A — the expiry sweep survives a bad row and never lies about a DB failure', () => {
  it('A1 — a row that throws is isolated: the sweep completes and later rows still run', async () => {
    // Ordered created_at ASC, so the throwing row is scanned FIRST. Before
    // per-row isolation this aborted the whole sweep — and because the same row
    // sorts first every time, it would stall expiry for everything behind it on
    // every subsequent run (head-of-line blocking), not just once.
    const stale = (n: number) => new Date(Date.now() - (100 - n) * 60 * 60_000).toISOString();
    const poison = seed({ id: 'pur_poison', created_at: stale(0) });
    const ok1 = seed({ id: 'pur_ok1', created_at: stale(1) });
    const ok2 = seed({ id: 'pur_ok2', created_at: stale(2) });

    providerOutcome.mockImplementation(async (_p: unknown, orderId: string) => {
      if (orderId === poison.provider_order_id) throw new Error('provider adapter exploded');
      return { outcome: 'unpaid', providerRawStatus: 'created' };
    });

    const res = await expireStalePendingPurchases({ ttlMinutes: 1 });

    expect(res.scanned).toBe(3);
    expect(res.errored).toBe(1);
    // The two healthy rows behind the poison row were still processed.
    expect(res.closed).toBe(2);
    expect(get(ok1.id).status).toBe('failed');
    expect(get(ok2.id).status).toBe('failed');
    // The failure is surfaced, not swallowed, and the row stays pending for retry.
    expect(res.details).toContainEqual(
      expect.objectContaining({ purchaseId: 'pur_poison', action: 'errored' }),
    );
    expect(get(poison.id).status).toBe('pending');
    // Nothing was granted anywhere in this sweep.
    expect(grants).toHaveLength(0);
  });

  it('A2 — a failed DB update is deferred_unknown/db_error, never already_completed', async () => {
    const p = seed();
    providerOutcome.mockResolvedValue({ outcome: 'unpaid', providerRawStatus: 'created' });
    failNextUpdate.on = true;

    const out = await closePurchaseFromClient({
      purchaseId: p.id, organizationId: ORG, reason: 'client_reported_failure',
    });

    expect(out.action).toBe('deferred_unknown');
    expect(out.detail).toBe('db_error');
    // The dangerous misreport: a transport failure looking like someone else
    // already settled it, which would retire the row from the sweep's attention.
    expect(out.action).not.toBe('already_completed');
    // The write did not land, so the row is untouched and will be retried.
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
  });

  it('A3 — existing successful behaviour is unchanged (closes, fulfils, counts)', async () => {
    const old = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    const unpaid = seed({ id: 'pur_unpaid', created_at: old });
    const paid = seed({ id: 'pur_paid', created_at: old });

    providerOutcome.mockImplementation(async (_p: unknown, orderId: string) =>
      orderId === paid.provider_order_id
        ? { outcome: 'paid', providerPaymentId: 'pay_a3', providerRawStatus: 'paid' }
        : { outcome: 'unpaid', providerRawStatus: 'created' });

    const res = await expireStalePendingPurchases({ ttlMinutes: 1 });

    expect(res.scanned).toBe(2);
    expect(res.closed).toBe(1);
    expect(res.fulfilled).toBe(1);
    expect(res.errored).toBe(0);
    expect(get(unpaid.id).status).toBe('failed');
    expect(get(paid.id).status).toBe('completed');
    // The provider-confirmed row granted exactly once; the unpaid one not at all.
    expect(grantsFor(paid.id)).toHaveLength(1);
    expect(grantsFor(unpaid.id)).toHaveLength(0);
    expect(invoices).toEqual([paid.id]);
  });

  it('A4 — an unknown provider state still defers; unknown is never coerced to unpaid', async () => {
    const p = seed({ created_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString() });
    providerOutcome.mockResolvedValue({ outcome: 'unknown', reason: 'provider_unreachable' });

    const res = await expireStalePendingPurchases({ ttlMinutes: 1 });

    expect(res.deferred).toBe(1);
    expect(res.closed).toBe(0);
    expect(res.errored).toBe(0);
    // A gateway outage must never look like a customer who did not pay.
    expect(get(p.id).status).toBe('pending');
    expect(grantsFor(p.id)).toHaveLength(0);
  });
});
