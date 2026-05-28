/**
 * Phase 20D — DistributedExecutionRunner
 *
 * Bounded, deterministic poll-loop runner. Composes:
 *   - ExecutionClaimingEngine       (atomic ownership)
 *   - ExecutionRecoveryCoordinator  (replay continuation)
 *   - DistributedExecutionQueue     (ack + retry)
 *   - DistributedWorkerCoordinator  (active count)
 *
 * Each runner iteration:
 *   1. Asks the claiming engine for the next eligible queue entry.
 *   2. Runs the recovery coordinator against the executionId.
 *   3. Acks the queue entry as completed / failed based on the outcome.
 *
 * SCOPE: runner LOOP ONLY. The actual orchestration semantics are owned
 * by the recovery coordinator (Phase 19A) which dispatches steps via the
 * resumable workflow engine. This file is just the polling boundary.
 *
 * GUARANTEES:
 *   - Bounded concurrency: maxConcurrency cap; never exceeds.
 *   - Graceful cancellation: stop() flips a flag that the loop checks
 *     between iterations. In-flight work is allowed to finish.
 *   - Replay-safe continuation: failed executions are retried via the
 *     queue's standard backoff policy; the recovery coordinator's
 *     idempotency governor prevents duplicate side-effects.
 *   - Deterministic completion transitions: a successful recovery
 *     finalizes the execution; a 'no_action_needed' outcome (execution
 *     is healthy and not stale) acks the queue entry as completed and
 *     leaves the execution alone.
 *
 * DO NOT:
 *   - Spawn additional workers (out of scope; no autonomous scaling).
 *   - Mutate executions outside the coordinator path (replay safety).
 */

import {
  getDefaultExecutionClaimingEngine,
  type ExecutionClaimingEngine,
} from './executionClaimingEngine';
import {
  getDefaultExecutionRecoveryCoordinator,
  type ExecutionRecoveryCoordinator,
  type RecoveryExecutionResult,
} from '@/backend/services/orchestration/recovery/executionRecoveryCoordinator';
import {
  getDefaultExecutionQueue,
  type DistributedExecutionQueue,
} from './distributedExecutionQueue';
import {
  getDefaultDistributedWorkerCoordinator,
  type DistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import type {
  QueueEntry,
  QueueEntryKind,
  RunnerLoopReport,
} from './distributedTypes';
import type { ReplayableWorkflowStep } from '@/backend/services/orchestration/recovery/replayContinuationEngine';
import type {
  ExecutionRecord,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type { RestoredCheckpointState } from '@/backend/services/orchestration/recovery/recoveryTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RunnerTelemetryEvent =
  | 'runner_started'
  | 'runner_idle'
  | 'runner_iteration_completed'
  | 'runner_stopped';

export interface RunnerTelemetrySink {
  emit(event: RunnerTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RunnerTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      console.log(`[exec_runner] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Builder callbacks
// ────────────────────────────────────────────────────────────────────

export interface BuildStepsInput {
  execution: ExecutionRecord;
  restored: RestoredCheckpointState | null;
  queueEntry: QueueEntry;
}

export interface RunnerStepBuilders<TCtx> {
  buildSteps: (input: BuildStepsInput) => Promise<ReplayableWorkflowStep<TCtx>[]>;
  buildContext: (input: BuildStepsInput) => Promise<TCtx>;
}

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface RunnerStartInput<TCtx> {
  workerId: string;
  builders: RunnerStepBuilders<TCtx>;
  /** Optional queue filters. */
  kind?: QueueEntryKind;
  companyId?: string;
  /** Bounded concurrency. Default 4. */
  maxConcurrency?: number;
  /** Max iterations before yielding the loop (use 0 for unbounded). Default 200. */
  maxIterations?: number;
  /** Inter-iteration delay when no work is found. Default 250ms. */
  idleDelayMs?: number;
  /** Hard watchdog timeout for the whole loop. Default 0 = disabled. */
  maxDurationMs?: number;
  /** Visibility timeout for queue claims. Default 60s. */
  visibilityMs?: number;
  /** Lease duration. Default 60s. */
  leaseDurationMs?: number;
}

export interface DistributedExecutionRunner {
  /** Run a bounded poll loop. Resolves with a summary report when done. */
  runLoop<TCtx>(input: RunnerStartInput<TCtx>): Promise<RunnerLoopReport>;
  /** Request graceful stop. The current iteration finishes, then the loop exits. */
  stop(): void;
  /** True if a stop has been requested but not yet observed. */
  isStopRequested(): boolean;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface DistributedExecutionRunnerOptions {
  claimingEngine?: ExecutionClaimingEngine;
  recoveryCoordinator?: ExecutionRecoveryCoordinator;
  queue?: DistributedExecutionQueue;
  workerCoordinator?: DistributedWorkerCoordinator;
  telemetry?: RunnerTelemetrySink;
}

export function createDistributedExecutionRunner(
  options?: DistributedExecutionRunnerOptions,
): DistributedExecutionRunner {
  const claimEngine = options?.claimingEngine ?? getDefaultExecutionClaimingEngine();
  const recovery = options?.recoveryCoordinator ?? getDefaultExecutionRecoveryCoordinator();
  const queue = options?.queue ?? getDefaultExecutionQueue();
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  let stopRequested = false;

  function mapOutcomeToAck(result: RecoveryExecutionResult): {
    outcome: 'completed' | 'failed';
    failureReason: string | null;
  } {
    switch (result.status) {
      case 'recovered':
      case 'already_completed':
      case 'no_action_needed':
        return { outcome: 'completed', failureReason: null };
      case 'unrecoverable':
        return { outcome: 'failed', failureReason: result.details.join('; ') || 'unrecoverable' };
      case 'takeover_refused':
        return { outcome: 'failed', failureReason: 'takeover_refused' };
      case 'failed':
      default:
        return { outcome: 'failed', failureReason: result.details.join('; ') || 'failed' };
    }
  }

  return {
    async runLoop<TCtx>(input: RunnerStartInput<TCtx>): Promise<RunnerLoopReport> {
      stopRequested = false;
      const maxConcurrency = Math.max(1, Math.min(64, input.maxConcurrency ?? 4));
      const maxIterations = Math.max(0, input.maxIterations ?? 200);
      const idleDelayMs = Math.max(0, input.idleDelayMs ?? 250);
      const maxDurationMs = Math.max(0, input.maxDurationMs ?? 0);
      const startedAtIso = new Date().toISOString();
      const t0 = Date.now();
      let iterations = 0;
      let entriesClaimed = 0;
      let entriesCompleted = 0;
      let entriesFailed = 0;
      let entriesRetryScheduled = 0;
      let entriesDeadLettered = 0;
      let abortReason: string | null = null;
      const inflight = new Set<Promise<void>>();

      telemetry.emit('runner_started', {
        workerId: input.workerId, maxConcurrency, maxIterations,
      });

      async function processClaim(claim: { queueEntry: QueueEntry; ownership: import('./distributedTypes').ClaimOwnershipOutcome }) {
        entriesClaimed += 1;
        if (!claim.ownership.ok) {
          // Claim refused (e.g. execution missing or lease takeover refused).
          // Queue layer already handled the entry release.
          await workerCoord.noteExecutionFinished(input.workerId);
          return;
        }

        // Build steps + context for the recovery coordinator.
        const restored: RestoredCheckpointState | null = null; // recovery coord re-restores internally
        let steps: ReplayableWorkflowStep<TCtx>[] = [];
        let context: TCtx;
        try {
          steps = await input.builders.buildSteps({
            execution: claim.ownership.execution,
            restored, queueEntry: claim.queueEntry,
          });
          context = await input.builders.buildContext({
            execution: claim.ownership.execution,
            restored, queueEntry: claim.queueEntry,
          });
        } catch (err) {
          // Build failure → ack as failed; queue retry policy handles backoff.
          const reason = (err as Error)?.message ?? 'build_failed';
          await queue.ack({
            queueEntryId: claim.queueEntry.queueEntryId,
            workerId: input.workerId,
            outcome: 'failed', failureReason: reason,
          });
          await workerCoord.noteExecutionFinished(input.workerId);
          entriesFailed += 1;
          return;
        }

        // Drive the recovery coordinator. Recovery coordinator manages
        // lifecycle + lease release internally.
        const result = await recovery.recoverExecution<TCtx>({
          executionId: claim.queueEntry.executionId,
          workerId: input.workerId,
          steps, context,
          leaseDurationMs: input.leaseDurationMs,
        });

        const ackDecision = mapOutcomeToAck(result);
        const acked = await queue.ack({
          queueEntryId: claim.queueEntry.queueEntryId,
          workerId: input.workerId,
          outcome: ackDecision.outcome,
          failureReason: ackDecision.failureReason ?? undefined,
        });
        if (ackDecision.outcome === 'completed') entriesCompleted += 1;
        else entriesFailed += 1;
        if (acked?.status === 'queued') entriesRetryScheduled += 1;
        if (acked?.status === 'dead_lettered') entriesDeadLettered += 1;

        await workerCoord.noteExecutionFinished(input.workerId);
      }

      // ── Loop ──
      while (true) {
        if (stopRequested) { abortReason = 'stop_requested'; break; }
        if (maxIterations > 0 && iterations >= maxIterations) {
          abortReason = 'max_iterations';
          break;
        }
        if (maxDurationMs > 0 && Date.now() - t0 > maxDurationMs) {
          abortReason = 'max_duration';
          break;
        }
        if (inflight.size >= maxConcurrency) {
          // Wait for any in-flight to free a slot.
          await Promise.race(inflight);
          continue;
        }

        iterations += 1;

        // Attempt to claim.
        const claim = await claimEngine.claimNext({
          workerId: input.workerId,
          visibilityMs: input.visibilityMs,
          leaseDurationMs: input.leaseDurationMs,
          kind: input.kind, companyId: input.companyId,
        });

        if (!claim) {
          telemetry.emit('runner_idle', { workerId: input.workerId, iterations });
          // No work — wait + check stop again.
          if (idleDelayMs > 0) {
            await new Promise((r) => setTimeout(r, idleDelayMs));
          }
          // Heartbeat opportunistically.
          await workerCoord.heartbeat({ workerId: input.workerId });
          continue;
        }

        // Dispatch the claim into the inflight set.
        const p = processClaim(claim).catch(() => { /* swallow — counted above */ });
        inflight.add(p);
        // Remove from inflight on resolve to bound the set.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        p.then(() => inflight.delete(p));

        telemetry.emit('runner_iteration_completed', {
          workerId: input.workerId, iterations,
          entriesClaimed, inflight: inflight.size,
        });
      }

      // Drain in-flight before returning so the report is final.
      while (inflight.size > 0) {
        await Promise.race(inflight);
      }

      const completedAtIso = new Date().toISOString();
      const report: RunnerLoopReport = {
        startedAtIso, completedAtIso,
        durationMs: Date.now() - t0,
        iterations,
        entriesClaimed,
        entriesCompleted,
        entriesFailed,
        entriesRetryScheduled,
        entriesDeadLettered,
        abortReason,
      };
      telemetry.emit('runner_stopped', {
        workerId: input.workerId, report, abortReason,
      });
      return report;
    },

    stop() { stopRequested = true; },
    isStopRequested() { return stopRequested; },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: DistributedExecutionRunner | null = null;
export function getDefaultDistributedExecutionRunner(): DistributedExecutionRunner {
  if (!_default) _default = createDistributedExecutionRunner();
  return _default;
}
export function setDefaultDistributedExecutionRunner(r: DistributedExecutionRunner): void {
  _default = r;
}
