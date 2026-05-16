/**
 * apiIdempotencyKeyCleaner — unit test
 *
 * Verifies the stale-'processing' row cleaner used by the idempotency expiry
 * cron. Critical paths:
 *   - dry-run reports stale rows without mutating
 *   - non-dry-run transitions to 'failed' with audit-able last_error
 *   - status='processing' guard on the UPDATE prevents overwriting rows that
 *     completed mid-scan
 *   - counters + anomaly emission fire only on real cleanup
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(),
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({
  emitAnomaly: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';
import { cleanStaleApiIdempotencyKeys } from '../../services/billing/idempotency/apiIdempotencyKeyCleaner';
import {
  _resetBillingMetricsForTests,
  getCounter,
} from '../../services/billing/billingMetrics';
import { emitAnomaly } from '../../services/billing/billingAuditEmitter';

type AnyMock = jest.Mock;

function stubScan(rows: Array<{ id: string; scope: string; idempotency_key: string; locked_at: string | null; updated_at: string | null; request_id: string | null }>) {
  (supabase.from as AnyMock).mockReturnValue({
    select: () => ({
      eq: () => ({
        or: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  });
}

function stubUpdate(success: boolean) {
  (ownedDbTable as AnyMock).mockReturnValue({
    update: () => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve(success
              ? { data: { id: 'row-1' }, error: null }
              : { data: null, error: null }),
          }),
        }),
      }),
    }),
  });
}

describe('cleanStaleApiIdempotencyKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetBillingMetricsForTests();
  });

  it('returns 0 when no stale rows exist', async () => {
    stubScan([]);
    const r = await cleanStaleApiIdempotencyKeys();
    expect(r.scanned).toBe(0);
    expect(r.cleaned).toBe(0);
    expect(r.errors).toBe(0);
    expect(emitAnomaly).not.toHaveBeenCalled();
  });

  it('dry-run reports rows without mutating', async () => {
    stubScan([
      { id: 'row-1', scope: 'admin-credits-grant', idempotency_key: 'grant-abc', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r1' },
      { id: 'row-2', scope: 'admin-credits-grant', idempotency_key: 'grant-def', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r2' },
    ]);
    const r = await cleanStaleApiIdempotencyKeys({ dryRun: true });
    expect(r.scanned).toBe(2);
    expect(r.cleaned).toBe(0);
    expect(r.staleKeys).toHaveLength(2);
    expect(ownedDbTable).not.toHaveBeenCalled();
    expect(getCounter('stale_operation_recovered_total')).toBe(0);
  });

  it('transitions stale rows to failed and bumps counters', async () => {
    stubScan([
      { id: 'row-1', scope: 'admin-credits-grant', idempotency_key: 'grant-abc', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r1' },
      { id: 'row-2', scope: 'admin-credits-grant', idempotency_key: 'grant-def', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r2' },
    ]);
    stubUpdate(true);

    const r = await cleanStaleApiIdempotencyKeys();
    expect(r.scanned).toBe(2);
    expect(r.cleaned).toBe(2);
    expect(r.errors).toBe(0);

    expect(getCounter('stale_operation_recovered_total')).toBe(2);
    expect(getCounter('idempotency_expired_total')).toBe(2);
    expect(getCounter('recovery_action_total')).toBe(2);
    expect(emitAnomaly).toHaveBeenCalledTimes(1);
  });

  it('counts row that transitioned mid-scan as "not cleaned, not error"', async () => {
    stubScan([
      { id: 'row-1', scope: 'admin-credits-grant', idempotency_key: 'grant-abc', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r1' },
    ]);
    // Update returns no row → status no longer 'processing' (raced)
    stubUpdate(false);

    const r = await cleanStaleApiIdempotencyKeys();
    expect(r.scanned).toBe(1);
    expect(r.cleaned).toBe(0);
    expect(r.errors).toBe(0);
    // No counter bump because nothing was actually cleaned.
    expect(getCounter('stale_operation_recovered_total')).toBe(0);
    expect(emitAnomaly).not.toHaveBeenCalled();
  });

  it('counts UPDATE errors and continues processing', async () => {
    stubScan([
      { id: 'row-1', scope: 'admin-credits-grant', idempotency_key: 'grant-abc', locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: 'r1' },
    ]);
    (ownedDbTable as AnyMock).mockReturnValue({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'db down' } }),
            }),
          }),
        }),
      }),
    });

    const r = await cleanStaleApiIdempotencyKeys();
    expect(r.errors).toBe(1);
    expect(r.cleaned).toBe(0);
  });

  it('emits critical severity when cleaning > 50 rows', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `row-${i}`, scope: 'admin-credits-grant', idempotency_key: `grant-${i}`,
      locked_at: '2024-01-01T00:00:00Z', updated_at: null, request_id: `r${i}`,
    }));
    stubScan(rows);
    stubUpdate(true);

    await cleanStaleApiIdempotencyKeys();
    expect(emitAnomaly).toHaveBeenCalledTimes(1);
    const call = (emitAnomaly as AnyMock).mock.calls[0][0];
    expect(call.severity).toBe('critical');
  });
});
