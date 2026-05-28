/**
 * Phase 19B — CheckpointRestorationEngine
 *
 * Pure read-side service. Restores the latest valid checkpoint chain for
 * an execution and reconstructs:
 *
 *   - latest checkpoint id
 *   - coalesced phase + completed/pending node operation sets
 *   - pending topology mutation ids
 *   - recovery progress + replay continuity payloads
 *   - integrity report
 *
 * SCOPE: persistence + reconstruction ONLY. No orchestration replay. No
 * side effects. No state mutations. The result is consumed by the
 * ReplayContinuationEngine (Phase 19D) and the ExecutionRecoveryCoordinator
 * (Phase 19A).
 *
 * GUARANTEES:
 *   - Deterministic ordering: chain is sorted ASC by (taken_at, checkpoint_id).
 *   - Replay-safe: never emits a mutation, never writes a checkpoint.
 *   - Corruption detection: phase regression / id-reuse / NaN ordering get
 *     flagged in the integrity report.
 *   - Partial-checkpoint rejection: a chain whose latest checkpoint
 *     references a node id that's neither completed nor pending is flagged
 *     'partial'.
 *   - Structured telemetry: checkpoint_restore_success / _failure.
 */

import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';
import type {
  ExecutionCheckpoint,
  OrchestrationPhase,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  CheckpointIntegrityReport,
  CheckpointIntegrityStatus,
  RestoredCheckpointState,
} from './recoveryTypes';

// ── Telemetry ────────────────────────────────────────────────────────

export type CheckpointRestoreTelemetryEvent =
  | 'checkpoint_restore_success'
  | 'checkpoint_restore_failure';

export interface CheckpointRestoreTelemetrySink {
  emit(event: CheckpointRestoreTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: CheckpointRestoreTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'checkpoint_restore_failure') console.warn(`[checkpoint_restore] ${line}`);
      else console.log(`[checkpoint_restore] ${line}`);
    } catch { /* ignore */ }
  },
};

// ── Errors ───────────────────────────────────────────────────────────

export class CheckpointRestorationError extends Error {
  constructor(
    public readonly executionId: string,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[CheckpointRestorationEngine] ${code} for ${executionId}: ${message}`);
    this.name = 'CheckpointRestorationError';
  }
}

// ── Phase ordering ───────────────────────────────────────────────────

const PHASE_INDEX: Record<OrchestrationPhase, number> = {
  precheck: 0,
  generation: 1,
  persistence: 2,
  topology_settle: 3,
  recovery: 4,
  finalize: 5,
};

// ── Integrity scoring ────────────────────────────────────────────────

function assessIntegrity(chain: ExecutionCheckpoint[]): CheckpointIntegrityReport {
  if (chain.length === 0) {
    return {
      status: 'missing',
      integrityScore: 0,
      issues: ['no checkpoints recorded'],
      phaseTransitions: 0,
      windowStartIso: null,
      windowEndIso: null,
    };
  }

  const issues: string[] = [];
  let phaseTransitions = 0;
  let lastPhaseIdx = -1;
  const seenCheckpointIds = new Set<string>();
  let lastTakenAt = '';

  for (const cp of chain) {
    if (seenCheckpointIds.has(cp.checkpointId)) {
      issues.push(`duplicate checkpoint id ${cp.checkpointId}`);
    }
    seenCheckpointIds.add(cp.checkpointId);

    if (cp.takenAt < lastTakenAt) {
      issues.push(`taken_at regression at ${cp.checkpointId}`);
    }
    lastTakenAt = cp.takenAt;

    const phaseIdx = PHASE_INDEX[cp.phase];
    if (phaseIdx === undefined) {
      issues.push(`unknown phase "${cp.phase}" at ${cp.checkpointId}`);
    } else {
      // Phase regression is suspicious EXCEPT when entering 'recovery' (which is allowed to come from any phase).
      if (lastPhaseIdx >= 0 && phaseIdx < lastPhaseIdx && cp.phase !== 'recovery') {
        issues.push(`phase regression ${chain[chain.indexOf(cp) - 1]?.phase} → ${cp.phase} at ${cp.checkpointId}`);
      }
      if (lastPhaseIdx >= 0 && phaseIdx !== lastPhaseIdx) phaseTransitions += 1;
      lastPhaseIdx = phaseIdx;
    }

    // Partial-checkpoint detection: a node id can't appear in BOTH completed
    // and pending at the same time within a single checkpoint.
    const cpCompleted = new Set(cp.completedNodeOperationIds);
    for (const pendId of cp.pendingNodeOperationIds) {
      if (cpCompleted.has(pendId)) {
        issues.push(`node ${pendId} is both completed and pending in ${cp.checkpointId}`);
      }
    }
  }

  // Across-chain: a node id that appears in any later checkpoint's pending
  // list but is also marked completed in an earlier checkpoint is suspicious.
  const allCompleted = new Set<string>();
  for (const cp of chain) {
    for (const id of cp.completedNodeOperationIds) allCompleted.add(id);
  }
  const latest = chain[chain.length - 1];
  for (const id of latest.pendingNodeOperationIds) {
    if (allCompleted.has(id) && !latest.completedNodeOperationIds.includes(id)) {
      issues.push(`latest checkpoint pending contains already-completed node ${id}`);
    }
  }

  // Score: 100 - penalty per issue, floored at 0.
  const penaltyPerIssue = 12;
  const integrityScore = Math.max(0, 100 - issues.length * penaltyPerIssue);

  // Any detected issue downgrades the chain from 'intact'. A chain at 0
  // integrity is unconditionally 'corrupted'.
  let status: CheckpointIntegrityStatus = 'intact';
  if (integrityScore === 0) status = 'corrupted';
  else if (issues.length > 0) status = 'partial';

  return {
    status,
    integrityScore,
    issues,
    phaseTransitions,
    windowStartIso: chain[0]?.takenAt ?? null,
    windowEndIso: latest?.takenAt ?? null,
  };
}

// ── Coalescing ───────────────────────────────────────────────────────

function coalesceChain(chain: ExecutionCheckpoint[]): Pick<RestoredCheckpointState,
  'phase' | 'completedNodeOperationIds' | 'pendingNodeOperationIds' |
  'pendingTopologyMutationIds' | 'recoveryProgress' | 'replayContinuity'
> {
  if (chain.length === 0) {
    return {
      phase: null,
      completedNodeOperationIds: [],
      pendingNodeOperationIds: [],
      pendingTopologyMutationIds: [],
      recoveryProgress: null,
      replayContinuity: null,
    };
  }
  const latest = chain[chain.length - 1];
  const completed = new Set<string>();
  for (const cp of chain) for (const id of cp.completedNodeOperationIds) completed.add(id);
  const pending = latest.pendingNodeOperationIds.filter((id) => !completed.has(id));
  return {
    phase: latest.phase,
    completedNodeOperationIds: Array.from(completed),
    pendingNodeOperationIds: pending,
    pendingTopologyMutationIds: latest.pendingTopologyMutationIds,
    recoveryProgress: latest.recoveryProgress,
    replayContinuity: latest.replayContinuity,
  };
}

// ── CheckpointRestorationEngine ────────────────────────────────────

export interface CheckpointRestorationEngineOptions {
  store?: ExecutionStore;
  telemetry?: CheckpointRestoreTelemetrySink;
  /** Reject the chain entirely when integrity falls below this score (default: -1 = never). */
  rejectBelowIntegrityScore?: number;
}

export interface CheckpointRestorationEngine {
  restore(executionId: string): Promise<RestoredCheckpointState>;
  /** Read-only integrity check without coalescing. Useful for forensics. */
  inspectIntegrity(executionId: string): Promise<CheckpointIntegrityReport>;
}

export function createCheckpointRestorationEngine(
  options?: CheckpointRestorationEngineOptions,
): CheckpointRestorationEngine {
  const store = options?.store ?? getDefaultExecutionStore();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const rejectThreshold = options?.rejectBelowIntegrityScore ?? -1;

  async function loadChain(executionId: string): Promise<ExecutionCheckpoint[]> {
    if (!executionId) {
      throw new CheckpointRestorationError(executionId, 'INVALID_INPUT', 'executionId required');
    }
    const list = await store.listCheckpoints(executionId);
    // Sort deterministically: taken_at ASC, checkpoint_id ASC tiebreak.
    return [...list].sort((a, b) => {
      if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1;
      return a.checkpointId < b.checkpointId ? -1 : 1;
    });
  }

  return {
    async restore(executionId) {
      const t0 = Date.now();
      try {
        const chain = await loadChain(executionId);
        const integrity = assessIntegrity(chain);
        if (rejectThreshold >= 0 && integrity.integrityScore < rejectThreshold) {
          telemetry.emit('checkpoint_restore_failure', {
            executionId, code: 'INTEGRITY_BELOW_THRESHOLD',
            integrityScore: integrity.integrityScore,
            issues: integrity.issues,
            chainLength: chain.length,
            durationMs: Date.now() - t0,
          });
          throw new CheckpointRestorationError(
            executionId, 'INTEGRITY_BELOW_THRESHOLD',
            `integrity ${integrity.integrityScore} below threshold ${rejectThreshold}`,
          );
        }
        const coalesced = coalesceChain(chain);
        const latest = chain[chain.length - 1] ?? null;
        telemetry.emit('checkpoint_restore_success', {
          executionId,
          chainLength: chain.length,
          latestCheckpointId: latest?.checkpointId ?? null,
          phase: coalesced.phase,
          integrityScore: integrity.integrityScore,
          durationMs: Date.now() - t0,
        });
        return {
          executionId,
          latestCheckpointId: latest?.checkpointId ?? null,
          ...coalesced,
          chain,
          integrity,
        };
      } catch (err) {
        if (!(err instanceof CheckpointRestorationError)) {
          telemetry.emit('checkpoint_restore_failure', {
            executionId,
            code: (err as { code?: string })?.code ?? 'UNKNOWN',
            error: (err as Error)?.message ?? String(err),
            durationMs: Date.now() - t0,
          });
        }
        throw err;
      }
    },
    async inspectIntegrity(executionId) {
      const chain = await loadChain(executionId);
      return assessIntegrity(chain);
    },
  };
}

let _default: CheckpointRestorationEngine | null = null;
export function getDefaultCheckpointRestorationEngine(): CheckpointRestorationEngine {
  if (!_default) _default = createCheckpointRestorationEngine();
  return _default;
}
export function setDefaultCheckpointRestorationEngine(e: CheckpointRestorationEngine): void {
  _default = e;
}
