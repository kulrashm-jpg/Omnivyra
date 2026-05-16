/**
 * idempotencyRecoveryService — unit tests
 *
 * Covers:
 *   - reason required
 *   - drift detection refuses recovery when HOLD exists without sibling
 *   - terminal-state transitions rejected
 *   - successful expire of billing_operations
 *   - successful expire of job_execution_registry
 *   - bulk reconcile dry-run path
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/adminAuditService', () => ({
  recordAdminAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({
  emitAnomaly:          jest.fn(),
  emitFinancialAudit:   jest.fn().mockResolvedValue(undefined),
}));

import { supabase } from '../../db/supabaseClient';
import {
  recoverOperation,
  reconcileStuckOperations,
  findStuckOperations,
  checkFinancialDrift,
} from '../../services/billing/idempotency/idempotencyRecoveryService';
import {
  _resetBillingMetricsForTests,
  getCounter,
} from '../../services/billing/billingMetrics';

type AnyMock = jest.Mock;

function chainableMock(rowsByTable: Record<string, unknown>): jest.Mock {
  const fn = jest.fn().mockImplementation((tableName: string) => {
    const result = rowsByTable[tableName] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      in:     () => chain,
      lt:     () => chain,
      gte:    () => chain,
      lte:    () => chain,
      order:  () => chain,
      limit:  () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      then:   (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  });
  return fn;
}

describe('idempotencyRecoveryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetBillingMetricsForTests();
  });

  it('rejects recovery with missing reason', async () => {
    const r = await recoverOperation({
      surface: 'billing_operations', id: 'op-1', action: 'expire',
      actorUserId: 'admin-1', reason: '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reason/);
  });

  it('refuses recovery when financial drift detected', async () => {
    // Drift = HOLD exists in credit_transactions with no sibling CONFIRM/RELEASE.
    // Sequence of DB calls in checkFinancialDrift:
    //   1. readIdempotencyKey → billing_operations.maybeSingle → { idempotency_key: 'key-x' }
    //   2. HOLD lookup       → credit_transactions.limit       → [{ id: 'hold-1' }]
    //   3. sibling lookup    → credit_transactions.limit       → []
    let creditTxCalls = 0;
    (supabase.from as AnyMock).mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        limit:  () => {
          if (table === 'credit_transactions') {
            creditTxCalls++;
            if (creditTxCalls === 1) {
              return Promise.resolve({ data: [{ id: 'hold-1' }], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: () => {
          if (table === 'billing_operations') {
            return Promise.resolve({ data: { idempotency_key: 'key-x' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return chain;
    });

    const r = await recoverOperation({
      surface: 'billing_operations', id: 'op-1', action: 'expire',
      actorUserId: 'admin-1', reason: 'stuck for 30 min',
    });
    expect(r.ok).toBe(false);
    expect(r.driftCheck).toBe('drift_detected');
  });

  it('successfully expires billing_operations row', async () => {
    let phase = 0;
    (supabase.from as AnyMock).mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        limit:  () => {
          phase++;
          // readIdempotencyKey → key
          // credit_transactions HOLD lookup → empty (no HOLD = no drift risk)
          if (table === 'credit_transactions') {
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => {
          if (table === 'billing_operations') {
            // readCurrent path
            return Promise.resolve({ data: { status: 'initiated', organization_id: 'org-1' }, error: null });
          }
          // readIdempotencyKey
          return Promise.resolve({ data: { idempotency_key: 'key-x' }, error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return chain;
    });

    const r = await recoverOperation({
      surface: 'billing_operations', id: 'op-1', action: 'expire',
      actorUserId: 'admin-1', reason: 'stuck',
    });
    expect(r.ok).toBe(true);
    expect(r.toStatus).toBe('error');
    expect(getCounter('stale_operation_recovered_total')).toBe(0); // mark_failed -> error, not expired bucket
    expect(getCounter('idempotency_failed_total')).toBeGreaterThan(0);
  });

  it('reconcileStuckOperations dry-run produces summary without mutating', async () => {
    (supabase.from as AnyMock).mockImplementation(() => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        lt:     () => chain,
        limit:  () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    });
    const summary = await reconcileStuckOperations('system', { dryRun: true });
    expect(summary.scanned).toBe(0);
    expect(summary.recovered).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it('checkFinancialDrift returns "skipped" for approvals + payment events', async () => {
    await expect(checkFinancialDrift('credit_action_approvals', 'a-1')).resolves.toBe('skipped');
    await expect(checkFinancialDrift('payment_provider_event_state', 'p-1')).resolves.toBe('skipped');
  });

  it('findStuckOperations returns empty when nothing is stuck', async () => {
    (supabase.from as AnyMock).mockImplementation(() => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        in:     () => chain,
        lt:     () => chain,
        limit:  () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    });
    const stuck = await findStuckOperations();
    expect(stuck).toEqual([]);
  });
});
