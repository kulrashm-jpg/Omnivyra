/**
 * Phase 19H — durableRecoveryDiagnostics
 *
 * Passive in-process aggregator for recovery telemetry. Subscribes to:
 *   - checkpoint_restore_success / _failure        (CheckpointRestorationEngine)
 *   - replay_continuation_success / _duplicate_suppressed / _failure
 *                                                  (ReplayContinuationEngine)
 *   - lease_recovery_attempt / _success / _failure (LeaseRecoveryGovernor)
 *   - stale_execution_detected / _reconciled / _skipped (StaleExecutionReconciler)
 *   - recovery_coordinator_start / _success / _failure / _no_op
 *                                                  (ExecutionRecoveryCoordinator)
 *
 * Tracks (per spec):
 *   - recovery success rate
 *   - stale-worker frequency
 *   - checkpoint restoration latency
 *   - replay continuation latency
 *   - duplicate suppression frequency
 *   - recovery failure trends
 *   - abandoned execution trends
 *   - lease takeover frequency
 *
 * SCOPE: pure aggregation. No I/O. No alarming. Snapshot is consumed by
 * /api endpoints + stress harnesses. Memory bounded via SAMPLE_CAP.
 */

import type {
  DurableRecoveryLatencyBucket,
  DurableRecoverySnapshot,
} from './recoveryTypes';

// ── Constants ────────────────────────────────────────────────────────

const SAMPLE_CAP = 256;
const OUTCOMES_CAP = 64;

// ── Sample list helpers ─────────────────────────────────────────────

interface SampleList {
  samples: number[];
  lastMs: number | null;
}

function newSampleList(): SampleList {
  return { samples: [], lastMs: null };
}

function recordSample(list: SampleList, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  list.samples.push(ms);
  if (list.samples.length > SAMPLE_CAP) list.samples.shift();
  list.lastMs = ms;
}

function summarize(list: SampleList): DurableRecoveryLatencyBucket {
  if (list.samples.length === 0) {
    return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...list.samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: list.samples.length,
    lastMs: list.lastMs,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

// ── State ────────────────────────────────────────────────────────────

interface InternalState {
  recoveryAttempts: number;
  recoverySuccesses: number;
  recoveryFailures: number;
  staleWorkerEvents: number;
  abandonedExecutionEvents: number;
  leaseTakeoverEvents: number;
  duplicateSuppressionEvents: number;
  checkpointRestoreLatency: SampleList;
  replayContinuationLatency: SampleList;
  leaseRecoveryLatency: SampleList;
  recoveryFailuresByCode: Map<string, number>;
  recentRecoveryOutcomes: DurableRecoverySnapshot['recentRecoveryOutcomes'];
  /** Track in-flight start timestamps keyed on operation+correlation. */
  inflight: Map<string, number>;
}

function newState(): InternalState {
  return {
    recoveryAttempts: 0,
    recoverySuccesses: 0,
    recoveryFailures: 0,
    staleWorkerEvents: 0,
    abandonedExecutionEvents: 0,
    leaseTakeoverEvents: 0,
    duplicateSuppressionEvents: 0,
    checkpointRestoreLatency: newSampleList(),
    replayContinuationLatency: newSampleList(),
    leaseRecoveryLatency: newSampleList(),
    recoveryFailuresByCode: new Map(),
    recentRecoveryOutcomes: [],
    inflight: new Map(),
  };
}

let _state = newState();

// ── Event ingestion ─────────────────────────────────────────────────

type TelemetryPayload = Record<string, unknown>;

function bump(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function pushOutcome(entry: DurableRecoverySnapshot['recentRecoveryOutcomes'][number]): void {
  _state.recentRecoveryOutcomes.push(entry);
  while (_state.recentRecoveryOutcomes.length > OUTCOMES_CAP) {
    _state.recentRecoveryOutcomes.shift();
  }
}

export function recordEvent(event: string, payload: TelemetryPayload): void {
  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
  const executionId = typeof payload.executionId === 'string' ? payload.executionId : 'unknown';
  const code = typeof payload.code === 'string' ? payload.code : null;

  switch (event) {
    case 'recovery_coordinator_start': {
      _state.recoveryAttempts += 1;
      _state.inflight.set(`coord:${executionId}`, Date.now());
      return;
    }
    case 'recovery_coordinator_success': {
      _state.recoverySuccesses += 1;
      const t0 = _state.inflight.get(`coord:${executionId}`);
      _state.inflight.delete(`coord:${executionId}`);
      const duration = durationMs ?? (typeof t0 === 'number' ? Date.now() - t0 : null);
      pushOutcome({
        atIso: new Date().toISOString(),
        executionId,
        outcome: payload.status === 'already_completed' ? 'already_completed' : 'succeeded',
        durationMs: duration,
        detail: typeof payload.status === 'string' ? payload.status : null,
      });
      return;
    }
    case 'recovery_coordinator_failure': {
      _state.recoveryFailures += 1;
      _state.inflight.delete(`coord:${executionId}`);
      if (code) bump(_state.recoveryFailuresByCode, code, 1);
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      if (reason && !code) bump(_state.recoveryFailuresByCode, reason, 1);
      pushOutcome({
        atIso: new Date().toISOString(),
        executionId,
        outcome: 'failed',
        durationMs: durationMs ?? null,
        detail: reason,
      });
      return;
    }
    case 'recovery_coordinator_no_op': {
      _state.inflight.delete(`coord:${executionId}`);
      // Don't count as success or failure — it's a no-op.
      return;
    }
    case 'checkpoint_restore_success': {
      if (durationMs !== null) recordSample(_state.checkpointRestoreLatency, durationMs);
      return;
    }
    case 'checkpoint_restore_failure': {
      if (code) bump(_state.recoveryFailuresByCode, `checkpoint_restore:${code}`, 1);
      return;
    }
    case 'replay_continuation_success': {
      if (durationMs !== null) recordSample(_state.replayContinuationLatency, durationMs);
      const outcome = typeof payload.outcome === 'string' ? payload.outcome : null;
      if (outcome === 'duplicate_suppressed') {
        const dupes = typeof payload.duplicateSuppressions === 'number' ? payload.duplicateSuppressions : 1;
        _state.duplicateSuppressionEvents += Math.max(1, dupes);
      } else if (typeof payload.duplicateSuppressions === 'number' && payload.duplicateSuppressions > 0) {
        _state.duplicateSuppressionEvents += payload.duplicateSuppressions;
      }
      return;
    }
    case 'replay_continuation_duplicate_suppressed': {
      _state.duplicateSuppressionEvents += 1;
      return;
    }
    case 'replay_continuation_failure': {
      if (durationMs !== null) recordSample(_state.replayContinuationLatency, durationMs);
      if (code) bump(_state.recoveryFailuresByCode, `replay:${code}`, 1);
      return;
    }
    case 'lease_recovery_attempt': {
      _state.inflight.set(`lease:${executionId}`, Date.now());
      return;
    }
    case 'lease_recovery_success': {
      const t0 = _state.inflight.get(`lease:${executionId}`);
      _state.inflight.delete(`lease:${executionId}`);
      if (typeof t0 === 'number') recordSample(_state.leaseRecoveryLatency, Date.now() - t0);
      if (payload.action === 'took_over') _state.leaseTakeoverEvents += 1;
      return;
    }
    case 'lease_recovery_failure': {
      const t0 = _state.inflight.get(`lease:${executionId}`);
      _state.inflight.delete(`lease:${executionId}`);
      if (typeof t0 === 'number') recordSample(_state.leaseRecoveryLatency, Date.now() - t0);
      if (code) bump(_state.recoveryFailuresByCode, `lease:${code}`, 1);
      return;
    }
    case 'stale_execution_detected': {
      _state.staleWorkerEvents += 1;
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      const status = typeof payload.executionStatus === 'string' ? payload.executionStatus : null;
      if (reason === 'abandoned_marker' || status === 'abandoned') {
        _state.abandonedExecutionEvents += 1;
      }
      return;
    }
    case 'stale_execution_reconciled':
    case 'stale_execution_skipped': {
      // Already counted via stale_execution_detected.
      return;
    }
    default:
      return;
  }
}

/** Telemetry sink that forwards events to the aggregator. */
export const durableRecoveryTelemetrySink = {
  emit(event: string, payload: TelemetryPayload): void {
    recordEvent(event, payload);
  },
};

// ── Snapshot ────────────────────────────────────────────────────────

export function getDurableRecoverySnapshot(): DurableRecoverySnapshot {
  const successRate = _state.recoveryAttempts === 0
    ? null
    : _state.recoverySuccesses / _state.recoveryAttempts;
  return {
    snapshotAtIso: new Date().toISOString(),
    recoveryAttempts: _state.recoveryAttempts,
    recoverySuccesses: _state.recoverySuccesses,
    recoveryFailures: _state.recoveryFailures,
    recoverySuccessRate: successRate,
    staleWorkerEvents: _state.staleWorkerEvents,
    abandonedExecutionEvents: _state.abandonedExecutionEvents,
    leaseTakeoverEvents: _state.leaseTakeoverEvents,
    duplicateSuppressionEvents: _state.duplicateSuppressionEvents,
    checkpointRestoreLatency: summarize(_state.checkpointRestoreLatency),
    replayContinuationLatency: summarize(_state.replayContinuationLatency),
    leaseRecoveryLatency: summarize(_state.leaseRecoveryLatency),
    recoveryFailuresByCode: Object.fromEntries(_state.recoveryFailuresByCode),
    recentRecoveryOutcomes: [..._state.recentRecoveryOutcomes],
  };
}

/** Test helper: zero the aggregator. */
export function _resetDurableRecoveryDiagnostics(): void {
  _state = newState();
}
