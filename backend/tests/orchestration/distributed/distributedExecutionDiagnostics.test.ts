/**
 * Phase 20H — distributedExecutionDiagnostics tests.
 */

import {
  recordEvent,
  setQueueDepth,
  getDistributedExecutionSnapshot,
  _resetDistributedExecutionDiagnostics,
  distributedExecutionTelemetrySink,
} from '../../../services/orchestration/distributed/distributedExecutionDiagnostics';

beforeEach(() => { _resetDistributedExecutionDiagnostics(); });

describe('distributedExecutionDiagnostics — counters', () => {
  test('enqueue → completion records latency', async () => {
    recordEvent('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('execution_completed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    const s = getDistributedExecutionSnapshot();
    expect(s.queueEnqueued).toBe(1);
    expect(s.queueCompleted).toBe(1);
    expect(s.queueLatency.count).toBe(1);
    expect(s.queueLatency.lastMs).toBeGreaterThanOrEqual(1);
  });

  test('claim race contentions bump on refused + dedup', () => {
    recordEvent('ownership_claim_refused', { workerId: 'w' });
    recordEvent('execution_dedup_suppressed', { dedupKey: 'k' });
    const s = getDistributedExecutionSnapshot();
    expect(s.claimRaceContentions).toBe(2);
  });

  test('worker registered + offline + stale tracked', () => {
    recordEvent('worker_registered', { workerId: 'w' });
    expect(getDistributedExecutionSnapshot().workersActive).toBe(1);
    recordEvent('worker_marked_stale', { workerId: 'w' });
    expect(getDistributedExecutionSnapshot().workersStale).toBe(1);
    recordEvent('worker_status_changed', { workerId: 'w', previous: 'active', current: 'stale' });
    expect(getDistributedExecutionSnapshot().workersActive).toBe(0);
  });

  test('throughput backpressure events counted', () => {
    recordEvent('throughput_backpressure_applied', { signal: 'queue_depth_high' });
    recordEvent('throughput_backpressure_applied', { signal: 'concurrency_saturated' });
    const s = getDistributedExecutionSnapshot();
    expect(s.throughputThrottlingEvents).toBe(2);
  });

  test('recovery scheduling pressure events counted', () => {
    recordEvent('recovery_scheduling_pressure', { reason: 'concurrent_cap_reached' });
    expect(getDistributedExecutionSnapshot().recoverySchedulingPressureEvents).toBe(1);
  });
});

describe('distributedExecutionDiagnostics — timelines', () => {
  test('ownership_transfer_succeeded recorded as forensic entry', () => {
    recordEvent('ownership_transfer_succeeded', {
      executionId: 'e1', previousOwnerId: 'w_old', newOwnerId: 'w_new', reason: 'lease_takeover',
    });
    const s = getDistributedExecutionSnapshot();
    expect(s.ownershipTransfers).toHaveLength(1);
    expect(s.ownershipTransfers[0].fromWorkerId).toBe('w_old');
    expect(s.ownershipTransfers[0].toWorkerId).toBe('w_new');
  });

  test('queue lifecycle events accumulate in order', () => {
    recordEvent('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    recordEvent('execution_claimed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    recordEvent('execution_completed', { queueEntryId: 'qe', executionId: 'e', workerId: 'w' });
    const s = getDistributedExecutionSnapshot();
    expect(s.queueLifecycleEvents.map((e) => e.event)).toEqual(['enqueued', 'claimed', 'completed']);
  });

  test('replay_continuation events feed the chain', () => {
    recordEvent('replay_continuation_success', {
      executionId: 'e', outcome: 'resumed', durationMs: 42,
    });
    const s = getDistributedExecutionSnapshot();
    expect(s.replayContinuationsTriggered).toBe(1);
    expect(s.replayContinuationChain).toHaveLength(1);
    expect(s.replayContinuationChain[0].outcome).toBe('resumed');
  });

  test('recovery_scheduled/throttled feed the recovery chain', () => {
    recordEvent('recovery_scheduled', { executionId: 'e1', reason: 'abandoned_marker' });
    recordEvent('recovery_throttled', { executionId: 'e2', reason: 'per_call_cap_reached' });
    const s = getDistributedExecutionSnapshot();
    expect(s.recoverySchedulingChain).toHaveLength(2);
    expect(s.recoverySchedulingChain[0].scheduled).toBe(true);
    expect(s.recoverySchedulingChain[1].scheduled).toBe(false);
  });
});

describe('distributedExecutionDiagnostics — sink + depth', () => {
  test('telemetry sink emit routes to recordEvent', () => {
    distributedExecutionTelemetrySink.emit('execution_enqueued', { queueEntryId: 'qe', executionId: 'e' });
    expect(getDistributedExecutionSnapshot().queueEnqueued).toBe(1);
  });

  test('setQueueDepth surfaces in snapshot', () => {
    setQueueDepth(42);
    expect(getDistributedExecutionSnapshot().queueDepthCurrent).toBe(42);
  });

  test('unknown events ignored', () => {
    recordEvent('bogus_event', { foo: 'bar' });
    expect(getDistributedExecutionSnapshot().queueEnqueued).toBe(0);
  });
});
