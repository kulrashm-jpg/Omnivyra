/**
 * Phase 6 — Deterministic recovery coordinator.
 *
 * Routes a failed / abandoned execution into a recovery flow that:
 *   1. Acquires a fresh lease (takes over from a stale owner).
 *   2. Restores the latest checkpoint via ExecutionCheckpointManager.
 *   3. Replays only the PENDING steps, guarded by the idempotency
 *      governor so any side-effect already done is skipped.
 *   4. Records a structured `RecoveryDeterminismResult` summarizing the
 *      number of duplicate mutations suppressed, partial topology fixes,
 *      and divergent replays detected.
 *
 * The recovery itself is delegated to the resumable workflow engine —
 * this coordinator's job is to set up the recovery scope, then evaluate
 * the determinism of the resulting run.
 */

import type {
  ExecutionRecord,
  RecoveryDeterminismResult,
  IdempotencyFingerprint,
} from './threadRuntimeTypes';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from './durableExecutionCoordinator';
import {
  getDefaultExecutionLeaseGovernor,
  type ExecutionLeaseGovernor,
} from './executionLeaseGovernor';
import {
  getDefaultExecutionCheckpointManager,
  type ExecutionCheckpointManager,
} from './executionCheckpointManager';
import {
  getDefaultExecutionIdempotencyGovernor,
  type ExecutionIdempotencyGovernor,
} from './executionIdempotencyGovernor';
import {
  getDefaultResumableWorkflowEngine,
  type ResumableWorkflowEngine,
  type WorkflowStep,
} from './resumableWorkflowEngine';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface DeterministicRecoveryCoordinator {
  recover<TCtx>(input: {
    executionId: string;
    workerId: string;
    steps: WorkflowStep<TCtx>[];
    context: TCtx;
    leaseDurationMs?: number;
  }): Promise<{ execution: ExecutionRecord; determinism: RecoveryDeterminismResult }>;
}

export interface DeterministicRecoveryCoordinatorOptions {
  coordinator?: DurableExecutionCoordinator;
  leaseGovernor?: ExecutionLeaseGovernor;
  checkpointManager?: ExecutionCheckpointManager;
  idempotencyGovernor?: ExecutionIdempotencyGovernor;
  workflowEngine?: ResumableWorkflowEngine;
  /** Default 60s; tune up for slow recoveries. */
  defaultLeaseDurationMs?: number;
}

export function createDeterministicRecoveryCoordinator(options?: DeterministicRecoveryCoordinatorOptions): DeterministicRecoveryCoordinator {
  const coordinator = options?.coordinator ?? getDefaultDurableExecutionCoordinator();
  const leaseGovernor = options?.leaseGovernor ?? getDefaultExecutionLeaseGovernor();
  const checkpointManager = options?.checkpointManager ?? getDefaultExecutionCheckpointManager();
  const idempotencyGovernor = options?.idempotencyGovernor ?? getDefaultExecutionIdempotencyGovernor();
  const workflowEngine = options?.workflowEngine ?? getDefaultResumableWorkflowEngine();
  const leaseDur = options?.defaultLeaseDurationMs ?? 60_000;

  return {
    async recover(input) {
      const exec = await coordinator.get(input.executionId);
      if (!exec) throw new Error(`execution not found: ${input.executionId}`);

      // Acquire a fresh lease via takeover.
      const claim = await leaseGovernor.claimWithTakeover({
        executionId: input.executionId,
        workerId: input.workerId,
        durationMs: input.leaseDurationMs ?? leaseDur,
      });
      if (claim.ok === false) {
        throw new Error(`could not acquire lease for ${input.executionId}: ${claim.reason}`);
      }

      // Transition into 'recovering' (if not already).
      let working = exec;
      if (exec.executionStatus !== 'recovering') {
        if (exec.executionStatus === 'completed') {
          // Nothing to do; report perfect determinism.
          await leaseGovernor.release(claim.lease.leaseId);
          return {
            execution: exec,
            determinism: {
              recoveryDeterminismScore: 100,
              duplicateMutationSuppressions: 0,
              duplicateInsertionsSuppressed: 0,
              duplicateBillingsSuppressed: 0,
              partialTopologyReconciliations: 0,
              divergentReplaysDetected: 0,
              details: ['execution already completed; recovery is no-op'],
            },
          };
        }
        working = await coordinator.transition({ executionId: input.executionId, to: 'recovering' });
      }
      void working;

      // Snapshot idempotency state BEFORE the recovery run.
      const beforeFingerprints = await idempotencyGovernor.listForExecution(input.executionId);
      const beforeSuppressionTotal = beforeFingerprints.reduce((sum, f) => sum + f.suppressedCount, 0);

      // Resume the workflow. The resumable engine will skip completed steps
      // via the checkpoint; idempotency governor guards individual mutations
      // inside each step.
      const result = await workflowEngine.resume({
        executionId: input.executionId,
        steps: input.steps,
        context: input.context,
      });

      // Snapshot idempotency state AFTER.
      const afterFingerprints = await idempotencyGovernor.listForExecution(input.executionId);
      const afterSuppressionTotal = afterFingerprints.reduce((sum, f) => sum + f.suppressedCount, 0);
      const suppressionDelta = Math.max(0, afterSuppressionTotal - beforeSuppressionTotal);

      const duplicateInsertionsSuppressed = countSuppressedByClass(afterFingerprints, 'node_insert')
        - countSuppressedByClass(beforeFingerprints, 'node_insert');
      const duplicateBillingsSuppressed = countSuppressedByClass(afterFingerprints, 'billing')
        - countSuppressedByClass(beforeFingerprints, 'billing');
      const duplicateMutationSuppressions = countSuppressedByClass(afterFingerprints, 'topology_mutation')
        - countSuppressedByClass(beforeFingerprints, 'topology_mutation');

      // Heuristics:
      //   - partial topology reconciliations = number of pending topology
      //     mutation ids resolved by this recovery run.
      const restored = await checkpointManager.restoreView(input.executionId);
      const partialTopologyReconciliations = restored.pendingTopologyMutationIds.length;

      // Divergent replay detection: if the workflow produced any failed step
      // ids after the recovery, that's divergence.
      const divergentReplaysDetected = result.failedStepIds.length;

      // Recovery determinism score: penalize divergence + partial mutations.
      // High suppression count is GOOD (proves idempotency working).
      const determinismScore = clamp100(
        100
        - divergentReplaysDetected * 15
        - Math.max(0, partialTopologyReconciliations - 2) * 5,
      );

      const details: string[] = [];
      details.push(`steps: ran=${result.ranStepIds.length}, skipped=${result.skippedStepIds.length}, failed=${result.failedStepIds.length}`);
      details.push(`suppressions during recovery: ${suppressionDelta}`);
      if (claim.tookOverFrom) details.push(`took over from worker ${claim.tookOverFrom}`);

      // Final lifecycle move based on outcome.
      if (result.completed) {
        // Workflow engine already moved it to 'completed'.
      } else if (divergentReplaysDetected > 0) {
        await coordinator.transition({
          executionId: input.executionId,
          to: 'failed',
          failureReason: `divergent replay: ${result.failedStepIds.map((f) => f.id).join(', ')}`,
        });
      }
      await leaseGovernor.release(claim.lease.leaseId);

      const finalExec = await coordinator.get(input.executionId);
      return {
        execution: finalExec!,
        determinism: {
          recoveryDeterminismScore: determinismScore,
          duplicateMutationSuppressions,
          duplicateInsertionsSuppressed,
          duplicateBillingsSuppressed,
          partialTopologyReconciliations,
          divergentReplaysDetected,
          details,
        },
      };
    },
  };
}

function countSuppressedByClass(list: IdempotencyFingerprint[], cls: IdempotencyFingerprint['cls']): number {
  return list.filter((f) => f.cls === cls).reduce((sum, f) => sum + f.suppressedCount, 0);
}

let _default: DeterministicRecoveryCoordinator | null = null;
export function getDefaultDeterministicRecoveryCoordinator(): DeterministicRecoveryCoordinator {
  if (!_default) _default = createDeterministicRecoveryCoordinator();
  return _default;
}
export function setDefaultDeterministicRecoveryCoordinator(c: DeterministicRecoveryCoordinator): void {
  _default = c;
}
