/**
 * Phase 11 — Durable execution diagnostics aggregator.
 *
 * Periodic in-memory aggregator that emits trend-aware metrics for the
 * durable execution layer. Same pattern as the runtime observability
 * aggregator (Phase 14 ancestor) — callers feed samples; build() emits
 * the latest snapshot.
 */

import type {
  DiagnosticTrend,
  DurableExecutionDiagnostics,
  ExecutionRecord,
  ExecutionCheckpoint,
  RecoveryDeterminismResult,
} from './threadRuntimeTypes';

export interface DurableExecutionSample {
  timestamp: string;
  companyId: string;
  /** Snapshot of executions seen in this sample window. */
  executions: ExecutionRecord[];
  /** Checkpoints captured in this window (executionId → cps). */
  checkpoints: Record<string, ExecutionCheckpoint[]>;
  /** Outcomes from recovery runs that finished in this window. */
  recoveryOutcomes?: RecoveryDeterminismResult[];
  /** Number of stale-worker events observed (leases swept). */
  staleWorkerCount?: number;
  /** Number of lease-conflict events observed (claim refused). */
  leaseConflictCount?: number;
  /** Total idempotency suppression count observed. */
  idempotencySuppressionTotal?: number;
}

export interface DurableExecutionDiagnosticsRegistry {
  record(sample: DurableExecutionSample): void;
  build(companyId?: string, windowSize?: number): DurableExecutionDiagnostics;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function trendDirection(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last > first ? 'improving' : 'degrading';
}

export function createDurableExecutionDiagnosticsRegistry(options?: { maxSamplesPerCompany?: number }): DurableExecutionDiagnosticsRegistry {
  const cap = Math.max(20, options?.maxSamplesPerCompany ?? 200);
  const buckets = new Map<string, DurableExecutionSample[]>();

  function bucket(companyId: string): DurableExecutionSample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }
  function allSamples(companyId?: string): DurableExecutionSample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: DurableExecutionSample[] = [];
    buckets.forEach((b) => out.push(...b));
    return out;
  }

  return {
    record(s) {
      const b = bucket(s.companyId);
      b.push(s);
      while (b.length > cap) b.shift();
    },
    build(companyId, windowSize = 60) {
      const samples = allSamples(companyId).slice(-windowSize);
      const sampleSize = samples.length;
      if (sampleSize === 0) {
        return {
          checkpointFrequencyPerExecutionAvg: 0,
          recoveryDeterminismScoreAvg: 0,
          staleWorkerFrequencyPerHour: 0,
          replayContinuationSuccessRatePercent: 100,
          leaseConflictFrequencyPerHour: 0,
          idempotencySuppressionEventsTotal: 0,
          executionRecoveryTrend: 'unknown',
          sampleSize: 0,
        };
      }

      // Aggregate checkpoint frequency per execution
      const cpsPerExec: number[] = [];
      for (const s of samples) {
        for (const [, cps] of Object.entries(s.checkpoints)) cpsPerExec.push(cps.length);
      }
      const checkpointFrequencyPerExecutionAvg = Math.round(avg(cpsPerExec));

      // Recovery determinism averages
      const detScores: number[] = [];
      for (const s of samples) {
        for (const r of s.recoveryOutcomes ?? []) detScores.push(r.recoveryDeterminismScore);
      }
      const recoveryDeterminismScoreAvg = Math.round(avg(detScores));

      // Stale-worker frequency per hour
      const startMs = Date.parse(samples[0].timestamp);
      const endMs = Date.parse(samples[samples.length - 1].timestamp);
      const windowHours = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? (endMs - startMs) / 3_600_000
        : 1;
      const staleTotal = samples.reduce((sum, s) => sum + (s.staleWorkerCount ?? 0), 0);
      const staleWorkerFrequencyPerHour = Math.round((staleTotal / Math.max(0.01, windowHours)) * 100) / 100;
      const leaseConflictTotal = samples.reduce((sum, s) => sum + (s.leaseConflictCount ?? 0), 0);
      const leaseConflictFrequencyPerHour = Math.round((leaseConflictTotal / Math.max(0.01, windowHours)) * 100) / 100;
      const idempotencySuppressionEventsTotal = samples
        .map((s) => s.idempotencySuppressionTotal ?? 0)
        .reduce((a, b) => Math.max(a, b), 0); // monotonic counter; take max

      // Replay continuation success: completed / (completed + failed + abandoned)
      // over the most recent sample.
      const last = samples[samples.length - 1];
      const completed = last.executions.filter((e) => e.executionStatus === 'completed').length;
      const failed = last.executions.filter((e) => e.executionStatus === 'failed').length;
      const abandoned = last.executions.filter((e) => e.executionStatus === 'abandoned').length;
      const total = completed + failed + abandoned;
      const replayContinuationSuccessRatePercent = total === 0
        ? 100
        : Math.round((completed / total) * 100);

      // Execution recovery trend: completed ratio first half vs second half
      const mid = Math.max(1, Math.floor(sampleSize / 2));
      const completedRatio = (group: DurableExecutionSample[]) => {
        const all = group.flatMap((s) => s.executions);
        if (all.length === 0) return 100;
        return (all.filter((e) => e.executionStatus === 'completed').length / all.length) * 100;
      };
      const executionRecoveryTrend = trendDirection(
        completedRatio(samples.slice(0, mid)),
        completedRatio(samples.slice(mid)),
      );

      return {
        checkpointFrequencyPerExecutionAvg,
        recoveryDeterminismScoreAvg,
        staleWorkerFrequencyPerHour,
        replayContinuationSuccessRatePercent,
        leaseConflictFrequencyPerHour,
        idempotencySuppressionEventsTotal,
        executionRecoveryTrend,
        sampleSize,
      };
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _default: DurableExecutionDiagnosticsRegistry | null = null;
export function getDefaultDurableExecutionDiagnosticsRegistry(): DurableExecutionDiagnosticsRegistry {
  if (!_default) _default = createDurableExecutionDiagnosticsRegistry();
  return _default;
}
export function setDefaultDurableExecutionDiagnosticsRegistry(r: DurableExecutionDiagnosticsRegistry): void {
  _default = r;
}
