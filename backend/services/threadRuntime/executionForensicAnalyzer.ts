/**
 * Phase 9 — Execution forensic analyzer.
 *
 * Given an execution record + its checkpoints + its idempotency state +
 * (optionally) a canonical "successful run" reference, produces an
 * `ExecutionForensicReport` covering:
 *   - probable failure boundary (when did the crash happen?)
 *   - per-checkpoint integrity assessment
 *   - recovery consistency vs the canonical run
 *   - duplicate suppression count
 */

import type {
  ExecutionCheckpoint,
  ExecutionForensicReport,
  ExecutionRecord,
  IdempotencyFingerprint,
} from './threadRuntimeTypes';
import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from './executionStore';
import {
  getDefaultExecutionIdempotencyGovernor,
  type ExecutionIdempotencyGovernor,
} from './executionIdempotencyGovernor';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface AnalyzeExecutionForensicsInput {
  executionId: string;
  /** Optional canonical successful run (its completed operation ids) to
   *  compare against. */
  canonicalCompletedOperationIds?: string[];
  store?: ExecutionStore;
  idempotencyGovernor?: ExecutionIdempotencyGovernor;
}

export async function analyzeExecutionForensics(input: AnalyzeExecutionForensicsInput): Promise<ExecutionForensicReport> {
  const store = input.store ?? getDefaultExecutionStore();
  const idem = input.idempotencyGovernor ?? getDefaultExecutionIdempotencyGovernor();

  const exec = await store.getExecution(input.executionId);
  if (!exec) throw new Error(`execution not found: ${input.executionId}`);

  const checkpoints = (await store.listCheckpoints(input.executionId))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const fingerprints = await idem.listForExecution(input.executionId);

  // ── Probable failure boundary ──────────────────────────────────────
  // If status is failed/abandoned: window = [lastHeartbeat, completedAt].
  // If multiple checkpoints exist: window narrows to [lastCheckpoint, completedAt].
  let probableFailureBoundary: ExecutionForensicReport['probableFailureBoundary'] = null;
  if ((exec.executionStatus === 'failed' || exec.executionStatus === 'abandoned')
      && exec.completedAt) {
    const startMs = checkpoints.length > 0
      ? Date.parse(checkpoints[checkpoints.length - 1].takenAt)
      : exec.heartbeatAt ? Date.parse(exec.heartbeatAt) : Date.parse(exec.startedAt);
    const endMs = Date.parse(exec.completedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      probableFailureBoundary = { startMs, endMs };
    }
  }

  // ── Per-checkpoint integrity assessment ───────────────────────────
  const replayIntegrityAssessment = checkpoints.map((cp) => assessCheckpointIntegrity(cp));

  // ── Recovery consistency vs canonical run ─────────────────────────
  const latestCp = checkpoints[checkpoints.length - 1];
  const recoveredCompleted = new Set(latestCp?.completedNodeOperationIds ?? []);
  const canonical = new Set(input.canonicalCompletedOperationIds ?? []);
  const matchedMutations = canonical.size === 0
    ? recoveredCompleted.size
    : Array.from(canonical).filter((id) => recoveredCompleted.has(id)).length;
  const divergentMutations = canonical.size === 0
    ? 0
    : Array.from(canonical).filter((id) => !recoveredCompleted.has(id)).length
      + Array.from(recoveredCompleted).filter((id) => !canonical.has(id)).length;
  const recoveryConsistencyAssessment: ExecutionForensicReport['recoveryConsistencyAssessment'] = {
    score: canonical.size === 0
      ? clamp100(exec.executionStatus === 'completed' ? 100 : 60)
      : clamp100((matchedMutations / Math.max(1, canonical.size)) * 100 - divergentMutations * 10),
    matchedMutations,
    divergentMutations,
    notes: buildConsistencyNotes(exec, canonical.size, matchedMutations, divergentMutations),
  };

  const duplicateSuppressionEvents = fingerprints.reduce((sum, f) => sum + f.suppressedCount, 0);

  return {
    executionId: input.executionId,
    probableFailureBoundary,
    replayIntegrityAssessment,
    recoveryConsistencyAssessment,
    duplicateSuppressionEvents,
  };
}

function assessCheckpointIntegrity(cp: ExecutionCheckpoint): { checkpointId: string; integrityScore: number; reason: string } {
  // Integrity heuristics:
  //   - duplicates in completedNodeOperationIds: bad (deduped at capture time, but defensive check)
  //   - pending intersection with completed: bad
  //   - empty checkpoint with non-precheck phase: suspicious
  const completedSet = new Set(cp.completedNodeOperationIds);
  const completedDupes = cp.completedNodeOperationIds.length - completedSet.size;
  const pendingOverlap = cp.pendingNodeOperationIds.filter((id) => completedSet.has(id)).length;
  let score = 100;
  let reason = 'clean';
  if (completedDupes > 0) {
    score -= 25;
    reason = `${completedDupes} duplicate completed ids`;
  }
  if (pendingOverlap > 0) {
    score -= 30;
    reason = `${pendingOverlap} pending ids also in completed set`;
  }
  if (cp.phase !== 'precheck' && cp.completedNodeOperationIds.length === 0 && cp.pendingNodeOperationIds.length === 0) {
    score -= 15;
    reason = `empty checkpoint at phase ${cp.phase}`;
  }
  return { checkpointId: cp.checkpointId, integrityScore: clamp100(score), reason };
}

function buildConsistencyNotes(exec: ExecutionRecord, canonicalSize: number, matched: number, divergent: number): string[] {
  const out: string[] = [];
  out.push(`execution status: ${exec.executionStatus}`);
  out.push(`retry count: ${exec.retryCount}`);
  if (canonicalSize > 0) {
    out.push(`matched ${matched}/${canonicalSize} canonical mutations`);
    if (divergent > 0) out.push(`${divergent} divergent mutations vs canonical`);
  } else {
    out.push('no canonical reference supplied — consistency score is best-effort');
  }
  return out;
}
