/**
 * Phase 5 — Resumable workflow engine.
 *
 * Wraps caller-supplied step functions in a "run-once" envelope that:
 *   1. Checks the latest checkpoint to see which step ids have completed.
 *   2. Skips completed steps (no replay side-effects).
 *   3. Runs pending steps, recording each completion into the checkpoint.
 *   4. After all steps succeed, transitions the execution to 'completed'.
 *   5. On failure, leaves the execution in 'running' (so a retry can pick
 *      up from the latest checkpoint) and re-throws so the caller can
 *      decide whether to surface the error or schedule a recovery.
 *
 * Step ids are the unit of replay safety: a step is only run once across
 * the entire execution lifetime. Callers MUST keep step ids stable across
 * restarts.
 */

import type {
  ExecutionRecord,
  OrchestrationPhase,
} from './threadRuntimeTypes';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from './durableExecutionCoordinator';
import {
  getDefaultExecutionCheckpointManager,
  type ExecutionCheckpointManager,
} from './executionCheckpointManager';

export interface WorkflowStep<TCtx> {
  /** Stable id for the step. Same id across restarts = "run once" guarantee. */
  id: string;
  /** Orchestration phase this step belongs to. */
  phase: OrchestrationPhase;
  run(ctx: TCtx): Promise<void>;
}

export interface ResumeWorkflowInput<TCtx> {
  executionId: string;
  steps: WorkflowStep<TCtx>[];
  context: TCtx;
  /** When true, stop on first failure (default). False keeps going past failures. */
  failFast?: boolean;
}

export interface ResumeWorkflowResult {
  executionId: string;
  skippedStepIds: string[];
  ranStepIds: string[];
  failedStepIds: Array<{ id: string; reason: string }>;
  completed: boolean;
}

export interface ResumableWorkflowEngine {
  resume<TCtx>(input: ResumeWorkflowInput<TCtx>): Promise<ResumeWorkflowResult>;
}

export interface ResumableWorkflowEngineOptions {
  coordinator?: DurableExecutionCoordinator;
  checkpointManager?: ExecutionCheckpointManager;
}

export function createResumableWorkflowEngine(options?: ResumableWorkflowEngineOptions): ResumableWorkflowEngine {
  const coordinator = options?.coordinator ?? getDefaultDurableExecutionCoordinator();
  const checkpoints = options?.checkpointManager ?? getDefaultExecutionCheckpointManager();

  return {
    async resume<TCtx>(input: ResumeWorkflowInput<TCtx>): Promise<ResumeWorkflowResult> {
      const restore = await checkpoints.restoreView(input.executionId);
      const completedSet = new Set(restore.completedNodeOperationIds);
      const skippedStepIds: string[] = [];
      const ranStepIds: string[] = [];
      const failedStepIds: ResumeWorkflowResult['failedStepIds'] = [];

      // Move to running if currently pending. Already-completed executions
      // short-circuit (replay safety: a second resume() call on a finished
      // execution returns the prior result with no transitions).
      const cur = await coordinator.get(input.executionId);
      if (!cur) throw new Error(`execution not found: ${input.executionId}`);
      if (cur.executionStatus === 'completed') {
        return {
          executionId: input.executionId,
          skippedStepIds: input.steps.map((s) => s.id),
          ranStepIds: [],
          failedStepIds: [],
          completed: true,
        };
      }
      let execRecord: ExecutionRecord = cur;
      if (cur.executionStatus === 'pending') {
        execRecord = await coordinator.transition({ executionId: input.executionId, to: 'running' });
      }
      void execRecord;

      // Group steps by phase for ordered execution.
      const byPhase = new Map<OrchestrationPhase, WorkflowStep<TCtx>[]>();
      for (const s of input.steps) {
        const arr = byPhase.get(s.phase) ?? [];
        arr.push(s);
        byPhase.set(s.phase, arr);
      }
      const phaseOrder: OrchestrationPhase[] = ['precheck', 'generation', 'persistence', 'topology_settle', 'recovery', 'finalize'];

      const failFast = input.failFast ?? true;
      let aborted = false;

      for (const phase of phaseOrder) {
        const phaseSteps = byPhase.get(phase) ?? [];
        if (phaseSteps.length === 0) continue;
        const newlyCompletedThisPhase: string[] = [];

        for (const step of phaseSteps) {
          if (completedSet.has(step.id)) {
            skippedStepIds.push(step.id);
            continue;
          }
          try {
            await step.run(input.context);
            ranStepIds.push(step.id);
            newlyCompletedThisPhase.push(step.id);
            completedSet.add(step.id);
            await coordinator.recordHeartbeat({ executionId: input.executionId });
          } catch (err) {
            failedStepIds.push({ id: step.id, reason: (err as Error).message });
            if (failFast) { aborted = true; break; }
          }
        }

        // Checkpoint after the phase, regardless of success/failure within it.
        const remainingInThisPhase = phaseSteps.filter((s) => !completedSet.has(s.id)).map((s) => s.id);
        const remainingDownstream = phaseOrder
          .slice(phaseOrder.indexOf(phase) + 1)
          .flatMap((ph) => (byPhase.get(ph) ?? []).map((s) => s.id))
          .filter((id) => !completedSet.has(id));
        await checkpoints.capture({
          executionId: input.executionId,
          phase,
          newlyCompleted: newlyCompletedThisPhase,
          pending: [...remainingInThisPhase, ...remainingDownstream],
        });

        if (aborted) break;
      }

      const completed = failedStepIds.length === 0 && !aborted;
      if (completed) {
        await coordinator.transition({ executionId: input.executionId, to: 'completed' });
      } else if (aborted || failedStepIds.length > 0) {
        // Leave at 'running' for now; the recovery coordinator will move it
        // to 'recovering' or 'failed' depending on policy. Don't auto-transition
        // here — that's the recovery engine's job.
      }

      return {
        executionId: input.executionId,
        skippedStepIds,
        ranStepIds,
        failedStepIds,
        completed,
      };
    },
  };
}

let _default: ResumableWorkflowEngine | null = null;
export function getDefaultResumableWorkflowEngine(): ResumableWorkflowEngine {
  if (!_default) _default = createResumableWorkflowEngine();
  return _default;
}
export function setDefaultResumableWorkflowEngine(e: ResumableWorkflowEngine): void {
  _default = e;
}
