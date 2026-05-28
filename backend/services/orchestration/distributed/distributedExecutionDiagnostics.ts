/**
 * Phase 20H — distributedExecutionDiagnostics
 *
 * Passive in-process aggregator for distributed-runtime telemetry.
 * Subscribes to events emitted by:
 *   - DistributedExecutionQueue       (execution_enqueued/claimed/completed/...)
 *   - ExecutionClaimingEngine         (ownership_claim_*)
 *   - DistributedWorkerCoordinator    (worker_registered/heartbeat/...)
 *   - RecoverySchedulingGovernor      (recovery_scheduled/throttled/suppressed)
 *   - ExecutionThroughputGovernor     (throughput_governor_engaged/...)
 *   - DistributedExecutionRunner      (runner_started/iteration_completed/...)
 *
 * Tracks (per spec):
 *   - queue latency
 *   - execution claim latency
 *   - replay continuation frequency
 *   - worker heartbeat stability
 *   - stale-worker frequency
 *   - execution reclaim frequency
 *   - throughput throttling frequency
 *   - recovery scheduling pressure
 *   - execution completion latency
 *
 * + Forensic timelines for:
 *   - execution ownership transfer
 *   - queue lifecycle
 *   - replay continuation chain
 *   - recovery scheduling chain
 *
 * SCOPE: pure aggregation. No I/O. No alarming. Snapshot consumed by
 * /api endpoints + stress harnesses. Memory bounded.
 */

import type {
  DistributedExecutionSnapshot,
  DistributedLatencyBucket,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

const SAMPLE_CAP = 256;
const TIMELINE_CAP = 64;

// ────────────────────────────────────────────────────────────────────
// Sample-list helpers
// ────────────────────────────────────────────────────────────────────

interface SampleList {
  samples: number[];
  lastMs: number | null;
}
function newSampleList(): SampleList { return { samples: [], lastMs: null }; }
function recordSample(list: SampleList, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  list.samples.push(ms);
  if (list.samples.length > SAMPLE_CAP) list.samples.shift();
  list.lastMs = ms;
}
function summarize(list: SampleList): DistributedLatencyBucket {
  if (list.samples.length === 0) return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null };
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

// ────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────

interface InternalState {
  // ── Queue counters ──
  enqueued: number;
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  // ── Queue depth (last observed) ──
  lastQueueDepth: number;
  queueLatency: SampleList;        // enqueue → completion
  // ── Claim ──
  claimLatency: SampleList;        // ownership_claim_started → succeeded
  claimRaceContentions: number;
  // ── Replay ──
  replayContinuationsTriggered: number;
  // ── Workers ──
  workersRegistered: number;
  workersActive: number;
  workersStale: number;
  workersOffline: number;
  heartbeatBeats: number;
  heartbeatStaleEvents: number;
  staleWorkerReclaims: number;
  // ── Throttling / pressure ──
  throughputThrottlingEvents: number;
  recoverySchedulingPressureEvents: number;
  // ── Completion latency ──
  completionLatency: SampleList;
  // ── Timelines ──
  ownershipTransfers: DistributedExecutionSnapshot['ownershipTransfers'];
  queueLifecycleEvents: DistributedExecutionSnapshot['queueLifecycleEvents'];
  replayContinuationChain: DistributedExecutionSnapshot['replayContinuationChain'];
  recoverySchedulingChain: DistributedExecutionSnapshot['recoverySchedulingChain'];
  // ── In-flight markers for latency derivation ──
  enqueuedTimes: Map<string, number>;        // queueEntryId → ts(enqueue)
  claimStartTimes: Map<string, number>;      // workerId → ts(claim start) (latest)
}

function newState(): InternalState {
  return {
    enqueued: 0, claimed: 0, completed: 0, retryScheduled: 0, deadLettered: 0,
    lastQueueDepth: 0,
    queueLatency: newSampleList(),
    claimLatency: newSampleList(),
    claimRaceContentions: 0,
    replayContinuationsTriggered: 0,
    workersRegistered: 0,
    workersActive: 0, workersStale: 0, workersOffline: 0,
    heartbeatBeats: 0, heartbeatStaleEvents: 0,
    staleWorkerReclaims: 0,
    throughputThrottlingEvents: 0,
    recoverySchedulingPressureEvents: 0,
    completionLatency: newSampleList(),
    ownershipTransfers: [],
    queueLifecycleEvents: [],
    replayContinuationChain: [],
    recoverySchedulingChain: [],
    enqueuedTimes: new Map(),
    claimStartTimes: new Map(),
  };
}

let _state = newState();

function push<T>(list: T[], entry: T): void {
  list.push(entry);
  while (list.length > TIMELINE_CAP) list.shift();
}

// ────────────────────────────────────────────────────────────────────
// Ingestion
// ────────────────────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

export function recordEvent(event: string, payload: Payload): void {
  const atIso = new Date().toISOString();
  const executionId = typeof payload.executionId === 'string' ? payload.executionId : 'unknown';
  const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
  const workerId = typeof payload.workerId === 'string' ? payload.workerId : 'unknown';

  switch (event) {
    // ── Queue lifecycle ──
    case 'execution_enqueued': {
      _state.enqueued += 1;
      _state.enqueuedTimes.set(queueEntryId, Date.now());
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'enqueued',
        detail: typeof payload.dedupKey === 'string' ? payload.dedupKey : null,
      });
      return;
    }
    case 'execution_claimed': {
      _state.claimed += 1;
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'claimed',
        detail: workerId,
      });
      return;
    }
    case 'execution_visibility_reclaimed': {
      _state.staleWorkerReclaims += 1;
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'claimed',
        detail: 'visibility_reclaim',
      });
      return;
    }
    case 'execution_completed': {
      _state.completed += 1;
      const t0 = _state.enqueuedTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        const elapsed = Date.now() - t0;
        recordSample(_state.queueLatency, elapsed);
        recordSample(_state.completionLatency, elapsed);
        _state.enqueuedTimes.delete(queueEntryId);
      }
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'completed',
        detail: typeof payload.workerId === 'string' ? payload.workerId : null,
      });
      return;
    }
    case 'execution_retry_scheduled': {
      _state.retryScheduled += 1;
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'retry_scheduled',
        detail: typeof payload.runAtIso === 'string' ? payload.runAtIso : null,
      });
      return;
    }
    case 'execution_dead_lettered': {
      _state.deadLettered += 1;
      _state.enqueuedTimes.delete(queueEntryId);
      push(_state.queueLifecycleEvents, {
        atIso, queueEntryId, executionId, event: 'dead_lettered',
        detail: typeof payload.reason === 'string' ? payload.reason : null,
      });
      return;
    }
    case 'execution_dedup_suppressed': {
      _state.claimRaceContentions += 1;
      return;
    }
    // ── Claim latency ──
    case 'ownership_claim_started': {
      _state.claimStartTimes.set(workerId, Date.now());
      return;
    }
    case 'ownership_claim_succeeded': {
      const t0 = _state.claimStartTimes.get(workerId);
      if (typeof t0 === 'number') {
        recordSample(_state.claimLatency, Date.now() - t0);
        _state.claimStartTimes.delete(workerId);
      }
      return;
    }
    case 'ownership_claim_refused': {
      _state.claimRaceContentions += 1;
      _state.claimStartTimes.delete(workerId);
      return;
    }
    case 'ownership_transfer_succeeded': {
      push(_state.ownershipTransfers, {
        atIso, executionId,
        fromWorkerId: typeof payload.previousOwnerId === 'string' ? payload.previousOwnerId : null,
        toWorkerId: typeof payload.newOwnerId === 'string' ? payload.newOwnerId : workerId,
        reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
      });
      return;
    }
    // ── Worker registry ──
    case 'worker_registered': {
      _state.workersRegistered += 1;
      _state.workersActive += 1;
      return;
    }
    case 'worker_heartbeat': {
      _state.heartbeatBeats += 1;
      return;
    }
    case 'worker_marked_stale': {
      _state.workersStale += 1;
      _state.heartbeatStaleEvents += 1;
      return;
    }
    case 'worker_offline': {
      _state.workersOffline += 1;
      _state.workersActive = Math.max(0, _state.workersActive - 1);
      return;
    }
    case 'worker_status_changed': {
      const current = typeof payload.current === 'string' ? payload.current : null;
      const previous = typeof payload.previous === 'string' ? payload.previous : null;
      // Stale or offline removes the worker from the active count.
      if (current === 'stale' || current === 'offline') {
        _state.workersActive = Math.max(0, _state.workersActive - 1);
      }
      // Resumed from stale → re-add to active.
      if (previous === 'stale' && current === 'active') {
        _state.workersActive += 1;
        _state.workersStale = Math.max(0, _state.workersStale - 1);
      }
      return;
    }
    // ── Throttling / pressure ──
    case 'throughput_backpressure_applied':
    case 'throughput_governor_engaged': {
      if (event === 'throughput_backpressure_applied') {
        _state.throughputThrottlingEvents += 1;
      }
      return;
    }
    case 'recovery_scheduling_pressure': {
      _state.recoverySchedulingPressureEvents += 1;
      return;
    }
    case 'recovery_scheduled': {
      push(_state.recoverySchedulingChain, {
        atIso, executionId, scheduled: true,
        reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
      });
      return;
    }
    case 'recovery_throttled':
    case 'recovery_suppressed': {
      push(_state.recoverySchedulingChain, {
        atIso, executionId, scheduled: false,
        reason: typeof payload.reason === 'string' ? payload.reason : event,
      });
      return;
    }
    // ── Replay continuation (forwarded from Phase 19) ──
    case 'replay_continuation_success':
    case 'replay_continuation_failure':
    case 'replay_continuation_duplicate_suppressed': {
      _state.replayContinuationsTriggered += 1;
      push(_state.replayContinuationChain, {
        atIso, executionId,
        outcome: event === 'replay_continuation_success'
          ? (typeof payload.outcome === 'string' ? payload.outcome : 'success')
          : event === 'replay_continuation_failure'
            ? (typeof payload.reason === 'string' ? `failed: ${payload.reason}` : 'failed')
            : 'duplicate_suppressed',
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
      });
      return;
    }
    default:
      return;
  }
}

/** Telemetry sink that forwards events to the aggregator. */
export const distributedExecutionTelemetrySink = {
  emit(event: string, payload: Payload): void { recordEvent(event, payload); },
};

// ────────────────────────────────────────────────────────────────────
// Snapshot
// ────────────────────────────────────────────────────────────────────

export function setQueueDepth(depth: number): void {
  _state.lastQueueDepth = Math.max(0, Math.floor(depth));
}

export function getDistributedExecutionSnapshot(): DistributedExecutionSnapshot {
  const totalWorkers = _state.workersRegistered;
  const stableBeats = _state.heartbeatBeats;
  const heartbeatStabilityScore = totalWorkers === 0
    ? 0
    : Math.max(0, Math.min(100, Math.round(100 - (_state.heartbeatStaleEvents / Math.max(1, stableBeats)) * 100)));
  return {
    snapshotAtIso: new Date().toISOString(),
    queueEnqueued: _state.enqueued,
    queueClaimed: _state.claimed,
    queueCompleted: _state.completed,
    queueRetryScheduled: _state.retryScheduled,
    queueDeadLettered: _state.deadLettered,
    queueDepthCurrent: _state.lastQueueDepth,
    queueLatency: summarize(_state.queueLatency),
    claimLatency: summarize(_state.claimLatency),
    claimRaceContentions: _state.claimRaceContentions,
    replayContinuationsTriggered: _state.replayContinuationsTriggered,
    workersRegistered: _state.workersRegistered,
    workersActive: _state.workersActive,
    workersStale: _state.workersStale,
    workersOffline: _state.workersOffline,
    heartbeatStabilityScore,
    staleWorkerReclaims: _state.staleWorkerReclaims,
    throughputThrottlingEvents: _state.throughputThrottlingEvents,
    recoverySchedulingPressureEvents: _state.recoverySchedulingPressureEvents,
    executionCompletionLatency: summarize(_state.completionLatency),
    ownershipTransfers: [..._state.ownershipTransfers],
    queueLifecycleEvents: [..._state.queueLifecycleEvents],
    replayContinuationChain: [..._state.replayContinuationChain],
    recoverySchedulingChain: [..._state.recoverySchedulingChain],
  };
}

/** Test helper: zero the aggregator. */
export function _resetDistributedExecutionDiagnostics(): void { _state = newState(); }
