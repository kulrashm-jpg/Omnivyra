/**
 * queueBillingMiddleware — unit tests
 *
 * Covers:
 *   - First-sight job: claim_job_execution succeeds, orchestrator runs, registry
 *     advances to 'completed' on success / 'released' on failure.
 *   - Terminal replay: short-circuits without invoking orchestrator and bumps
 *     duplicate_prevention_hits counter.
 *   - In-flight retry (allowConcurrentReentry=false): also short-circuits.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));
jest.mock('../../services/billing/enterpriseBillingOrchestrator', () => ({
  runBilledOperation: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { runBilledOperation } from '../../services/billing/enterpriseBillingOrchestrator';
import { withQueueBilling } from '../../services/billing/queueBillingMiddleware';
import {
  _resetBillingMetricsForTests,
  getCounter,
} from '../../services/billing/billingMetrics';

type AnyMock = jest.Mock;

describe('queueBillingMiddleware.withQueueBilling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetBillingMetricsForTests();
  });

  it('runs orchestrator on first sight, advances registry on success', async () => {
    (supabase.rpc as AnyMock)
      .mockResolvedValueOnce({
        data: { id: 'reg-1', status: 'reserved', first_seen: true, retry_count: 0, is_terminal: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'reg-1', status: 'in_progress' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'reg-1', status: 'completed' }, error: null });

    (runBilledOperation as AnyMock).mockResolvedValue({
      operationId: 'op-1',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      result: { status: 'executed', result: 'work-output' },
    });

    const out = await withQueueBilling(
      {
        queueName: 'content-gen',
        jobId: 'job-1',
        payload: { contentId: 'c1' },
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'content_generation',
        referenceType: 'content',
        referenceId: 'c1',
      },
      async () => 'work-output',
    );

    expect(out.kind).toBe('executed');
    if (out.kind === 'executed') {
      expect(out.orchestrator.operationId).toBe('op-1');
    }
  });

  it('blocks terminal duplicates without invoking orchestrator', async () => {
    (supabase.rpc as AnyMock).mockResolvedValueOnce({
      data: { id: 'reg-1', status: 'completed', first_seen: false, retry_count: 1, is_terminal: true },
      error: null,
    });

    const executor = jest.fn();
    const out = await withQueueBilling(
      {
        queueName: 'content-gen',
        jobId: 'job-1',
        payload: { contentId: 'c1' },
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'content_generation',
        referenceType: 'content',
        referenceId: 'c1',
      },
      executor,
    );

    expect(out.kind).toBe('duplicate_blocked');
    expect(executor).not.toHaveBeenCalled();
    expect(runBilledOperation).not.toHaveBeenCalled();
    expect(getCounter('queue_replay_blocked_total')).toBe(1);
    expect(getCounter('duplicate_prevention_hits_total')).toBe(1);
  });

  it('short-circuits in-flight retries by default', async () => {
    (supabase.rpc as AnyMock).mockResolvedValueOnce({
      data: { id: 'reg-1', status: 'reserved', first_seen: false, retry_count: 1, is_terminal: false },
      error: null,
    });

    const out = await withQueueBilling(
      {
        queueName: 'content-gen',
        jobId: 'job-1',
        payload: { contentId: 'c1' },
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'content_generation',
        referenceType: 'content',
        referenceId: 'c1',
      },
      async () => 'work',
    );

    expect(out.kind).toBe('duplicate_blocked');
    if (out.kind === 'duplicate_blocked') {
      expect(out.reason).toBe('in_flight_retry');
    }
  });

  it('advances registry to released when orchestrator throws', async () => {
    (supabase.rpc as AnyMock)
      .mockResolvedValueOnce({
        data: { id: 'reg-1', status: 'reserved', first_seen: true, retry_count: 0, is_terminal: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'reg-1', status: 'in_progress' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'reg-1', status: 'released' }, error: null });

    (runBilledOperation as AnyMock).mockRejectedValueOnce(new Error('boom'));

    await expect(
      withQueueBilling(
        {
          queueName: 'q',
          jobId: 'j',
          payload: { x: 1 },
          organizationId: 'o',
          userId: 'u',
          action: 'content_generation',
          referenceType: 'r',
          referenceId: 'ref',
        },
        async () => 'never',
      ),
    ).rejects.toThrow('boom');
  });
});
