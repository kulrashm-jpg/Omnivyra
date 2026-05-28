/**
 * Phase 18H — durablePersistenceDiagnostics tests.
 *
 * Pure in-memory aggregator; no I/O. Tests verify that synthesized
 * telemetry events flow into the aggregate snapshot correctly.
 */

import {
  recordEvent,
  markOperationStart,
  getDurablePersistenceSnapshot,
  _resetDurablePersistenceDiagnostics,
  durablePersistenceTelemetrySink,
} from '../../services/orchestration/persistence/durablePersistenceDiagnostics';

beforeEach(() => { _resetDurablePersistenceDiagnostics(); });

describe('durablePersistenceDiagnostics — counters', () => {
  test('execution_store_write_success increments totals + latency when inflight marked', async () => {
    markOperationStart('createExecution', 'exec_1');
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('execution_store_write_success', { operation: 'createExecution', attempt: 0, executionId: 'exec_1' });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.totalOperations).toBe(1);
    expect(snap.executionWriteLatency.count).toBe(1);
    expect(snap.executionWriteLatency.lastMs).toBeGreaterThanOrEqual(1);
  });

  test('failure event increments failures + errorsByCode', () => {
    recordEvent('execution_store_write_failure', {
      operation: 'updateExecution', attempt: 1, code: '23514', error: 'check constraint',
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.totalOperations).toBe(1);
    expect(snap.failedOperations).toBe(1);
    expect(snap.errorsByCode['23514']).toBe(1);
    expect(snap.failuresByOperation['updateExecution']).toBe(1);
  });

  test('serialization failure SQLSTATE 40001/40P01 counted separately', () => {
    recordEvent('execution_store_write_failure', { operation: 'x', code: '40001' });
    recordEvent('checkpoint_store_write_failure', { operation: 'y', code: '40P01' });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.serializationFailures).toBe(2);
  });

  test('lease_acquire_failure with reason=ALREADY_ACTIVE counted as contention, NOT failure', () => {
    recordEvent('lease_acquire_failure', { operation: 'acquireLease', reason: 'ALREADY_ACTIVE' });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.contentionEvents).toBe(1);
    expect(snap.failedOperations).toBe(0);
  });

  test('attempt>0 success increments retriedOperations + retriesByOperation', () => {
    recordEvent('execution_store_write_success', { operation: 'createExecution', attempt: 2 });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.retriedOperations).toBe(1);
    expect(snap.retriesByOperation['createExecution']).toBe(2);
  });
});

describe('durablePersistenceDiagnostics — write-smoke trend', () => {
  test('write_smoke_test_passed records duration + status', () => {
    recordEvent('write_smoke_test_started', { executionId: '_writesmoke_a' });
    recordEvent('write_smoke_test_passed', {
      executionId: '_writesmoke_a', durationMs: 123, stagesCompleted: ['insert_execution'],
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.lastWriteSmokeStatus).toBe('passed');
    expect(snap.lastWriteSmokeDurationMs).toBe(123);
    expect(snap.writeSmokeLatency.count).toBe(1);
  });

  test('write_smoke_test_failed flips status to failed + tracks failure', () => {
    recordEvent('write_smoke_test_failed', {
      executionId: '_writesmoke_b', stage: 'append_checkpoint', code: 'POST_INSERT_LOOKUP_MISSING',
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.lastWriteSmokeStatus).toBe('failed');
    expect(snap.failedOperations).toBe(1);
    expect(snap.failuresByOperation['write_smoke']).toBe(1);
    expect(snap.errorsByCode['POST_INSERT_LOOKUP_MISSING']).toBe(1);
  });
});

describe('durablePersistenceDiagnostics — bootstrap history', () => {
  test('persistence_bootstrap_complete is recorded as history entry', () => {
    recordEvent('persistence_bootstrap_complete', {
      processKind: 'nextjs_server',
      smokeTestPassed: true,
      writeSmokeTestPassed: true,
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.bootstrapHistory).toHaveLength(1);
    expect(snap.bootstrapHistory[0].failed).toBe(false);
    expect(snap.bootstrapFailuresInWindow).toBe(0);
  });

  test('registration_failed produces a failed history entry', () => {
    recordEvent('runtime_execution_store_registration_failed', {
      processKind: 'worker', reason: 'connection refused',
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.bootstrapHistory).toHaveLength(1);
    expect(snap.bootstrapHistory[0].failed).toBe(true);
    expect(snap.bootstrapHistory[0].reason).toBe('connection refused');
    expect(snap.bootstrapFailuresInWindow).toBe(1);
  });

  test('writeSmokeTestPassed=false marks bootstrap as failed', () => {
    recordEvent('persistence_bootstrap_complete', {
      processKind: 'cron', smokeTestPassed: true, writeSmokeTestPassed: false,
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.bootstrapHistory[0].failed).toBe(true);
    expect(snap.bootstrapFailuresInWindow).toBe(1);
  });
});

describe('durablePersistenceDiagnostics — telemetry sink integration', () => {
  test('durablePersistenceTelemetrySink.emit() routes to recordEvent', () => {
    durablePersistenceTelemetrySink.emit('checkpoint_store_write_success', {
      operation: 'appendCheckpoint', attempt: 0,
    });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.totalOperations).toBe(1);
  });

  test('unknown events are silently ignored', () => {
    recordEvent('some_unrelated_event', { foo: 'bar' });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.totalOperations).toBe(0);
  });
});

describe('durablePersistenceDiagnostics — latency aggregation', () => {
  test('lease acquire latency reflects inflight markings', async () => {
    markOperationStart('acquireLease', 'lease_1');
    await new Promise((r) => setTimeout(r, 10));
    recordEvent('lease_acquire_success', { operation: 'acquireLease', leaseId: 'lease_1', attempt: 0 });
    const snap = getDurablePersistenceSnapshot();
    expect(snap.leaseAcquireLatency.count).toBe(1);
    expect(snap.leaseAcquireLatency.p50Ms).toBeGreaterThanOrEqual(1);
  });

  test('snapshot reset clears all state', () => {
    recordEvent('execution_store_write_success', { operation: 'x', attempt: 0 });
    _resetDurablePersistenceDiagnostics();
    const snap = getDurablePersistenceSnapshot();
    expect(snap.totalOperations).toBe(0);
    expect(snap.executionWriteLatency.count).toBe(0);
  });
});
