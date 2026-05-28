/**
 * Phase 20F — ExecutionThroughputGovernor
 *
 * Backpressure / throttling oracle. Callers ask "may I start work?" and
 * the governor evaluates current saturation across:
 *
 *   - active executions
 *   - queue depth
 *   - worker saturation (% of capacity in use)
 *   - checkpoint pressure (last-known checkpoint write latency band)
 *   - retry frequency (recent retries per minute)
 *   - recovery pressure (% of capacity used by recovery work)
 *
 * Returns a ThroughputDecision with:
 *   - allowed: boolean (start work now?)
 *   - signal: which dimension triggered backpressure (or 'none')
 *   - retryAfterMs: suggested delay before retrying
 *   - snapshot: the inputs that drove the decision
 *
 * SCOPE: decisions ONLY. No autonomous queue manipulation. No worker
 * scaling. Callers (the runner, the recovery scheduler) consult the
 * governor and back off when asked.
 *
 * GUARANTEES:
 *   - Pure decision: same inputs → same output. No hidden state mutation.
 *   - Conservative: when in doubt, deny (favor stability over throughput).
 *   - Bounded retry recommendation: retryAfterMs always in [0, 60_000].
 */

import type {
  BackpressureSignal,
  ThroughputDecision,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ThroughputTelemetryEvent =
  | 'throughput_governor_engaged'
  | 'throughput_backpressure_applied';

export interface ThroughputTelemetrySink {
  emit(event: ThroughputTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ThroughputTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'throughput_backpressure_applied') console.warn(`[throughput_gov] ${line}`);
      else console.log(`[throughput_gov] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────

export interface ThroughputGovernorThresholds {
  /** Hard cap on simultaneous active executions. Default 256. */
  maxActiveExecutions: number;
  /** Soft cap; above this, slow new starts. Default 0.85 of max. */
  activeExecutionsWarnRatio: number;
  /** Queue depth at which to throttle new starts. Default 1_000. */
  maxQueueDepth: number;
  /** Worker saturation (0..1). Default 0.9. */
  maxWorkerSaturation: number;
  /** Checkpoint pressure (0..1). Default 0.8. */
  maxCheckpointPressure: number;
  /** Retry storm threshold (retries/min). Default 200. */
  maxRetriesPerMin: number;
  /** Recovery pressure (0..1). Default 0.7. */
  maxRecoveryPressure: number;
  /** Default retry-after (ms) when backpressure is applied. Default 2_000. */
  defaultRetryAfterMs: number;
}

const DEFAULT_THRESHOLDS: ThroughputGovernorThresholds = {
  maxActiveExecutions: 256,
  activeExecutionsWarnRatio: 0.85,
  maxQueueDepth: 1_000,
  maxWorkerSaturation: 0.9,
  maxCheckpointPressure: 0.8,
  maxRetriesPerMin: 200,
  maxRecoveryPressure: 0.7,
  defaultRetryAfterMs: 2_000,
};

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface ThroughputSnapshotInputs {
  activeExecutions: number;
  queueDepth: number;
  workerSaturation: number;
  checkpointPressure: number;
  retryFrequencyPerMin: number;
  recoveryPressure: number;
}

export interface ExecutionThroughputGovernor {
  evaluate(input: ThroughputSnapshotInputs): ThroughputDecision;
  /** Convenience: same as evaluate() but emits telemetry. */
  evaluateAndAnnounce(input: ThroughputSnapshotInputs): ThroughputDecision;
  thresholds(): ThroughputGovernorThresholds;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface ExecutionThroughputGovernorOptions {
  thresholds?: Partial<ThroughputGovernorThresholds>;
  telemetry?: ThroughputTelemetrySink;
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function clampRetry(ms: number): number { return Math.max(0, Math.min(60_000, ms)); }

export function createExecutionThroughputGovernor(
  options?: ExecutionThroughputGovernorOptions,
): ExecutionThroughputGovernor {
  const thresholds: ThroughputGovernorThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options?.thresholds ?? {}),
  };
  const telemetry = options?.telemetry ?? defaultTelemetrySink;

  function evaluate(input: ThroughputSnapshotInputs): ThroughputDecision {
    const snapshot: ThroughputDecision['snapshot'] = {
      activeExecutions: Math.max(0, input.activeExecutions),
      queueDepth: Math.max(0, input.queueDepth),
      workerSaturation: clamp01(input.workerSaturation),
      checkpointPressure: clamp01(input.checkpointPressure),
      retryFrequencyPerMin: Math.max(0, input.retryFrequencyPerMin),
      recoveryPressure: clamp01(input.recoveryPressure),
    };

    // Priority order of signals: hardest cap wins.
    let signal: BackpressureSignal = 'none';
    let reason = 'within thresholds';
    let retryAfterMs = 0;
    let allowed = true;

    if (snapshot.activeExecutions >= thresholds.maxActiveExecutions) {
      signal = 'concurrency_saturated';
      reason = `active=${snapshot.activeExecutions} >= max=${thresholds.maxActiveExecutions}`;
      retryAfterMs = thresholds.defaultRetryAfterMs * 2;
      allowed = false;
    } else if (snapshot.queueDepth >= thresholds.maxQueueDepth) {
      signal = 'queue_depth_high';
      reason = `queueDepth=${snapshot.queueDepth} >= max=${thresholds.maxQueueDepth}`;
      retryAfterMs = thresholds.defaultRetryAfterMs;
      allowed = false;
    } else if (snapshot.workerSaturation >= thresholds.maxWorkerSaturation) {
      signal = 'concurrency_saturated';
      reason = `workerSaturation=${snapshot.workerSaturation.toFixed(2)} >= ${thresholds.maxWorkerSaturation}`;
      retryAfterMs = thresholds.defaultRetryAfterMs;
      allowed = false;
    } else if (snapshot.recoveryPressure >= thresholds.maxRecoveryPressure) {
      signal = 'recovery_pressure';
      reason = `recoveryPressure=${snapshot.recoveryPressure.toFixed(2)} >= ${thresholds.maxRecoveryPressure}`;
      retryAfterMs = thresholds.defaultRetryAfterMs;
      allowed = false;
    } else if (snapshot.retryFrequencyPerMin >= thresholds.maxRetriesPerMin) {
      signal = 'retry_storm';
      reason = `retries/min=${snapshot.retryFrequencyPerMin} >= ${thresholds.maxRetriesPerMin}`;
      retryAfterMs = thresholds.defaultRetryAfterMs * 3;
      allowed = false;
    } else if (snapshot.checkpointPressure >= thresholds.maxCheckpointPressure) {
      signal = 'checkpoint_lag';
      reason = `checkpointPressure=${snapshot.checkpointPressure.toFixed(2)} >= ${thresholds.maxCheckpointPressure}`;
      retryAfterMs = thresholds.defaultRetryAfterMs;
      allowed = false;
    } else if (
      snapshot.activeExecutions >= Math.floor(thresholds.maxActiveExecutions * thresholds.activeExecutionsWarnRatio)
    ) {
      // Adaptive pacing: still allow, but request a small delay.
      signal = 'concurrency_saturated';
      reason = `active=${snapshot.activeExecutions} >= warn=${Math.floor(thresholds.maxActiveExecutions * thresholds.activeExecutionsWarnRatio)}`;
      retryAfterMs = Math.floor(thresholds.defaultRetryAfterMs / 4);
      allowed = true;
    }

    return {
      allowed, signal, reason,
      retryAfterMs: clampRetry(retryAfterMs),
      snapshot,
    };
  }

  return {
    evaluate,
    evaluateAndAnnounce(input) {
      const decision = evaluate(input);
      if (decision.signal !== 'none') {
        telemetry.emit('throughput_governor_engaged', {
          signal: decision.signal, reason: decision.reason,
          allowed: decision.allowed,
          retryAfterMs: decision.retryAfterMs,
          snapshot: decision.snapshot,
        });
        if (!decision.allowed) {
          telemetry.emit('throughput_backpressure_applied', {
            signal: decision.signal, reason: decision.reason,
            retryAfterMs: decision.retryAfterMs,
            snapshot: decision.snapshot,
          });
        }
      }
      return decision;
    },
    thresholds() { return { ...thresholds }; },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: ExecutionThroughputGovernor | null = null;
export function getDefaultExecutionThroughputGovernor(): ExecutionThroughputGovernor {
  if (!_default) _default = createExecutionThroughputGovernor();
  return _default;
}
export function setDefaultExecutionThroughputGovernor(g: ExecutionThroughputGovernor): void {
  _default = g;
}
