/**
 * Phase 20 — Shared distributed runtime types.
 *
 * Wire-stable shapes used across the distributed execution queue, worker
 * coordinator, claiming engine, runner, recovery scheduling governor,
 * throughput governor, worker health governor, and diagnostics aggregator.
 *
 * Pure types. No I/O.
 */

import type {
  ExecutionRecord,
  OrchestrationPhase,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';

// ────────────────────────────────────────────────────────────────────
// Phase 20A — Queue entries
// ────────────────────────────────────────────────────────────────────

export type QueueEntryStatus =
  | 'queued'        // visible, waiting to be claimed
  | 'claimed'       // claimed by a worker; under visibility timeout
  | 'completed'     // ack'd as completed
  | 'failed'        // ack'd as failed (retryable while retries < max)
  | 'dead_lettered' // permanently failed (retries exhausted)
  | 'cancelled';    // operator cancel

export type QueueEntryKind =
  | 'execution_start'
  | 'execution_recovery'
  | 'execution_continuation';

export interface QueueEntry {
  queueEntryId: string;
  executionId: string;
  companyId: string;
  kind: QueueEntryKind;
  status: QueueEntryStatus;
  /** Higher = earlier. 0..100 typical range; defaults to 50. */
  priority: number;
  /** Earliest time this entry becomes eligible to be claimed (ISO). */
  runAtIso: string;
  /** Visibility timeout — when claimed, this is acquire+durationMs (ISO). */
  visibilityDeadlineIso: string | null;
  /** Worker currently holding the claim, if any. */
  claimedByWorkerId: string | null;
  attemptCount: number;
  maxAttempts: number;
  /**
   * Stable dedup key. Two enqueue calls with the same key collapse into
   * a single queued entry (idempotent enqueue).
   */
  dedupKey: string;
  /** Caller-supplied payload (small; max 4KB recommended). */
  payload: Record<string, unknown> | null;
  /** Result payload set on ack (small). */
  resultPayload: Record<string, unknown> | null;
  failureReason: string | null;
  createdAtIso: string;
  updatedAtIso: string;
}

export type AckOutcome = 'completed' | 'failed' | 'cancelled';

// ────────────────────────────────────────────────────────────────────
// Phase 20B — Worker registry
// ────────────────────────────────────────────────────────────────────

export type WorkerKind = 'queue_worker' | 'recovery_worker' | 'cron' | 'standalone' | 'test';

export type WorkerStatus =
  | 'active'
  | 'draining'
  | 'recovering'
  | 'stale'
  | 'offline';

export interface WorkerCapability {
  /** Logical capability tag (e.g. 'generation', 'persistence', 'all'). */
  name: string;
  /** Optional weight; higher = stronger preference for matching work. */
  weight?: number;
}

export interface WorkerRecord {
  workerId: string;
  workerKind: WorkerKind;
  status: WorkerStatus;
  capabilities: WorkerCapability[];
  activeExecutionCount: number;
  recoveryLoad: number;
  /** Caller-supplied process identity hints. */
  hostname: string | null;
  processIdentity: string | null;
  /** ISO of registration. */
  registeredAtIso: string;
  heartbeatAtIso: string | null;
  drainStartedAtIso: string | null;
  offlineAtIso: string | null;
  /** Tracking metadata for diagnostics + forensics. */
  meta: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Phase 20C — Claiming
// ────────────────────────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; entry: QueueEntry; took_over: boolean }
  | { ok: false; reason: 'no_eligible_entry' | 'already_claimed' | 'execution_missing' | 'worker_ineligible' };

export type ClaimOwnershipOutcome =
  | { ok: true; execution: ExecutionRecord; workerId: string; previousOwnerId: string | null }
  | { ok: false; reason: 'execution_missing' | 'already_owned' | 'lease_takeover_refused' | 'unknown' };

// ────────────────────────────────────────────────────────────────────
// Phase 20D — Runner
// ────────────────────────────────────────────────────────────────────

export interface RunnerLoopReport {
  startedAtIso: string;
  completedAtIso: string;
  durationMs: number;
  iterations: number;
  entriesClaimed: number;
  entriesCompleted: number;
  entriesFailed: number;
  entriesRetryScheduled: number;
  entriesDeadLettered: number;
  abortReason: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Phase 20E — Recovery scheduling
// ────────────────────────────────────────────────────────────────────

export interface RecoverySchedulingDecision {
  executionId: string;
  shouldSchedule: boolean;
  reason: string;
  backoffMs: number;
  attempt: number;
}

export interface RecoverySchedulingReport {
  scheduledExecutionIds: string[];
  throttledExecutionIds: string[];
  suppressedExecutionIds: string[];
  decisions: RecoverySchedulingDecision[];
}

// ────────────────────────────────────────────────────────────────────
// Phase 20F — Throughput governor
// ────────────────────────────────────────────────────────────────────

export type BackpressureSignal =
  | 'none'
  | 'queue_depth_high'
  | 'concurrency_saturated'
  | 'recovery_pressure'
  | 'retry_storm'
  | 'checkpoint_lag';

export interface ThroughputDecision {
  allowed: boolean;
  signal: BackpressureSignal;
  reason: string;
  /** Suggested delay before retrying (ms). 0 = immediate retry permitted. */
  retryAfterMs: number;
  /** Snapshot of the inputs that drove this decision. */
  snapshot: {
    activeExecutions: number;
    queueDepth: number;
    workerSaturation: number;     // 0..1
    checkpointPressure: number;   // 0..1
    retryFrequencyPerMin: number;
    recoveryPressure: number;     // 0..1
  };
}

// ────────────────────────────────────────────────────────────────────
// Phase 20G — Worker health
// ────────────────────────────────────────────────────────────────────

export type WorkerHealthFlag =
  | 'heartbeat_drift'
  | 'execution_starvation'
  | 'worker_overload'
  | 'repeated_recovery_failures'
  | 'unhealthy_reclaim_frequency'
  | 'stale_heartbeat';

export interface WorkerHealthFinding {
  workerId: string;
  workerStatus: WorkerStatus;
  flags: WorkerHealthFlag[];
  /** 0..100, higher = healthier. */
  healthScore: number;
  lastHeartbeatIso: string | null;
  staleAgeMs: number;
  activeExecutions: number;
  recommendedAction: 'no_action' | 'quarantine' | 'drain' | 'mark_offline';
  notes: string[];
}

// ────────────────────────────────────────────────────────────────────
// Phase 20H — Diagnostics
// ────────────────────────────────────────────────────────────────────

export interface DistributedLatencyBucket {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DistributedExecutionSnapshot {
  snapshotAtIso: string;
  // ── Queue ──
  queueEnqueued: number;
  queueClaimed: number;
  queueCompleted: number;
  queueRetryScheduled: number;
  queueDeadLettered: number;
  queueDepthCurrent: number;
  queueLatency: DistributedLatencyBucket;
  // ── Claim ──
  claimLatency: DistributedLatencyBucket;
  claimRaceContentions: number;
  // ── Replay continuation ──
  replayContinuationsTriggered: number;
  // ── Workers ──
  workersRegistered: number;
  workersActive: number;
  workersStale: number;
  workersOffline: number;
  heartbeatStabilityScore: number; // 0..100
  // ── Reclaim / throttling ──
  staleWorkerReclaims: number;
  throughputThrottlingEvents: number;
  recoverySchedulingPressureEvents: number;
  // ── Completion ──
  executionCompletionLatency: DistributedLatencyBucket;
  // ── Forensic timelines (most-recent N entries; oldest first) ──
  ownershipTransfers: Array<{
    atIso: string;
    executionId: string;
    fromWorkerId: string | null;
    toWorkerId: string;
    reason: string;
  }>;
  queueLifecycleEvents: Array<{
    atIso: string;
    queueEntryId: string;
    executionId: string;
    event: 'enqueued' | 'claimed' | 'completed' | 'retry_scheduled' | 'dead_lettered';
    detail: string | null;
  }>;
  replayContinuationChain: Array<{
    atIso: string;
    executionId: string;
    outcome: string;
    durationMs: number | null;
  }>;
  recoverySchedulingChain: Array<{
    atIso: string;
    executionId: string;
    scheduled: boolean;
    reason: string;
  }>;
}

// ────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ────────────────────────────────────────────────────────────────────

export type { OrchestrationPhase };
