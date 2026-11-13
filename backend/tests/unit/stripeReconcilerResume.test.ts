/**
 * e1 2026-11-13 (owed; MONEY, non-blocking - the reconciler is a localhost CLI): ingestStripeInvoice classified a
 * failed import as 'duplicate' by MESSAGE TEXT and returned without reconciling - a half-written run (import landed,
 * run / adjustments did not) was never completed, and any error containing "duplicate" read as success. Now: 23505 by
 * SQLSTATE, resume only onto THIS invoice in THIS period with THIS total, the run stays 'running' until its
 * adjustments are in, typed refusals otherwise.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let mockImportInsertError: any = null;
let mockAdjInsertError: any = null;
let mockRunSeq = 0;

function q(table: string) {
  const filters: Array<[string, unknown]> = [];
  let mode: 'select' | 'update' = 'select';
  let patch: Row = {};
  let countHead = false;
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const api: any = {
    select: (_c?: string, opts?: { count?: string; head?: boolean }) => { if (opts?.head) countHead = true; return api; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    gte: () => api, lt: () => api,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    update: (p: Row) => { mode = 'update'; patch = p; return api; },
    then: (res: (v: unknown) => unknown) => {
      if (mode === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res); }
      if (countHead) return Promise.resolve({ count: rows().length, error: null }).then(res);
      return Promise.resolve({ data: rows(), error: null }).then(res);
    },
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'provider_invoice_imports') {
        return {
          ...q(table),
          insert: async (row: Row) => {
            if (mockImportInsertError) return { error: mockImportInsertError };
            const dup = (db[table] ??= []).some((r) => r.provider === row.provider && r.provider_invoice_id === row.provider_invoice_id);
            if (dup) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "provider_invoice_imports_provider_provider_invoice_id_key"' } };
            db[table].push({ ...row }); return { error: null };
          },
        };
      }
      if (table === 'cost_reconciliation_runs') {
        return {
          ...q(table),
          upsert: (row: Row) => ({
            select: () => ({
              single: async () => {
                const list = (db[table] ??= []);
                let r = list.find((x) => x.provider === row.provider && x.period_start === row.period_start && x.period_end === row.period_end);
                if (r) Object.assign(r, row); else { r = { id: `run-${++mockRunSeq}`, ...row }; list.push(r); }
                return { data: { id: r.id }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'cost_reconciliation_adjustments') {
        return {
          ...q(table),
          insert: async (rows: Row[]) => {
            if (mockAdjInsertError) return { error: mockAdjInsertError };
            (db[table] ??= []).push(...rows); return { error: null };
          },
        };
      }
      return q(table); // credit_purchases / payment_transactions / billing_subscriptions: empty
    },
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { ingestStripeInvoice, StripeReconcileError } from '../../services/billing/reconciliation/stripeReconciler';

const PAYLOAD = { balance_transactions: [
  { id: 'txn_1', type: 'charge', source: 'ch_1', amount: 1000, fee: 59, created: '2026-10-05T00:00:00Z', currency: 'usd' },
  { id: 'txn_2', type: 'charge', source: 'ch_2', amount: 2000, fee: 88, created: '2026-10-06T00:00:00Z', currency: 'usd' },
] };
const ARGS = { providerInvoiceId: 'stripe-2026-10', periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', kind: 'balance' as const, payload: PAYLOAD };
const runs = () => db.cost_reconciliation_runs ?? [];
const adjustments = () => db.cost_reconciliation_adjustments ?? [];

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  mockImportInsertError = null; mockAdjInsertError = null; mockRunSeq = 0;
});

it('a fresh import reconciles: run written running -> completed, adjustments in, provider_invoice_id recorded', async () => {
  const out = await ingestStripeInvoice(ARGS);
  expect(out.status).toBe('ingested');
  expect(runs()).toHaveLength(1);
  expect(runs()[0]).toMatchObject({ status: 'completed', metadata: expect.objectContaining({ provider_invoice_id: 'stripe-2026-10' }) });
  expect(adjustments().length).toBeGreaterThan(0); // two Stripe charges with no internal record -> adjustments
});

it('the same import AGAIN after completion -> duplicate (no second run, no second adjustments)', async () => {
  await ingestStripeInvoice(ARGS);
  const n = adjustments().length;
  expect(await ingestStripeInvoice(ARGS)).toEqual({ status: 'duplicate', provider_invoice_id: 'stripe-2026-10' });
  expect(adjustments()).toHaveLength(n);
});

it('a HALF-WRITTEN run (import landed, adjustments insert failed) is RESUMED and completed - never reported as duplicate', async () => {
  mockAdjInsertError = { code: '08006', message: 'connection lost' };
  await expect(ingestStripeInvoice(ARGS)).rejects.toMatchObject({ code: 'ADJUSTMENTS_INSERT_FAILED', retryable: true });
  expect(runs()[0].status).toBe('running');
  expect(adjustments()).toHaveLength(0);
  mockAdjInsertError = null;
  const out = await ingestStripeInvoice(ARGS);
  expect(out).toMatchObject({ status: 'ingested', resumed: true });
  expect(runs()).toHaveLength(1);
  expect(runs()[0].status).toBe('completed');
  expect(adjustments().length).toBeGreaterThan(0);
});

it('a crash AFTER the adjustments insert (run left running) only completes the run - no second adjustments', async () => {
  await ingestStripeInvoice(ARGS);
  const n = adjustments().length;
  runs()[0].status = 'running'; // the crash happened before completeStripeRun
  const out = await ingestStripeInvoice(ARGS);
  expect(out).toMatchObject({ status: 'ingested', adjustments_written: 0, resumed: true });
  expect(adjustments()).toHaveLength(n);
  expect(runs()[0].status).toBe('completed');
});

it('a non-23505 error whose MESSAGE says "duplicate" is NOT treated as a duplicate (typed, retryable failure)', async () => {
  mockImportInsertError = { code: '57014', message: 'canceling statement: duplicate detection timed out' };
  const err = await ingestStripeInvoice(ARGS).catch((e) => e);
  expect(err).toBeInstanceOf(StripeReconcileError);
  expect(err).toMatchObject({ code: 'IMPORT_FAILED', retryable: true });
  expect(runs()).toHaveLength(0);
});

it('a 23505 with NO stored row of ours is refused (another rule fired) - never adopted', async () => {
  mockImportInsertError = { code: '23505', message: 'duplicate key value violates unique constraint "some_other_uidx"' };
  await expect(ingestStripeInvoice(ARGS)).rejects.toMatchObject({ code: 'IMPORT_CONFLICT_NOT_STORED', retryable: false });
});

it('the same invoice id stored for ANOTHER period is refused', async () => {
  db.provider_invoice_imports = [{ provider: 'stripe', provider_invoice_id: 'stripe-2026-10', period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z', total_actual_usd: 28.53, line_items: [] }];
  await expect(ingestStripeInvoice(ARGS)).rejects.toMatchObject({ code: 'INVOICE_PERIOD_MISMATCH', retryable: false });
});

it('the same invoice id with a DIFFERENT total is refused (the stored import is never silently overridden)', async () => {
  db.provider_invoice_imports = [{ provider: 'stripe', provider_invoice_id: 'stripe-2026-10', period_start: ARGS.periodStart, period_end: ARGS.periodEnd, total_actual_usd: 999, line_items: [] }];
  await expect(ingestStripeInvoice(ARGS)).rejects.toMatchObject({ code: 'INVOICE_PAYLOAD_MISMATCH', retryable: false });
});

it('a period whose run belongs to ANOTHER invoice (or a legacy run) is refused before any import', async () => {
  db.cost_reconciliation_runs = [{ id: 'run-x', provider: 'stripe', period_start: ARGS.periodStart, period_end: ARGS.periodEnd, status: 'completed', metadata: {} }];
  await expect(ingestStripeInvoice(ARGS)).rejects.toMatchObject({ code: 'RUN_CONFLICT', retryable: false });
  expect(db.provider_invoice_imports ?? []).toHaveLength(0);
});
