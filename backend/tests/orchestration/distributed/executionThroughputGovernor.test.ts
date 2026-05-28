/**
 * Phase 20F — ExecutionThroughputGovernor unit tests.
 */

import {
  createExecutionThroughputGovernor,
} from '../../../services/orchestration/distributed/executionThroughputGovernor';

describe('ExecutionThroughputGovernor', () => {
  test('within thresholds → allowed, signal=none', () => {
    const g = createExecutionThroughputGovernor({ telemetry: { emit: () => {} } });
    const d = g.evaluate({
      activeExecutions: 10, queueDepth: 5, workerSaturation: 0.2,
      checkpointPressure: 0.1, retryFrequencyPerMin: 5, recoveryPressure: 0.1,
    });
    expect(d.allowed).toBe(true);
    expect(d.signal).toBe('none');
  });

  test('active execution cap denies', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxActiveExecutions: 4 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 5, queueDepth: 0, workerSaturation: 0.1,
      checkpointPressure: 0.1, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(d.allowed).toBe(false);
    expect(d.signal).toBe('concurrency_saturated');
  });

  test('queue depth cap denies', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxQueueDepth: 10 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 0, queueDepth: 20, workerSaturation: 0,
      checkpointPressure: 0, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(d.allowed).toBe(false);
    expect(d.signal).toBe('queue_depth_high');
  });

  test('worker saturation denies', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxWorkerSaturation: 0.5 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 0, queueDepth: 0, workerSaturation: 0.9,
      checkpointPressure: 0, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(d.allowed).toBe(false);
  });

  test('retry storm denies with retry_storm signal', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxRetriesPerMin: 10 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 0, queueDepth: 0, workerSaturation: 0,
      checkpointPressure: 0, retryFrequencyPerMin: 50, recoveryPressure: 0,
    });
    expect(d.allowed).toBe(false);
    expect(d.signal).toBe('retry_storm');
  });

  test('recovery pressure denies with recovery_pressure signal', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxRecoveryPressure: 0.3 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 0, queueDepth: 0, workerSaturation: 0,
      checkpointPressure: 0, retryFrequencyPerMin: 0, recoveryPressure: 0.6,
    });
    expect(d.allowed).toBe(false);
    expect(d.signal).toBe('recovery_pressure');
  });

  test('checkpoint pressure denies with checkpoint_lag signal', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxCheckpointPressure: 0.4 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 0, queueDepth: 0, workerSaturation: 0,
      checkpointPressure: 0.7, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(d.allowed).toBe(false);
    expect(d.signal).toBe('checkpoint_lag');
  });

  test('retry-after clamped to [0, 60_000]', () => {
    const g = createExecutionThroughputGovernor({
      thresholds: { maxActiveExecutions: 1, defaultRetryAfterMs: 100_000 },
      telemetry: { emit: () => {} },
    });
    const d = g.evaluate({
      activeExecutions: 999, queueDepth: 0, workerSaturation: 0,
      checkpointPressure: 0, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(d.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(d.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  test('evaluateAndAnnounce emits telemetry on backpressure', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const g = createExecutionThroughputGovernor({
      thresholds: { maxActiveExecutions: 2 },
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    });
    g.evaluateAndAnnounce({
      activeExecutions: 5, queueDepth: 0, workerSaturation: 0,
      checkpointPressure: 0, retryFrequencyPerMin: 0, recoveryPressure: 0,
    });
    expect(events.some((e) => e.event === 'throughput_backpressure_applied')).toBe(true);
  });
});
