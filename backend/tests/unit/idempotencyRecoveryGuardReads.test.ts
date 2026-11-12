/**
 * MONEY guard (2026-11-12): the reads inside the recovery / safe-retry guards.
 *
 * checkFinancialDrift ("is a HOLD still open?") and safeRetryOperation's
 * settlement check ("has money already moved?") decide whether a retry could
 * charge twice. Every one of their reads used to default to the SAFE-LOOKING
 * answer on error ('ok' / "nothing settled"), so a failed read ALLOWED the
 * retry. The existing suites' mocks could not return an error, so this was
 * never exercised. Now each failed read REFUSES: DRIFT_UNKNOWN /
 * SETTLEMENT_UNKNOWN / READ_FAILED, and nothing is updated.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
type Ctx = { table: string; op: string; filters: Record<string, unknown>; inVals: unknown[][]; cols: string };
let mockFailWhen: ((c: Ctx) => boolean) | null = null;
let mockRows: (c: Ctx) => unknown = () => null;
const mockUpdates: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: jest.fn(),
    from: (table: string) => {
      const ctx: Ctx = { table, op: 'select', filters: {}, inVals: [], cols: '' };
      const b: any = {};
      const result = (): Res => (mockFailWhen?.(ctx) ? { data: null, error: { message: 'connection reset' } } : { data: mockRows(ctx), error: null });
      // the SELECTED COLUMNS tell the two billing_operations reads apart
      b.select = (cols?: string) => { if (ctx.op === 'select') ctx.cols = cols ?? ''; return b; };
      b.eq = (c: string, v: unknown) => { ctx.filters[c] = v; return b; };
      b.in = (c: string, v: unknown[]) => { ctx.filters[c] = v; ctx.inVals.push(v); return b; };
      b.lt = () => b;
      b.limit = () => b;
      b.update = () => { ctx.op = 'update'; mockUpdates.push(table); return b; };
      b.maybeSingle = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn().mockResolvedValue(undefined) }));

import {
  findStuckOperations,
  safeRetryOperation,
  recoverOperation,
  runReconciliationAfterRecovery,
  checkFinancialDrift,
} from '../../services/billing/idempotency/idempotencyRecoveryService';

const isOp = (c: Ctx) => c.table === 'billing_operations';
const isSettled = (c: Ctx) => c.table === 'credit_transactions' && Array.isArray(c.filters.execution_phase) && (c.filters.execution_phase as string[]).includes('grant');
const isHold = (c: Ctx) => c.table === 'credit_transactions' && c.filters.execution_phase === 'hold';
const isSibling = (c: Ctx) => c.table === 'credit_transactions' && 'parent_transaction_id' in c.filters;

beforeEach(() => {
  mockFailWhen = null;
  mockUpdates.length = 0;
  // a stuck, unsettled operation with an OPEN hold-free history
  mockRows = (c) => {
    if (isOp(c)) return { idempotency_key: 'op-1', status: 'held', organization_id: 'o1' };
    if (c.table === 'credit_transactions') return [];
    return null;
  };
});

const RETRY = { surface: 'billing_operations' as const, id: 'b1', actorUserId: 'admin', reason: 'ops' };

describe('checkFinancialDrift', () => {
  it.each([
    ['idempotency key', isOp],
    ['hold', isHold],
  ])('%s read error -> "unknown", never "ok"', async (_l, pred) => {
    mockFailWhen = pred;
    await expect(checkFinancialDrift('billing_operations', 'b1')).resolves.toBe('unknown');
  });
  it('sibling read error (a HOLD exists) -> "unknown", never "ok"', async () => {
    mockRows = (c) => (isOp(c) ? { idempotency_key: 'op-1' } : isHold(c) ? [{ id: 'h1' }] : []);
    mockFailWhen = isSibling;
    await expect(checkFinancialDrift('billing_operations', 'b1')).resolves.toBe('unknown');
  });
  it('control: clean reads with no hold -> "ok"', async () => {
    await expect(checkFinancialDrift('billing_operations', 'b1')).resolves.toBe('ok');
  });
  // 20270217000023: a hold settled ONLY by a partial confirm (fully consumed, no
  // remainder row) is settled - the sibling read must include 'confirm_partial'.
  // The fake applies the phase filter: the child is returned only if asked for.
  it("a hold settled by a PARTIAL confirm is not drift (the sibling read asks for 'confirm_partial')", async () => {
    mockRows = (c) => (isOp(c) ? { idempotency_key: 'op-1' } : isHold(c) ? [{ id: 'h1' }]
      : isSibling(c) && (c.filters.execution_phase as string[]).includes('confirm_partial') ? [{ id: 'p1', execution_phase: 'confirm_partial' }] : []);
    await expect(checkFinancialDrift('billing_operations', 'b1')).resolves.toBe('ok');
  });
});

describe('safeRetryOperation refuses on every unread guard', () => {
  it('settlement read error -> SETTLEMENT_UNKNOWN (a completed charge may exist), nothing updated', async () => {
    mockFailWhen = isSettled;
    const r = await safeRetryOperation(RETRY as never);
    expect(r).toMatchObject({ ok: false, code: 'SETTLEMENT_UNKNOWN' });
    expect(mockUpdates).toEqual([]);
  });
  it('active-hold read error -> DRIFT_UNKNOWN, nothing updated', async () => {
    mockFailWhen = isHold;
    const r = await safeRetryOperation(RETRY as never);
    expect(r).toMatchObject({ ok: false, code: 'DRIFT_UNKNOWN' });
    expect(mockUpdates).toEqual([]);
  });
  it('idempotency-key read error -> READ_FAILED, nothing updated', async () => {
    mockFailWhen = isOp;
    const r = await safeRetryOperation(RETRY as never);
    expect(r).toMatchObject({ ok: false, code: 'READ_FAILED' });
    expect(mockUpdates).toEqual([]);
  });
});

describe('recoverOperation / reconciliation-after-recovery', () => {
  it('recoverOperation: drift unreadable -> refused DRIFT_UNKNOWN, nothing updated', async () => {
    mockFailWhen = isHold;
    const r = await recoverOperation({ surface: 'billing_operations', id: 'b1', action: 'expire', actorUserId: 'admin', reason: 'ops' } as never);
    expect(r).toMatchObject({ ok: false, error: 'DRIFT_UNKNOWN', driftCheck: 'unknown' });
    expect(mockUpdates).toEqual([]);
  });
  it('reconciliation-after-recovery: unreadable drift is never reported "consistent"', async () => {
    mockFailWhen = isHold;
    const r = await runReconciliationAfterRecovery({ surface: 'billing_operations', id: 'b1', actorUserId: 'admin' } as never);
    expect(r.verdict).toBe('drift');
  });
});

// MUTANT SURVIVORS (2026-11-12): billing_operations is read TWICE by safeRetry
// (idempotency key, then current row) and the old case failed both; the stuck
// scans and the job-registry key read had no case. Each fails ALONE now.
describe('each guard read fails alone', () => {
  it('idempotency-key read ALONE -> READ_FAILED naming that read', async () => {
    mockFailWhen = (c) => isOp(c) && c.cols.includes('idempotency_key');
    const r = await safeRetryOperation(RETRY);
    expect(r).toMatchObject({ ok: false, code: 'READ_FAILED' });
    expect((r as { message: string }).message).toMatch(/idempotency_key read failed/);
    expect(mockUpdates).toEqual([]);
  });
  it('current-row read ALONE -> READ_FAILED naming that read', async () => {
    mockFailWhen = (c) => isOp(c) && c.cols.startsWith('status');
    const r = await safeRetryOperation(RETRY);
    expect(r).toMatchObject({ ok: false, code: 'READ_FAILED' });
    expect((r as { message: string }).message).toMatch(/current-row read failed/);
    expect(mockUpdates).toEqual([]);
  });
  it('job_execution_registry idempotency-key read error -> READ_FAILED', async () => {
    mockFailWhen = (c) => c.table === 'job_execution_registry' && c.cols.includes('idempotency_key');
    const r = await safeRetryOperation({ ...RETRY, surface: 'job_execution_registry' as never });
    expect(r).toMatchObject({ ok: false, code: 'READ_FAILED' });
    expect((r as { message: string }).message).toMatch(/idempotency_key read failed/);
  });
  it.each([
    ['billing_operations', /stuck billing_operations read failed/],
    ['job_execution_registry', /stuck job_execution_registry read failed/],
  ])('stuck scan of %s errors -> THROWS (never "nothing stuck")', async (table, msg) => {
    mockFailWhen = (c) => c.table === table;
    await expect(findStuckOperations({ surfaces: [table as never] } as never)).rejects.toThrow(msg as RegExp);
  });
});
