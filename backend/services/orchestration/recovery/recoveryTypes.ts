/**
 * Phase 19 — Shared recovery types.
 *
 * Wire-stable shapes used across the recovery coordinator, checkpoint
 * restoration engine, replay continuation engine, lease recovery governor,
 * stale execution reconciler, forensic analyzer, and diagnostics
 * aggregator.
 *
 * Pure types. No I/O. No imports beyond the threadRuntime type module.
 */

import type {
  ExecutionCheckpoint,
  ExecutionLease,
  ExecutionRecord,
  OrchestrationPhase,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';

// ── Checkpoint integrity ───────────────────────────────────────────

export type CheckpointIntegrityStatus =
  | 'intact'
  | 'partial'
  | 'corrupted'
  | 'missing';

export interface CheckpointIntegrityReport {
  status: CheckpointIntegrityStatus;
  /** 0..100, higher = more confidence in the restoration. */
  integrityScore: number;
  /** Specific issues uncovered during integrity inspection. */
  issues: string[];
  /** Number of distinct phase transitions present in the checkpoint chain. */
  phaseTransitions: number;
  /** Earliest + latest checkpoint timestamps in the chain. */
  windowStartIso: string | null;
  windowEndIso: string | null;
}

export interface RestoredCheckpointState {
  /** The execution this restoration belongs to. */
  executionId: string;
  /** Latest checkpoint id in the chain (null when the chain is empty). */
  latestCheckpointId: string | null;
  /** Coalesced view across the entire checkpoint chain. */
  phase: OrchestrationPhase | null;
  completedNodeOperationIds: string[];
  pendingNodeOperationIds: string[];
  pendingTopologyMutationIds: string[];
  recoveryProgress: Record<string, unknown> | null;
  replayContinuity: Record<string, unknown> | null;
  /** All checkpoints in the chain, ordered ASC by taken_at. */
  chain: ExecutionCheckpoint[];
  /** Integrity assessment of the chain. */
  integrity: CheckpointIntegrityReport;
}

// ── Stale execution detection ───────────────────────────────────────

export type StaleExecutionReason =
  | 'lease_expired'
  | 'heartbeat_stale'
  | 'orphan_running'        // running but no active lease
  | 'recovery_stalled'      // in recovery state past timeout
  | 'abandoned_marker';     // status=abandoned but never reclaimed

export interface StaleExecutionFinding {
  executionId: string;
  reason: StaleExecutionReason;
  detectedAtIso: string;
  /** Best-effort signal age (e.g. ms since last heartbeat / lease expiry). */
  staleAgeMs: number;
  /** Current owner worker id (may be null). */
  currentOwnerWorkerId: string | null;
  /** Lease that triggered detection (null when detected via heartbeat alone). */
  lease: ExecutionLease | null;
  /** Snapshot of the execution record at detection time. */
  execution: ExecutionRecord;
}

export type StaleReconcileAction =
  | 'reclaim'              // mark for takeover by a new worker
  | 'reopen'               // move back to running so caller can resume
  | 'mark_failed'          // unrecoverable; flip to status=failed
  | 'skip';                // nothing actionable

export interface StaleReconcileOutcome {
  executionId: string;
  finding: StaleExecutionFinding;
  action: StaleReconcileAction;
  appliedAtIso: string;
  /** Worker id that took over (only set when action='reclaim'). */
  newOwnerWorkerId: string | null;
  /** Detail string for telemetry / forensics. */
  detail: string;
}

// ── Replay continuation ────────────────────────────────────────────

export type ReplayContinuationOutcome =
  | 'resumed'
  | 'already_completed'
  | 'duplicate_suppressed'
  | 'failed';

export interface ReplayContinuationResult {
  executionId: string;
  outcome: ReplayContinuationOutcome;
  /** Number of steps that ran during this continuation. */
  ranStepCount: number;
  /** Number of steps skipped because the checkpoint marked them completed. */
  skippedStepCount: number;
  /** Number of distinct duplicate mutations suppressed during the run. */
  duplicateSuppressions: number;
  failureReason: string | null;
  durationMs: number;
  /** Latest checkpoint state observed after the continuation. */
  restoredState: RestoredCheckpointState | null;
}

// ── Lease recovery ────────────────────────────────────────────────

export type LeaseRecoveryAction =
  | 'no_op'                // nothing expired
  | 'cleaned_expired'      // released expired leases without takeover
  | 'took_over'            // explicit takeover succeeded
  | 'takeover_refused'     // lease still live
  | 'failed';

export interface LeaseRecoveryOutcome {
  executionId: string;
  action: LeaseRecoveryAction;
  releasedLeaseIds: string[];
  takeoverWorkerId: string | null;
  newLeaseId: string | null;
  reason: string;
}

// ── Forensic analyzer ──────────────────────────────────────────────

export interface RecoveryForensicReport {
  executionId: string;
  /**
   * Best-effort window between the last successful checkpoint and the
   * recovery start. Null when the execution never crashed.
   */
  probableRecoveryBoundary: { startMs: number; endMs: number } | null;
  /** Per-checkpoint integrity assessment. */
  replayIntegrityAssessment: Array<{ checkpointId: string; integrityScore: number; reason: string }>;
  /** Recovery consistency score + diagnostic notes. */
  recoveryConsistencyAssessment: {
    score: number;
    matchedMutations: number;
    divergentMutations: number;
    notes: string[];
  };
  /** How many duplicate side-effects were suppressed during recovery. */
  duplicateSuppressionAssessment: {
    total: number;
    byClass: Record<string, number>;
  };
  /** Operator-readable single-line summary. */
  oneLine: string;
}

// ── Diagnostics snapshot ───────────────────────────────────────────

export interface DurableRecoveryLatencyBucket {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DurableRecoverySnapshot {
  snapshotAtIso: string;
  /** Total recovery attempts observed since reset. */
  recoveryAttempts: number;
  recoverySuccesses: number;
  recoveryFailures: number;
  /** Fraction 0..1; null when no attempts. */
  recoverySuccessRate: number | null;
  staleWorkerEvents: number;
  abandonedExecutionEvents: number;
  leaseTakeoverEvents: number;
  duplicateSuppressionEvents: number;
  checkpointRestoreLatency: DurableRecoveryLatencyBucket;
  replayContinuationLatency: DurableRecoveryLatencyBucket;
  leaseRecoveryLatency: DurableRecoveryLatencyBucket;
  recoveryFailuresByCode: Record<string, number>;
  /** Most-recent N recovery outcomes (oldest first). */
  recentRecoveryOutcomes: Array<{
    atIso: string;
    executionId: string;
    outcome: 'succeeded' | 'failed' | 'duplicate_suppressed' | 'already_completed';
    durationMs: number | null;
    detail: string | null;
  }>;
}
