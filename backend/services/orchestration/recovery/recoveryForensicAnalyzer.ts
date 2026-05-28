/**
 * Phase 19G — RecoveryForensicAnalyzer
 *
 * Pure read-side analysis. Reconstructs the recovery timeline of a single
 * execution from the durable data layer (executions + checkpoints +
 * idempotency fingerprints) and produces a structured
 * `RecoveryForensicReport`.
 *
 * Capabilities (per spec):
 *   - probableRecoveryBoundary       — last successful checkpoint → recovery start
 *   - replayIntegrityAssessment      — per-checkpoint integrity score
 *   - recoveryConsistencyAssessment  — recovered vs canonical mutation overlap
 *   - duplicateSuppressionAssessment — total + per-class suppression count
 *
 * SCOPE: forensic READ ONLY. No mutations. No autonomous remediation. No
 * orchestration semantics. The output is consumed by operator dashboards
 * and stress harnesses to verify recovery determinism after the fact.
 */

import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from '@/backend/services/threadRuntime/executionStore';
import {
  getDefaultExecutionIdempotencyGovernor,
  type ExecutionIdempotencyGovernor,
} from '@/backend/services/threadRuntime/executionIdempotencyGovernor';
import {
  getDefaultCheckpointRestorationEngine,
  type CheckpointRestorationEngine,
} from './checkpointRestorationEngine';
import type {
  ExecutionCheckpoint,
  IdempotencyClass,
  IdempotencyFingerprint,
} from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type {
  RecoveryForensicReport,
} from './recoveryTypes';

// ── Analyzer ────────────────────────────────────────────────────────

export interface RecoveryForensicAnalyzerOptions {
  store?: ExecutionStore;
  restoration?: CheckpointRestorationEngine;
  idempotencyGovernor?: ExecutionIdempotencyGovernor;
}

export interface RecoveryForensicAnalyzer {
  analyze(input: { executionId: string }): Promise<RecoveryForensicReport>;
  /**
   * Compare two executions (canonical vs recovered) and produce a
   * consistency score based on overlap of checkpoint mutations.
   */
  compareRuns(input: {
    canonicalExecutionId: string;
    recoveredExecutionId: string;
  }): Promise<{
    score: number;
    matchedMutations: number;
    divergentMutations: number;
    notes: string[];
  }>;
}

export function createRecoveryForensicAnalyzer(
  options?: RecoveryForensicAnalyzerOptions,
): RecoveryForensicAnalyzer {
  const store = options?.store ?? getDefaultExecutionStore();
  const restoration = options?.restoration ?? getDefaultCheckpointRestorationEngine();
  const governor = options?.idempotencyGovernor ?? getDefaultExecutionIdempotencyGovernor();

  /**
   * The "recovery boundary" is the window between the last checkpoint
   * taken in a non-recovery phase and the first checkpoint taken in
   * the recovery phase. If the execution never entered recovery (no
   * checkpoint with phase='recovery'), the boundary is null.
   */
  function findRecoveryBoundary(chain: ExecutionCheckpoint[]): { startMs: number; endMs: number } | null {
    let lastNonRecoveryMs: number | null = null;
    let firstRecoveryMs: number | null = null;
    for (const cp of chain) {
      const ms = Date.parse(cp.takenAt);
      if (!Number.isFinite(ms)) continue;
      if (cp.phase === 'recovery') {
        if (firstRecoveryMs === null) firstRecoveryMs = ms;
      } else {
        if (firstRecoveryMs === null) lastNonRecoveryMs = ms;
      }
    }
    if (firstRecoveryMs === null) return null;
    const startMs = lastNonRecoveryMs ?? firstRecoveryMs;
    return { startMs, endMs: firstRecoveryMs };
  }

  function assessCheckpointIntegrity(cp: ExecutionCheckpoint): { score: number; reason: string } {
    const completedSet = new Set(cp.completedNodeOperationIds);
    const overlap = cp.pendingNodeOperationIds.filter((id) => completedSet.has(id));
    const reasons: string[] = [];
    let score = 100;
    if (overlap.length > 0) {
      score -= 30;
      reasons.push(`${overlap.length} node ids in both completed and pending`);
    }
    if (cp.pendingNodeOperationIds.length === 0 && cp.completedNodeOperationIds.length === 0) {
      // Empty checkpoint — only meaningful in the precheck phase.
      if (cp.phase !== 'precheck') {
        score -= 20;
        reasons.push('non-precheck checkpoint with no node operations');
      }
    }
    return {
      score: Math.max(0, Math.min(100, score)),
      reason: reasons.length === 0 ? 'ok' : reasons.join('; '),
    };
  }

  function bucketSuppressions(list: IdempotencyFingerprint[]): {
    total: number;
    byClass: Record<string, number>;
  } {
    const byClass: Record<string, number> = {};
    let total = 0;
    for (const f of list) {
      total += f.suppressedCount;
      byClass[f.cls] = (byClass[f.cls] ?? 0) + f.suppressedCount;
    }
    return { total, byClass };
  }

  return {
    async analyze({ executionId }) {
      const exec = await store.getExecution(executionId);
      if (!exec) {
        const empty: RecoveryForensicReport = {
          executionId,
          probableRecoveryBoundary: null,
          replayIntegrityAssessment: [],
          recoveryConsistencyAssessment: {
            score: 0, matchedMutations: 0, divergentMutations: 0,
            notes: ['execution not found'],
          },
          duplicateSuppressionAssessment: { total: 0, byClass: {} },
          oneLine: `${executionId}: not found`,
        };
        return empty;
      }

      const restored = await restoration.restore(executionId);
      const chain = restored.chain;

      const boundary = findRecoveryBoundary(chain);
      const integrityAssessment = chain.map((cp) => {
        const a = assessCheckpointIntegrity(cp);
        return { checkpointId: cp.checkpointId, integrityScore: a.score, reason: a.reason };
      });

      const fingerprints = await governor.listForExecution(executionId);
      const duplicateAssessment = bucketSuppressions(fingerprints);

      // Recovery consistency for a single-run analyze() is a self-test:
      // count mutations that completed without divergence vs failed.
      const completed = restored.completedNodeOperationIds.length;
      const pending = restored.pendingNodeOperationIds.length;
      const score = completed + pending === 0
        ? 100
        : Math.round((completed / (completed + pending)) * 100);
      const consistencyNotes: string[] = [];
      consistencyNotes.push(`completed=${completed}, pending=${pending}, phase=${restored.phase ?? '∅'}`);
      if (boundary) {
        consistencyNotes.push(`recovery window ${new Date(boundary.startMs).toISOString()} → ${new Date(boundary.endMs).toISOString()}`);
      }
      if (duplicateAssessment.total > 0) {
        consistencyNotes.push(`duplicate suppressions: ${duplicateAssessment.total}`);
      }

      const oneLine = `${executionId}: status=${exec.executionStatus} retries=${exec.retryCount} ` +
        `chain=${chain.length} integrity=${restored.integrity.integrityScore}/100 ` +
        `suppressions=${duplicateAssessment.total} ` +
        `boundary=${boundary ? 'yes' : 'no'}`;

      return {
        executionId,
        probableRecoveryBoundary: boundary,
        replayIntegrityAssessment: integrityAssessment,
        recoveryConsistencyAssessment: {
          score,
          matchedMutations: completed,
          divergentMutations: 0, // single-run analyze has no canonical reference
          notes: consistencyNotes,
        },
        duplicateSuppressionAssessment: duplicateAssessment,
        oneLine,
      };
    },

    async compareRuns({ canonicalExecutionId, recoveredExecutionId }) {
      const [canonical, recovered] = await Promise.all([
        restoration.restore(canonicalExecutionId),
        restoration.restore(recoveredExecutionId),
      ]);
      const canonicalSet = new Set<string>(canonical.completedNodeOperationIds);
      const recoveredSet = new Set<string>(recovered.completedNodeOperationIds);
      let matched = 0;
      let divergent = 0;
      const notes: string[] = [];

      for (const id of recoveredSet) {
        if (canonicalSet.has(id)) matched += 1;
        else divergent += 1;
      }
      const canonicalMissing: string[] = [];
      for (const id of canonicalSet) {
        if (!recoveredSet.has(id)) canonicalMissing.push(id);
      }
      if (canonicalMissing.length > 0) {
        notes.push(`recovered run missing ${canonicalMissing.length} canonical mutations`);
        divergent += canonicalMissing.length;
      }

      const total = matched + divergent;
      const score = total === 0 ? 100 : Math.round((matched / total) * 100);
      notes.unshift(`matched=${matched}, divergent=${divergent}, score=${score}`);
      return { score, matchedMutations: matched, divergentMutations: divergent, notes };
    },
  };
}

let _default: RecoveryForensicAnalyzer | null = null;
export function getDefaultRecoveryForensicAnalyzer(): RecoveryForensicAnalyzer {
  if (!_default) _default = createRecoveryForensicAnalyzer();
  return _default;
}
export function setDefaultRecoveryForensicAnalyzer(a: RecoveryForensicAnalyzer): void {
  _default = a;
}

// Helper export for tests
export function _bucketSuppressionsByClass(list: IdempotencyFingerprint[]): Record<IdempotencyClass, number> {
  const result: Record<string, number> = {};
  for (const f of list) {
    result[f.cls] = (result[f.cls] ?? 0) + f.suppressedCount;
  }
  return result as Record<IdempotencyClass, number>;
}
