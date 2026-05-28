/**
 * Phase 19D — ReplayContinuationEngine
 *
 * Wraps the existing ResumableWorkflowEngine + ExecutionIdempotencyGovernor
 * to provide deterministic replay continuation from the latest restored
 * checkpoint. Differences vs raw resumable engine:
 *
 *   - Idempotency-guarded step execution: each step runs through the
 *     governor so a replayed step with the same fingerprint reports
 *     `suppressed` instead of double-executing the side-effect.
 *   - Coalesced restoration: pulls the chain via CheckpointRestorationEngine,
 *     so corrupted chains fail loudly before any step runs.
 *   - Outcome telemetry: emits replay_continuation_success,
 *     replay_continuation_duplicate_suppressed, replay_continuation_failure
 *     so the diagnostics aggregator can compute success-rate trends.
 *
 * SCOPE: continuation orchestration ONLY. No new step types. No autonomous
 * loop. No queue fanout. The caller supplies steps; this engine decides
 * which ones to run and tracks suppressed duplicates.
 *
 * GUARANTEES:
 *   - At-most-once side-effect: any step with a `mutationFingerprint`
 *     supplied is dedup'd via the governor.
 *   - Already-completed short-circuit: a continuation on a completed
 *     execution returns outcome='already_completed' without invoking
 *     any step.
 *   - Failure isolation: a single failed step does NOT corrupt other
 *     completed checkpoints; the outcome reports the failed step id and
 *     the engine leaves the execution in a recoverable state.
 */

import {
  getDefaultResumableWorkflowEngine,
  type ResumableWorkflowEngine,
  type WorkflowStep,
} from '@/backend/services/threadRuntime/resumableWorkflowEngine';
import {
  getDefaultExecutionIdempotencyGovernor,
  type ExecutionIdempotencyGovernor,
} from '@/backend/services/threadRuntime/executionIdempotencyGovernor';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import {
  getDefaultCheckpointRestorationEngine,
  type CheckpointRestorationEngine,
} from './checkpointRestorationEngine';
import type {
  IdempotencyClass,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  ReplayContinuationOutcome,
  ReplayContinuationResult,
  RestoredCheckpointState,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type ReplayContinuationTelemetryEvent =
  | 'replay_continuation_success'
  | 'replay_continuation_duplicate_suppressed'
  | 'replay_continuation_failure';

export interface ReplayContinuationTelemetrySink {
  emit(event: ReplayContinuationTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ReplayContinuationTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'replay_continuation_failure') console.warn(`[replay_continuation] ${line}`);
      else console.log(`[replay_continuation] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Step shape with idempotency annotation ─────────────────────────

export interface ReplayableWorkflowStep<TCtx> extends WorkflowStep<TCtx> {
  /**
   * Optional idempotency fingerprint inputs. When provided, the step runs
   * through the idempotency governor — second invocation with the same
   * semantic payload returns 'suppressed' WITHOUT calling step.run().
   */
  idempotency?: {
    cls: IdempotencyClass;
    /** Semantic parts identifying the side-effect. */
    semanticParts: Array<string | number | boolean | null | undefined>;
  };
}

// ── Engine ──────────────────────────────────────────────────────────

export interface ReplayContinuationEngineOptions {
  workflowEngine?: ResumableWorkflowEngine;
  idempotencyGovernor?: ExecutionIdempotencyGovernor;
  checkpointRestorationEngine?: CheckpointRestorationEngine;
  coordinator?: DurableExecutionCoordinator;
  telemetry?: ReplayContinuationTelemetrySink;
}

export interface ReplayContinuationInput<TCtx> {
  executionId: string;
  steps: ReplayableWorkflowStep<TCtx>[];
  context: TCtx;
  /** When true, abort on first failed step. Default true. */
  failFast?: boolean;
}

export interface ReplayContinuationEngine {
  continue<TCtx>(input: ReplayContinuationInput<TCtx>): Promise<ReplayContinuationResult>;
}

export function createReplayContinuationEngine(
  options?: ReplayContinuationEngineOptions,
): ReplayContinuationEngine {
  const workflowEngine = options?.workflowEngine ?? getDefaultResumableWorkflowEngine();
  const governor = options?.idempotencyGovernor ?? getDefaultExecutionIdempotencyGovernor();
  const restoration = options?.checkpointRestorationEngine ?? getDefaultCheckpointRestorationEngine();
  const coordinator = options?.coordinator ?? getDefaultDurableExecutionCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;

  return {
    async continue<TCtx>(input: ReplayContinuationInput<TCtx>): Promise<ReplayContinuationResult> {
      const t0 = Date.now();

      // Fast-path: completed execution → no-op.
      const exec = await coordinator.get(input.executionId);
      if (!exec) {
        const result: ReplayContinuationResult = {
          executionId: input.executionId,
          outcome: 'failed',
          ranStepCount: 0,
          skippedStepCount: 0,
          duplicateSuppressions: 0,
          failureReason: 'execution_not_found',
          durationMs: Date.now() - t0,
          restoredState: null,
        };
        telemetry.emit('replay_continuation_failure', {
          executionId: input.executionId,
          reason: 'execution_not_found',
          durationMs: result.durationMs,
        });
        return result;
      }
      if (exec.executionStatus === 'completed') {
        const result: ReplayContinuationResult = {
          executionId: input.executionId,
          outcome: 'already_completed',
          ranStepCount: 0,
          skippedStepCount: input.steps.length,
          duplicateSuppressions: 0,
          failureReason: null,
          durationMs: Date.now() - t0,
          restoredState: null,
        };
        telemetry.emit('replay_continuation_success', {
          executionId: input.executionId,
          outcome: 'already_completed',
          durationMs: result.durationMs,
        });
        return result;
      }

      // Restore the checkpoint chain. Corrupted chains throw — surface as failure outcome.
      let restoredState: RestoredCheckpointState | null = null;
      try {
        restoredState = await restoration.restore(input.executionId);
      } catch (err) {
        const reason = (err as Error)?.message ?? 'restore_failed';
        const result: ReplayContinuationResult = {
          executionId: input.executionId,
          outcome: 'failed',
          ranStepCount: 0,
          skippedStepCount: 0,
          duplicateSuppressions: 0,
          failureReason: reason,
          durationMs: Date.now() - t0,
          restoredState: null,
        };
        telemetry.emit('replay_continuation_failure', {
          executionId: input.executionId, reason, stage: 'restore',
          durationMs: result.durationMs,
        });
        return result;
      }

      // Wrap each step with an idempotency guard if requested. The
      // workflow engine still owns checkpoint progression — the governor
      // only short-circuits the side-effect when a duplicate fingerprint
      // is detected. Suppressed steps still get checkpointed as "ran"
      // because semantically the work is done.
      let duplicateSuppressions = 0;
      const wrappedSteps: WorkflowStep<TCtx>[] = input.steps.map((step) => {
        if (!step.idempotency) return step;
        const idem = step.idempotency;
        return {
          id: step.id,
          phase: step.phase,
          async run(ctx: TCtx) {
            const result = await governor.exec(
              {
                executionId: input.executionId,
                cls: idem.cls,
                semanticParts: idem.semanticParts,
              },
              () => step.run(ctx),
            );
            if (result.outcome === 'suppressed') {
              duplicateSuppressions += 1;
              telemetry.emit('replay_continuation_duplicate_suppressed', {
                executionId: input.executionId,
                stepId: step.id,
                cls: idem.cls,
              });
            }
          },
        };
      });

      // Delegate to the resumable workflow engine. It handles
      // checkpointing, skip-on-completed, and transitions.
      let workflowResult;
      try {
        workflowResult = await workflowEngine.resume({
          executionId: input.executionId,
          steps: wrappedSteps,
          context: input.context,
          failFast: input.failFast ?? true,
        });
      } catch (err) {
        const reason = (err as Error)?.message ?? 'workflow_threw';
        const result: ReplayContinuationResult = {
          executionId: input.executionId,
          outcome: 'failed',
          ranStepCount: 0,
          skippedStepCount: 0,
          duplicateSuppressions,
          failureReason: reason,
          durationMs: Date.now() - t0,
          restoredState,
        };
        telemetry.emit('replay_continuation_failure', {
          executionId: input.executionId, reason, stage: 'workflow',
          durationMs: result.durationMs,
        });
        return result;
      }

      const failedCount = workflowResult.failedStepIds.length;
      let outcome: ReplayContinuationOutcome;
      let failureReason: string | null = null;
      if (failedCount > 0) {
        outcome = 'failed';
        failureReason = workflowResult.failedStepIds.map((f) => `${f.id}: ${f.reason}`).join('; ');
      } else if (duplicateSuppressions > 0 && workflowResult.ranStepIds.length === duplicateSuppressions) {
        // Every executed step turned out to be a duplicate-suppressed
        // no-op. Signal that to the caller — useful for replay diagnostics.
        outcome = 'duplicate_suppressed';
      } else {
        outcome = 'resumed';
      }

      const result: ReplayContinuationResult = {
        executionId: input.executionId,
        outcome,
        ranStepCount: workflowResult.ranStepIds.length,
        skippedStepCount: workflowResult.skippedStepIds.length,
        duplicateSuppressions,
        failureReason,
        durationMs: Date.now() - t0,
        restoredState,
      };

      if (outcome === 'failed') {
        telemetry.emit('replay_continuation_failure', {
          executionId: input.executionId,
          reason: failureReason,
          ranStepCount: result.ranStepCount,
          duplicateSuppressions: result.duplicateSuppressions,
          durationMs: result.durationMs,
        });
      } else {
        telemetry.emit('replay_continuation_success', {
          executionId: input.executionId,
          outcome,
          ranStepCount: result.ranStepCount,
          skippedStepCount: result.skippedStepCount,
          duplicateSuppressions: result.duplicateSuppressions,
          durationMs: result.durationMs,
        });
      }
      return result;
    },
  };
}

let _default: ReplayContinuationEngine | null = null;
export function getDefaultReplayContinuationEngine(): ReplayContinuationEngine {
  if (!_default) _default = createReplayContinuationEngine();
  return _default;
}
export function setDefaultReplayContinuationEngine(e: ReplayContinuationEngine): void {
  _default = e;
}
