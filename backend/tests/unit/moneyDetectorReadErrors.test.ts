/**
 * MONEY DETECTORS (2026-11-12): a detector must never report "all clear" on a
 * scan it could not read, and must not turn a per-row read error into a false
 * anomaly. Top-level scan errors THROW; per-row errors are UNVERIFIABLE.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null; count?: number };
type Ctx = { table: string; filters: Record<string, unknown> };
let mockFailWhen: ((c: Ctx) => boolean) | null = null;
let mockRows: (c: Ctx) => unknown = () => [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const ctx: Ctx = { table, filters: {} };
      const b: any = {};
      const result = (): Res => (mockFailWhen?.(ctx) ? { data: null, error: { message: 'down' }, count: undefined } : { data: mockRows(ctx), error: null, count: 0 });
      for (const m of ['select', 'lt', 'gte', 'lte', 'limit', 'order']) b[m] = () => b;
      b.eq = (c: string, v: unknown) => { ctx.filters[c] = v; return b; };
      b.in = (c: string, v: unknown) => { ctx.filters[c] = v; return b; };
      b.maybeSingle = async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn() }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));

import { runReservationReconciliation } from '../../services/billing/jobs/reservationReconciliationJob';
import { runOrphanUsageReconciliation } from '../../services/billing/jobs/orphanUsageReconciliationJob';
import { emitAnomaly } from '../../services/billing/billingAuditEmitter';

beforeEach(() => { mockFailWhen = null; mockRows = () => []; (emitAnomaly as jest.Mock).mockClear(); });

describe('reservation reconciliation', () => {
  it.each([
    ['expired-hold scan', (c: Ctx) => c.table === 'credit_transactions' && c.filters.execution_phase === 'hold'],
    ['confirmed-ops scan', (c: Ctx) => c.table === 'billing_operations' && c.filters.status === 'confirmed'],
    ['stuck-ops scan', (c: Ctx) => c.table === 'billing_operations' && Array.isArray(c.filters.status)],
  ])('%s error THROWS (never an all-clear)', async (_l, pred) => {
    mockFailWhen = pred;
    await expect(runReservationReconciliation()).rejects.toThrow(/scan failed/);
  });

  it('per-row sibling read error -> UNVERIFIABLE, never counted as an orphan hold', async () => {
    mockRows = (c) => (c.table === 'credit_transactions' && c.filters.execution_phase === 'hold' ? [{ id: 'h1', organization_id: 'o1', idempotency_key: 'k:hold' }] : []);
    mockFailWhen = (c) => c.table === 'credit_transactions' && 'parent_transaction_id' in c.filters;
    const r = await runReservationReconciliation();
    expect(r.expiredHoldsAwaitingReap).toBe(0);
    expect(r.unverifiable).toBe(1);
  });

  it('per-row ledger read error -> UNVERIFIABLE, never a false CRITICAL mismatch', async () => {
    mockRows = (c) => (c.table === 'billing_operations' && c.filters.status === 'confirmed' ? [{ id: 'op1', idempotency_key: 'k', confirm_txn_id: null }] : []);
    mockFailWhen = (c) => c.table === 'credit_transactions' && c.filters.idempotency_key === 'k:confirm';
    const r = await runReservationReconciliation();
    expect(r.bookKeepingMismatches).toBe(0);
    expect(r.unverifiable).toBe(1);
  });
});

describe('orphan usage reconciliation', () => {
  it('usage_events scan error THROWS (never "0 orphans")', async () => {
    mockFailWhen = (c) => c.table === 'usage_events';
    await expect(runOrphanUsageReconciliation()).rejects.toThrow();
  });

  it('per-event match error -> not counted as an orphan', async () => {
    mockRows = (c) => (c.table === 'usage_events' ? [{ id: 'e1', organization_id: 'o1', operation: 'x', cost_usd: 1, created_at: new Date().toISOString() }] : []);
    mockFailWhen = (c) => c.table === 'credit_transactions';
    const r = await runOrphanUsageReconciliation();
    expect(r.orphanCount).toBe(0);
  });
});
