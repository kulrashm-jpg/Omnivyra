/**
 * Phase 3 — Execution checkpoint manager.
 *
 * Captures incremental orchestration progress as `ExecutionCheckpoint`
 * records so a crash-restart cycle can resume from the latest checkpoint
 * instead of re-running the whole orchestration.
 *
 * Each checkpoint is INCREMENTAL — it carries the delta from the prior
 * checkpoint via `completedNodeOperationIds` and `pendingNodeOperationIds`.
 * The resumable workflow engine (Phase 5) uses these lists to skip work
 * already done.
 *
 * Pure / deterministic.
 */

import type {
  ExecutionCheckpoint,
  OrchestrationPhase,
} from './threadRuntimeTypes';
import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from './executionStore';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ExecutionCheckpointManager {
  /**
   * Capture a checkpoint. The new checkpoint's `completedNodeOperationIds`
   * is the union of (prior completed) ∪ (new completed in this checkpoint).
   * `pendingNodeOperationIds` is the caller-supplied set MINUS anything
   * already completed.
   */
  capture(input: {
    executionId: string;
    phase: OrchestrationPhase;
    newlyCompleted?: string[];
    pending?: string[];
    pendingTopologyMutationIds?: string[];
    recoveryProgress?: Record<string, unknown> | null;
    replayContinuity?: Record<string, unknown> | null;
  }): Promise<ExecutionCheckpoint>;
  latest(executionId: string): Promise<ExecutionCheckpoint | null>;
  list(executionId: string): Promise<ExecutionCheckpoint[]>;
  /**
   * Restore-safe view: returns ALL completed operations + the most recent
   * pending set, ready for the resumable workflow engine to consume.
   */
  restoreView(executionId: string): Promise<{
    phase: OrchestrationPhase | null;
    completedNodeOperationIds: string[];
    pendingNodeOperationIds: string[];
    pendingTopologyMutationIds: string[];
    recoveryProgress: Record<string, unknown> | null;
    replayContinuity: Record<string, unknown> | null;
  }>;
}

export function createExecutionCheckpointManager(input?: { store?: ExecutionStore }): ExecutionCheckpointManager {
  const store = input?.store ?? getDefaultExecutionStore();

  return {
    async capture(c) {
      const prior = await store.listCheckpoints(c.executionId);
      const priorCompleted = new Set<string>();
      for (const p of prior) for (const id of p.completedNodeOperationIds) priorCompleted.add(id);
      // union with newly completed
      const completedSet = new Set(priorCompleted);
      for (const id of c.newlyCompleted ?? []) completedSet.add(id);
      // pending = caller-supplied minus anything in completedSet
      const pending = (c.pending ?? []).filter((id) => !completedSet.has(id));

      const cp: ExecutionCheckpoint = {
        checkpointId: newId('cp'),
        executionId: c.executionId,
        takenAt: new Date().toISOString(),
        phase: c.phase,
        completedNodeOperationIds: Array.from(completedSet),
        pendingNodeOperationIds: pending,
        pendingTopologyMutationIds: c.pendingTopologyMutationIds ?? [],
        recoveryProgress: c.recoveryProgress ?? null,
        replayContinuity: c.replayContinuity ?? null,
      };
      return store.recordCheckpoint(cp);
    },
    async latest(executionId) {
      const all = await store.listCheckpoints(executionId);
      if (all.length === 0) return null;
      return [...all].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    },
    async list(executionId) {
      return store.listCheckpoints(executionId);
    },
    async restoreView(executionId) {
      const all = await store.listCheckpoints(executionId);
      if (all.length === 0) {
        return {
          phase: null,
          completedNodeOperationIds: [],
          pendingNodeOperationIds: [],
          pendingTopologyMutationIds: [],
          recoveryProgress: null,
          replayContinuity: null,
        };
      }
      const sorted = [...all].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      const latest = sorted[sorted.length - 1];
      const completed = new Set<string>();
      for (const c of sorted) for (const id of c.completedNodeOperationIds) completed.add(id);
      const pending = latest.pendingNodeOperationIds.filter((id) => !completed.has(id));
      return {
        phase: latest.phase,
        completedNodeOperationIds: Array.from(completed),
        pendingNodeOperationIds: pending,
        pendingTopologyMutationIds: latest.pendingTopologyMutationIds,
        recoveryProgress: latest.recoveryProgress,
        replayContinuity: latest.replayContinuity,
      };
    },
  };
}

let _default: ExecutionCheckpointManager | null = null;
export function getDefaultExecutionCheckpointManager(): ExecutionCheckpointManager {
  if (!_default) _default = createExecutionCheckpointManager();
  return _default;
}
export function setDefaultExecutionCheckpointManager(m: ExecutionCheckpointManager): void {
  _default = m;
}
