/**
 * Phase 18H — durablePersistenceDiagnostics
 *
 * Passive observability aggregator for the durable orchestration
 * persistence layer. Subscribes to telemetry from:
 *   - SupabaseExecutionStore   (execution_store_write_success / _failure)
 *   - SupabaseCheckpointStore  (checkpoint_store_write_success / _failure)
 *   - SupabaseLeaseStore       (lease_acquire_*, lease_renew_*)
 *   - writeSideSmokeVerification (write_smoke_test_*)
 *   - bootstrapExecutionStore  (runtime_execution_store_registration_*,
 *                                persistence_bootstrap_complete)
 *
 * Tracks:
 *   - checkpoint latency (count, p50, p95, last)
 *   - lease acquisition latency (count, p50, p95, last)
 *   - write-smoke latency (count, p50, p95, last)
 *   - retry frequency (count by operation)
 *   - contention frequency (ALREADY_ACTIVE lease failures)
 *   - serialization failures (SQLSTATE 40001 / 40P01)
 *   - bootstrap failure trend (rolling window)
 *
 * SCOPE: pure aggregation, in-process. NO autonomous recovery. NO
 * remediation. NO alarms — just a snapshot consumed by /api endpoints
 * and stress harnesses.
 *
 * Memory bounded: each rolling sample list is capped at SAMPLE_CAP.
 */

// ── Constants ────────────────────────────────────────────────────────

const SAMPLE_CAP = 256;
const BOOTSTRAP_FAILURE_WINDOW = 32;

// ── Types ────────────────────────────────────────────────────────────

export interface LatencySamples {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DurablePersistenceSnapshot {
  /** ISO timestamp when the snapshot was generated. */
  snapshotAt: string;
  /** Total operations observed across all stores since last reset. */
  totalOperations: number;

  // ── Latency aggregates ─────────────────────────────────────────────
  checkpointWriteLatency: LatencySamples;
  leaseAcquireLatency: LatencySamples;
  leaseRenewLatency: LatencySamples;
  executionWriteLatency: LatencySamples;
  writeSmokeLatency: LatencySamples;

  // ── Retry + failure rates ──────────────────────────────────────────
  /** Number of operations that succeeded only after >=1 retry. */
  retriedOperations: number;
  /** Number of operations that ultimately failed. */
  failedOperations: number;
  /** Count of unique-violation contention events (lease ALREADY_ACTIVE). */
  contentionEvents: number;
  /** Count of serialization-failure events (SQLSTATE 40001 / 40P01). */
  serializationFailures: number;
  /** Per-operation retry counts (operation → count). */
  retriesByOperation: Record<string, number>;
  /** Per-operation failure counts (operation → count). */
  failuresByOperation: Record<string, number>;
  /** Per-error-code counts across the whole window. */
  errorsByCode: Record<string, number>;

  // ── Bootstrap trend ───────────────────────────────────────────────
  /** Most recent bootstrap outcomes (oldest first). */
  bootstrapHistory: Array<{
    at: string;
    processKind: string;
    smokeTestPassed: boolean | null;
    writeSmokeTestPassed: boolean | null;
    failed: boolean;
    reason?: string;
  }>;
  /** Count of bootstrap failures inside the rolling window. */
  bootstrapFailuresInWindow: number;

  // ── Write-smoke trend ─────────────────────────────────────────────
  /** Last write-smoke probe outcome (passed/failed/null=never). */
  lastWriteSmokeStatus: 'passed' | 'failed' | null;
  /** Last write-smoke probe duration in ms (null = never). */
  lastWriteSmokeDurationMs: number | null;
}

// ── Internal state ───────────────────────────────────────────────────

interface SampleList {
  samples: number[];
  lastMs: number | null;
}

function newSampleList(): SampleList {
  return { samples: [], lastMs: null };
}

function recordSample(list: SampleList, ms: number): void {
  list.samples.push(ms);
  if (list.samples.length > SAMPLE_CAP) list.samples.shift();
  list.lastMs = ms;
}

function summarize(list: SampleList): LatencySamples {
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

interface InternalState {
  startedAt: string;
  totalOperations: number;
  retriedOperations: number;
  failedOperations: number;
  contentionEvents: number;
  serializationFailures: number;
  retriesByOperation: Map<string, number>;
  failuresByOperation: Map<string, number>;
  errorsByCode: Map<string, number>;
  checkpointWrite: SampleList;
  leaseAcquire: SampleList;
  leaseRenew: SampleList;
  executionWrite: SampleList;
  writeSmoke: SampleList;
  bootstrapHistory: DurablePersistenceSnapshot['bootstrapHistory'];
  lastWriteSmokeStatus: 'passed' | 'failed' | null;
  lastWriteSmokeDurationMs: number | null;
  /**
   * Per-operation in-flight start timestamps. Keyed on operation+correlation.
   * Used to derive latency when a success/failure event arrives. Reset on
   * snapshot reset.
   */
  inflight: Map<string, number>;
}

function newState(): InternalState {
  return {
    startedAt: new Date().toISOString(),
    totalOperations: 0,
    retriedOperations: 0,
    failedOperations: 0,
    contentionEvents: 0,
    serializationFailures: 0,
    retriesByOperation: new Map(),
    failuresByOperation: new Map(),
    errorsByCode: new Map(),
    checkpointWrite: newSampleList(),
    leaseAcquire: newSampleList(),
    leaseRenew: newSampleList(),
    executionWrite: newSampleList(),
    writeSmoke: newSampleList(),
    bootstrapHistory: [],
    lastWriteSmokeStatus: null,
    lastWriteSmokeDurationMs: null,
    inflight: new Map(),
  };
}

let _state = newState();

// ── Telemetry envelope ──────────────────────────────────────────────

type TelemetryPayload = Record<string, unknown>;

/**
 * Common event envelope. Stores emit these via their telemetry sinks.
 * Callers wire a sink that calls `recordEvent` here.
 */
export interface DurablePersistenceEvent {
  event: string;
  payload: TelemetryPayload;
}

// ── Public sinks ───────────────────────────────────────────────────

/** A telemetry sink whose `emit` forwards into the diagnostics aggregator. */
export const durablePersistenceTelemetrySink = {
  emit(event: string, payload: TelemetryPayload): void {
    recordEvent(event, payload);
  },
};

// ── Event ingestion ─────────────────────────────────────────────────

/**
 * Record an event from any of the durable persistence stores. Tolerant
 * of unknown events (no-op) so callers can wire a single sink to every
 * store without per-event branching.
 */
export function recordEvent(event: string, payload: TelemetryPayload): void {
  const operation = typeof payload.operation === 'string' ? payload.operation : 'unknown';
  const attempt = typeof payload.attempt === 'number' ? payload.attempt : 0;
  const code = typeof payload.code === 'string' ? payload.code : null;
  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;

  switch (event) {
    case 'execution_store_write_success': {
      _state.totalOperations += 1;
      if (attempt > 0) {
        _state.retriedOperations += 1;
        bump(_state.retriesByOperation, operation, attempt);
      }
      // Latency derivation from inflight (only available if caller set it).
      const t0 = takeInflight(operation, payload);
      if (t0 !== null) recordSample(_state.executionWrite, Date.now() - t0);
      return;
    }
    case 'execution_store_write_failure': {
      _state.totalOperations += 1;
      _state.failedOperations += 1;
      bump(_state.failuresByOperation, operation, 1);
      if (code) bump(_state.errorsByCode, code, 1);
      if (code === '40001' || code === '40P01') _state.serializationFailures += 1;
      takeInflight(operation, payload);
      return;
    }
    case 'checkpoint_store_write_success': {
      _state.totalOperations += 1;
      if (attempt > 0) {
        _state.retriedOperations += 1;
        bump(_state.retriesByOperation, operation, attempt);
      }
      const t0 = takeInflight(operation, payload);
      if (t0 !== null) recordSample(_state.checkpointWrite, Date.now() - t0);
      return;
    }
    case 'checkpoint_store_write_failure': {
      _state.totalOperations += 1;
      _state.failedOperations += 1;
      bump(_state.failuresByOperation, operation, 1);
      if (code) bump(_state.errorsByCode, code, 1);
      if (code === '40001' || code === '40P01') _state.serializationFailures += 1;
      takeInflight(operation, payload);
      return;
    }
    case 'lease_acquire_success': {
      _state.totalOperations += 1;
      if (attempt > 0) {
        _state.retriedOperations += 1;
        bump(_state.retriesByOperation, operation, attempt);
      }
      const t0 = takeInflight(operation, payload);
      if (t0 !== null) recordSample(_state.leaseAcquire, Date.now() - t0);
      return;
    }
    case 'lease_acquire_failure': {
      _state.totalOperations += 1;
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      if (reason === 'ALREADY_ACTIVE') {
        _state.contentionEvents += 1;
      } else {
        _state.failedOperations += 1;
        bump(_state.failuresByOperation, operation, 1);
        if (code) bump(_state.errorsByCode, code, 1);
        if (code === '40001' || code === '40P01') _state.serializationFailures += 1;
      }
      takeInflight(operation, payload);
      return;
    }
    case 'lease_renew_success': {
      _state.totalOperations += 1;
      if (attempt > 0) {
        _state.retriedOperations += 1;
        bump(_state.retriesByOperation, operation, attempt);
      }
      const t0 = takeInflight(operation, payload);
      if (t0 !== null) recordSample(_state.leaseRenew, Date.now() - t0);
      return;
    }
    case 'lease_renew_failure': {
      _state.totalOperations += 1;
      _state.failedOperations += 1;
      bump(_state.failuresByOperation, operation, 1);
      if (code) bump(_state.errorsByCode, code, 1);
      if (code === '40001' || code === '40P01') _state.serializationFailures += 1;
      takeInflight(operation, payload);
      return;
    }
    case 'write_smoke_test_started': {
      // start time pinned for the next write_smoke_test_passed / _failed event
      const exec = typeof payload.executionId === 'string' ? payload.executionId : 'unknown';
      _state.inflight.set(`write_smoke:${exec}`, Date.now());
      return;
    }
    case 'write_smoke_test_passed': {
      _state.totalOperations += 1;
      _state.lastWriteSmokeStatus = 'passed';
      const ms = durationMs ?? consumeWriteSmokeInflight(payload);
      if (ms !== null) {
        recordSample(_state.writeSmoke, ms);
        _state.lastWriteSmokeDurationMs = ms;
      }
      return;
    }
    case 'write_smoke_test_failed': {
      _state.totalOperations += 1;
      _state.failedOperations += 1;
      _state.lastWriteSmokeStatus = 'failed';
      bump(_state.failuresByOperation, 'write_smoke', 1);
      if (code) bump(_state.errorsByCode, code, 1);
      consumeWriteSmokeInflight(payload);
      return;
    }
    case 'persistence_bootstrap_complete': {
      const processKind = typeof payload.processKind === 'string' ? payload.processKind : 'unknown';
      const smokeTestPassed = payload.smokeTestPassed as boolean | null | undefined;
      const writeSmokeTestPassed = payload.writeSmokeTestPassed as boolean | null | undefined;
      pushBootstrapHistory({
        at: new Date().toISOString(),
        processKind,
        smokeTestPassed: smokeTestPassed ?? null,
        writeSmokeTestPassed: writeSmokeTestPassed ?? null,
        failed: smokeTestPassed === false || writeSmokeTestPassed === false,
      });
      return;
    }
    case 'runtime_execution_store_registration_failed': {
      const processKind = typeof payload.processKind === 'string' ? payload.processKind : 'unknown';
      const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown';
      pushBootstrapHistory({
        at: new Date().toISOString(),
        processKind,
        smokeTestPassed: null,
        writeSmokeTestPassed: null,
        failed: true,
        reason,
      });
      return;
    }
    default:
      // unknown — ignore
      return;
  }
}

// ── Inflight latency tracking helpers ──────────────────────────────

/**
 * Caller-side helper: mark the start of an operation. The aggregator
 * derives latency when the success/failure event arrives.
 * `correlationId` should be the same value present in the eventual event's
 * payload (e.g. executionId, checkpointId, leaseId).
 */
export function markOperationStart(operation: string, correlationId: string): void {
  _state.inflight.set(`${operation}:${correlationId}`, Date.now());
}

function takeInflight(operation: string, payload: TelemetryPayload): number | null {
  // Try common correlation keys in order — first match wins.
  const candidates = [
    payload.checkpointId, payload.leaseId, payload.executionId,
  ];
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const key = `${operation}:${c}`;
    const t = _state.inflight.get(key);
    if (typeof t === 'number') {
      _state.inflight.delete(key);
      return t;
    }
  }
  return null;
}

function consumeWriteSmokeInflight(payload: TelemetryPayload): number | null {
  const exec = typeof payload.executionId === 'string' ? payload.executionId : null;
  if (!exec) return null;
  const key = `write_smoke:${exec}`;
  const t = _state.inflight.get(key);
  if (typeof t !== 'number') return null;
  _state.inflight.delete(key);
  return Date.now() - t;
}

function bump(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function pushBootstrapHistory(entry: DurablePersistenceSnapshot['bootstrapHistory'][number]): void {
  _state.bootstrapHistory.push(entry);
  while (_state.bootstrapHistory.length > BOOTSTRAP_FAILURE_WINDOW) {
    _state.bootstrapHistory.shift();
  }
}

// ── Snapshot + reset ────────────────────────────────────────────────

export function getDurablePersistenceSnapshot(): DurablePersistenceSnapshot {
  return {
    snapshotAt: new Date().toISOString(),
    totalOperations: _state.totalOperations,
    checkpointWriteLatency: summarize(_state.checkpointWrite),
    leaseAcquireLatency: summarize(_state.leaseAcquire),
    leaseRenewLatency: summarize(_state.leaseRenew),
    executionWriteLatency: summarize(_state.executionWrite),
    writeSmokeLatency: summarize(_state.writeSmoke),
    retriedOperations: _state.retriedOperations,
    failedOperations: _state.failedOperations,
    contentionEvents: _state.contentionEvents,
    serializationFailures: _state.serializationFailures,
    retriesByOperation: Object.fromEntries(_state.retriesByOperation),
    failuresByOperation: Object.fromEntries(_state.failuresByOperation),
    errorsByCode: Object.fromEntries(_state.errorsByCode),
    bootstrapHistory: [..._state.bootstrapHistory],
    bootstrapFailuresInWindow: _state.bootstrapHistory.filter((b) => b.failed).length,
    lastWriteSmokeStatus: _state.lastWriteSmokeStatus,
    lastWriteSmokeDurationMs: _state.lastWriteSmokeDurationMs,
  };
}

/** Test helper: zero the aggregator. */
export function _resetDurablePersistenceDiagnostics(): void {
  _state = newState();
}
