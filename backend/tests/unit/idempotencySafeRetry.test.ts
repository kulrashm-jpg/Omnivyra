/**
 * safeRetryOperation + runReconciliationAfterRecovery — unit tests
 *
 * The safety contract (NEVER re-run a completed financial mutation) is the
 * point of this suite:
 *   - COMPLETED settlement (CONFIRM/GRANT row) → REFUSE with COMPLETED_SETTLEMENT
 *   - Active HOLD with no sibling → REFUSE with ACTIVE_RESERVATION
 *   - Terminal stuck row → REFUSE with NOT_RECOVERABLE
 *   - Clean state → supersede + mint new key + lineage
 *   - reconciliation-after-recovery: consistent vs drift verdict
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/adminAuditService', () => ({
  recordAdminAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({
  emitAnomaly:        jest.fn(),
  emitFinancialAudit: jest.fn().mockResolvedValue(undefined),
}));

import { supabase } from '../../db/supabaseClient';
import {
  safeRetryOperation,
  runReconciliationAfterRecovery,
} from '../../services/billing/idempotency/idempotencyRecoveryService';
import {
  _resetBillingMetricsForTests,
  getCounter,
} from '../../services/billing/billingMetrics';
import { emitAnomaly } from '../../services/billing/billingAuditEmitter';

type AnyMock = jest.Mock;

/**
 * Configurable supabase mock. `plan` maps a logical step to a result.
 * Steps consumed in order by safeRetryOperation:
 *   1. readIdempotencyKey      → billing_operations.maybeSingle → { idempotency_key }
 *   2. settled lookup          → credit_transactions.limit (confirm/grant)
 *   3. checkFinancialDrift HOLD → credit_transactions.limit (hold)
 *   4. (if HOLD) sibling lookup → credit_transactions.limit
 *   5. readCurrent             → billing_operations.maybeSingle → { status, organization_id }
 *   6. applyStatusUpdate       → billing_operations.update().eq()
 */
function mockSupabase(opts: {
  idempotencyKey?: string | null;
  settledRows?: Array<{ id: string; execution_phase: string }>;
  holdRows?: Array<{ id: string }>;
  siblingRows?: Array<{ id: string; execution_phase: string }>;
  currentRow?: { status: string; organization_id: string | null } | null;
  updateOk?: boolean;
}) {
  // credit_transactions.limit is called in a deterministic order across the
  // safeRetry flow:
  //   call 1 → settled lookup (confirm/grant)
  //   call 2 → checkFinancialDrift HOLD lookup
  //   call 3 → checkFinancialDrift sibling lookup
  // billing_operations.maybeSingle returns a row carrying BOTH idempotency_key
  // AND status/organization_id so readIdempotencyKey() and readCurrent()
  // each pick the field they need regardless of call order.
  let ctLimitCall = 0;
  (supabase.from as AnyMock).mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      in:     () => chain,
      lt:     () => chain,
      order:  () => chain,
      limit:  () => {
        if (table === 'credit_transactions') {
          ctLimitCall++;
          if (ctLimitCall === 1) return Promise.resolve({ data: opts.settledRows ?? [], error: null });
          if (ctLimitCall === 2) return Promise.resolve({ data: opts.holdRows ?? [], error: null });
          return Promise.resolve({ data: opts.siblingRows ?? [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      maybeSingle: () => {
        if (table === 'billing_operations') {
          if (opts.idempotencyKey === null) {
            return Promise.resolve({ data: null, error: null });
          }
          const cur = opts.currentRow ?? { status: 'initiated', organization_id: 'org-1' };
          return Promise.resolve({
            data: { idempotency_key: opts.idempotencyKey ?? 'key-x', ...cur },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: () => ({ eq: () => Promise.resolve({ error: opts.updateOk === false ? { message: 'update failed' } : null }) }),
    };
    return chain;
  });
}

describe('safeRetryOperation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetBillingMetricsForTests();
  });

  it('requires a reason', async () => {
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'a', reason: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REASON_REQUIRED');
  });

  it('REFUSES when a completed CONFIRM settlement exists (replay protection)', async () => {
    mockSupabase({ idempotencyKey: 'key-x', settledRows: [{ id: 't1', execution_phase: 'confirm' }] });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'a', reason: 'stuck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('COMPLETED_SETTLEMENT');
  });

  it('REFUSES when a completed GRANT settlement exists', async () => {
    mockSupabase({ idempotencyKey: 'key-x', settledRows: [{ id: 't1', execution_phase: 'grant' }] });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'a', reason: 'stuck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('COMPLETED_SETTLEMENT');
  });

  it('REFUSES when an active HOLD exists with no sibling (drift)', async () => {
    mockSupabase({
      idempotencyKey: 'key-x',
      settledRows: [],
      holdRows: [{ id: 'hold-1' }],
      siblingRows: [],
    });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'a', reason: 'stuck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ACTIVE_RESERVATION');
  });

  it('REFUSES when the stuck row is already terminal', async () => {
    mockSupabase({
      idempotencyKey: 'key-x',
      settledRows: [],
      holdRows: [],
      currentRow: { status: 'confirmed', organization_id: 'org-1' },  // terminal → COMPLETED
    });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'a', reason: 'stuck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_RECOVERABLE');
  });

  it('SUCCEEDS on clean state — supersedes + mints a new key + lineage', async () => {
    mockSupabase({
      idempotencyKey: 'key-x',
      settledRows: [],
      holdRows: [],          // no HOLD → drift = ok
      currentRow: { status: 'initiated', organization_id: 'org-1' },
      updateOk: true,
    });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'admin-1', reason: 'stuck 30 min' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newIdempotencyKey).toMatch(/^retry:key-x:/);
      expect(r.retryLineageId).toBeTruthy();
      expect(r.originalId).toBe('op-1');
    }
    expect(getCounter('recovery_retry_total')).toBe(1);
    expect(getCounter('manual_recovery_actions_total')).toBe(1);
  });

  it('system actor increments the auto-recovered counter, not manual', async () => {
    mockSupabase({
      idempotencyKey: 'key-x', settledRows: [], holdRows: [],
      currentRow: { status: 'initiated', organization_id: 'org-1' }, updateOk: true,
    });
    const r = await safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'system:cron', reason: 'auto' });
    expect(r.ok).toBe(true);
    expect(getCounter('stale_operation_auto_recovered_total')).toBe(1);
    expect(getCounter('manual_recovery_actions_total')).toBe(0);
  });
});

describe('runReconciliationAfterRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetBillingMetricsForTests();
  });

  it('skips for approvals (no financial state)', async () => {
    const r = await runReconciliationAfterRecovery({
      surface: 'credit_action_approvals', id: 'a-1', organizationId: 'o', actorUserId: 'sys',
    });
    expect(r.verdict).toBe('skipped');
    expect(getCounter('reconciliation_after_recovery_total')).toBe(1);
  });

  /**
   * Standalone `runReconciliationAfterRecovery` only calls `checkFinancialDrift`,
   * which issues credit_transactions.limit twice (HOLD lookup, then sibling
   * lookup) — there is NO preceding settled-lookup like in safeRetry. So this
   * dedicated mock maps: ct.limit call 1 → HOLD, call 2 → sibling.
   */
  function mockDriftOnly(holdRows: Array<{ id: string }>, siblingRows: Array<{ id: string; execution_phase: string }>) {
    let ct = 0;
    (supabase.from as AnyMock).mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        limit:  () => {
          if (table === 'credit_transactions') {
            ct++;
            return Promise.resolve({ data: ct === 1 ? holdRows : siblingRows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: () => Promise.resolve({
          data: table === 'billing_operations'
            ? { idempotency_key: 'key-x', status: 'error', organization_id: 'o' }
            : null,
          error: null,
        }),
      };
      return chain;
    });
  }

  it('returns consistent when no drift', async () => {
    mockDriftOnly([], []);  // no HOLD → no drift
    const r = await runReconciliationAfterRecovery({
      surface: 'billing_operations', id: 'op-1', organizationId: 'o', actorUserId: 'sys',
    });
    expect(r.verdict).toBe('consistent');
  });

  it('raises CRITICAL anomaly + drift verdict when HOLD has no sibling', async () => {
    mockDriftOnly([{ id: 'hold-1' }], []);  // HOLD exists, no sibling → drift
    const r = await runReconciliationAfterRecovery({
      surface: 'billing_operations', id: 'op-1', organizationId: 'o', actorUserId: 'sys',
    });
    expect(r.verdict).toBe('drift');
    const criticalCall = (emitAnomaly as AnyMock).mock.calls.find(c => c[0].severity === 'critical');
    expect(criticalCall).toBeTruthy();
    expect(criticalCall[0].metadata.requires_manual_review).toBe(true);
  });
});
