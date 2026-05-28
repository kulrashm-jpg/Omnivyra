/**
 * Phase 19H — durableRecoveryDiagnostics aggregator tests.
 */

import {
  recordEvent,
  getDurableRecoverySnapshot,
  _resetDurableRecoveryDiagnostics,
  durableRecoveryTelemetrySink,
} from '../../../services/orchestration/recovery/durableRecoveryDiagnostics';

beforeEach(() => { _resetDurableRecoveryDiagnostics(); });

describe('durableRecoveryDiagnostics — counters', () => {
  test('recovery_coordinator_start increments attempts', () => {
    recordEvent('recovery_coordinator_start', { executionId: 'e1', workerId: 'w' });
    const s = getDurableRecoverySnapshot();
    expect(s.recoveryAttempts).toBe(1);
    expect(s.recoverySuccesses).toBe(0);
    expect(s.recoveryFailures).toBe(0);
  });

  test('success bumps successes + records outcome', () => {
    recordEvent('recovery_coordinator_start', { executionId: 'e1' });
    recordEvent('recovery_coordinator_success', { executionId: 'e1', status: 'recovered', durationMs: 50 });
    const s = getDurableRecoverySnapshot();
    expect(s.recoverySuccesses).toBe(1);
    expect(s.recoverySuccessRate).toBeCloseTo(1);
    expect(s.recentRecoveryOutcomes[0].outcome).toBe('succeeded');
  });

  test('failure bumps failures + records code', () => {
    recordEvent('recovery_coordinator_start', { executionId: 'e1' });
    recordEvent('recovery_coordinator_failure', {
      executionId: 'e1', code: 'BOOM', reason: 'kaboom', durationMs: 7,
    });
    const s = getDurableRecoverySnapshot();
    expect(s.recoveryFailures).toBe(1);
    expect(s.recoveryFailuresByCode['BOOM']).toBe(1);
    expect(s.recentRecoveryOutcomes[0].outcome).toBe('failed');
  });
});

describe('durableRecoveryDiagnostics — latency aggregates', () => {
  test('checkpoint_restore_success samples are aggregated', () => {
    recordEvent('checkpoint_restore_success', { executionId: 'e', durationMs: 10 });
    recordEvent('checkpoint_restore_success', { executionId: 'e', durationMs: 20 });
    const s = getDurableRecoverySnapshot();
    expect(s.checkpointRestoreLatency.count).toBe(2);
    expect(s.checkpointRestoreLatency.lastMs).toBe(20);
  });

  test('replay_continuation_success increments duplicateSuppressions when reported', () => {
    recordEvent('replay_continuation_success', {
      executionId: 'e', outcome: 'resumed', durationMs: 30, duplicateSuppressions: 3,
    });
    const s = getDurableRecoverySnapshot();
    expect(s.duplicateSuppressionEvents).toBe(3);
    expect(s.replayContinuationLatency.count).toBe(1);
  });

  test('replay_continuation_duplicate_suppressed bumps individual counter', () => {
    recordEvent('replay_continuation_duplicate_suppressed', { executionId: 'e', stepId: 's' });
    expect(getDurableRecoverySnapshot().duplicateSuppressionEvents).toBe(1);
  });

  test('lease attempt + success records latency', async () => {
    recordEvent('lease_recovery_attempt', { executionId: 'e', operation: 'takeover' });
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('lease_recovery_success', { executionId: 'e', action: 'took_over' });
    const s = getDurableRecoverySnapshot();
    expect(s.leaseRecoveryLatency.count).toBe(1);
    expect(s.leaseTakeoverEvents).toBe(1);
  });
});

describe('durableRecoveryDiagnostics — stale + abandoned tracking', () => {
  test('stale_execution_detected with abandoned_marker increments abandoned counter', () => {
    recordEvent('stale_execution_detected', {
      executionId: 'e', reason: 'abandoned_marker', executionStatus: 'abandoned',
    });
    const s = getDurableRecoverySnapshot();
    expect(s.staleWorkerEvents).toBe(1);
    expect(s.abandonedExecutionEvents).toBe(1);
  });

  test('stale_execution_detected with heartbeat_stale does NOT count as abandoned', () => {
    recordEvent('stale_execution_detected', {
      executionId: 'e', reason: 'heartbeat_stale', executionStatus: 'running',
    });
    const s = getDurableRecoverySnapshot();
    expect(s.staleWorkerEvents).toBe(1);
    expect(s.abandonedExecutionEvents).toBe(0);
  });
});

describe('durableRecoveryDiagnostics — sink integration', () => {
  test('durableRecoveryTelemetrySink.emit routes to recordEvent', () => {
    durableRecoveryTelemetrySink.emit('recovery_coordinator_start', { executionId: 'e' });
    expect(getDurableRecoverySnapshot().recoveryAttempts).toBe(1);
  });

  test('unknown events are ignored', () => {
    recordEvent('not_a_real_event', { foo: 'bar' });
    expect(getDurableRecoverySnapshot().recoveryAttempts).toBe(0);
  });
});
