/**
 * Phase 10 — Thread runtime observability aggregator.
 *
 * Accumulates samples per company and emits trend-aware diagnostics across
 * 6 axes:
 *   - topology health trend          avg topologyIntegrityScore from snapshots
 *   - orphan suppression trend       avg orphan count (inverted — lower is better)
 *   - recovery success trend         avg recovery_success / attempts rate
 *   - node mutation trend            avg topology mutation frequency
 *   - persistence drift trend        avg persist failure rate (inverted)
 *   - orchestration stability trend  avg runtimeHealthScore
 */

import type {
  DiagnosticTrend,
  RuntimeFailureSummary,
  ShadowRunValidationResult,
  ShadowSoakReport,
  ThreadRuntimeDiagnosticsResult,
  ThreadRuntimeObservability,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';
import type { RuntimeSilentZoneDetectionResult } from './runtimeSilentZoneDetector';
import type { TraceConsistencyResult } from './runtimeTraceConsistencyGovernor';

export interface ThreadRuntimeObservabilitySample {
  timestamp: string;
  companyId: string;
  threadId: string;
  latestSnapshot?: ThreadTopologySnapshot;
  diagnostics?: ThreadRuntimeDiagnosticsResult;
  soakReport?: ShadowSoakReport;
  failures?: RuntimeFailureSummary[];
  // ── Wiring-phase additions (optional) ──────────────────────────────
  silentZones?: RuntimeSilentZoneDetectionResult;
  consistency?: TraceConsistencyResult;
  validation?: ShadowRunValidationResult;
  /** number of distinct snapshot phases captured for this thread when the sample was taken */
  snapshotPhasesCaptured?: number;
}

export interface ThreadRuntimeObservabilityRegistry {
  record(sample: ThreadRuntimeObservabilitySample): void;
  build(companyId?: string, windowSize?: number): ThreadRuntimeObservability;
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

// Lower is better — invert for "rising = bad" metrics
function invertedTrend(first: number, last: number, threshold = 3): DiagnosticTrend {
  if (Math.abs(last - first) < threshold) return 'stable';
  return last < first ? 'improving' : 'degrading';
}

export function createThreadRuntimeObservabilityRegistry(options?: {
  maxSamplesPerCompany?: number;
}): ThreadRuntimeObservabilityRegistry {
  const cap = Math.max(20, options?.maxSamplesPerCompany ?? 300);
  const buckets = new Map<string, ThreadRuntimeObservabilitySample[]>();

  function bucket(companyId: string): ThreadRuntimeObservabilitySample[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }
  function allSamples(companyId?: string): ThreadRuntimeObservabilitySample[] {
    if (companyId) return [...(buckets.get(companyId) ?? [])];
    const out: ThreadRuntimeObservabilitySample[] = [];
    buckets.forEach((b) => out.push(...b));
    return out;
  }

  return {
    record(sample) {
      const b = bucket(sample.companyId);
      b.push(sample);
      while (b.length > cap) b.shift();
    },
    build(companyId, windowSize = 60) {
      const samples = allSamples(companyId).slice(-windowSize);
      const sampleSize = samples.length;
      if (sampleSize === 0) {
        return {
          topologyHealthTrend: 'unknown',
          orphanSuppressionTrend: 'unknown',
          recoverySuccessTrend: 'unknown',
          nodeMutationTrend: 'unknown',
          persistenceDriftTrend: 'unknown',
          orchestrationStabilityTrend: 'unknown',
          sampleSize: 0,
        };
      }
      const mid = Math.max(1, Math.floor(sampleSize / 2));
      const first = samples.slice(0, mid);
      const second = samples.slice(mid);

      // topology health
      const topoFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.latestSnapshot).map((s) => s.latestSnapshot!.topologyIntegrityScore));
      const topologyHealthTrend = trendDirection(topoFn(first), topoFn(second));

      // orphan suppression (lower orphan count = better; inverted)
      const orphanFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.latestSnapshot).map((s) => s.latestSnapshot!.orphanNodeIds.length));
      const orphanSuppressionTrend = invertedTrend(orphanFn(first), orphanFn(second), 0.5);

      // recovery success
      const recoveryFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.soakReport).map((s) => s.soakReport!.recoveryStabilityScore));
      const recoverySuccessTrend = trendDirection(recoveryFn(first), recoveryFn(second));

      // node mutation
      const mutFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.diagnostics).map((s) => s.diagnostics!.topologyMutationFrequencyPerMin));
      const nodeMutationTrend = trendDirection(mutFn(first), mutFn(second), 1);

      // persistence drift (failure rate; inverted via consistency score)
      const persistFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.soakReport).map((s) => s.soakReport!.persistenceConsistencyScore));
      const persistenceDriftTrend = trendDirection(persistFn(first), persistFn(second));

      // orchestration stability (runtimeHealthScore)
      const stabFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.diagnostics).map((s) => s.diagnostics!.runtimeHealthScore));
      const orchestrationStabilityTrend = trendDirection(stabFn(first), stabFn(second));

      // ── Wiring-phase metrics ───────────────────────────────────────
      const covFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.silentZones).map((s) => s.silentZones!.coveragePercent));
      const instrumentationCoveragePercentAvgRaw = avg([covFn(first), covFn(second)].filter((v) => v > 0));
      const haveCoverageSamples = samples.some((s) => s.silentZones);
      const instrumentationCoveragePercentAvg = haveCoverageSamples
        ? Math.round(avg(samples.filter((s) => s.silentZones).map((s) => s.silentZones!.coveragePercent)))
        : undefined;
      // suppress unused-var pedantry
      void instrumentationCoveragePercentAvgRaw;

      const replayFn = (g: ThreadRuntimeObservabilitySample[]) => {
        const list = g.filter((s) => s.validation);
        if (list.length === 0) return 0;
        return list.filter((s) => s.validation!.replayConsistencyOk).length / list.length;
      };
      const replayIntegrityTrend = samples.some((s) => s.validation)
        ? trendDirection(replayFn(first) * 100, replayFn(second) * 100)
        : undefined;

      const silentFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => s.silentZones).map((s) => s.silentZones!.silentZoneWarnings.length));
      const silentZoneFrequencyAvg = samples.some((s) => s.silentZones)
        ? Number(avg(samples.filter((s) => s.silentZones).map((s) => s.silentZones!.silentZoneWarnings.length)).toFixed(2))
        : undefined;
      // direction signal: lower is better → invert
      const lifecycleClosureTrend = samples.some((s) => s.consistency)
        ? (() => {
            const fn = (g: ThreadRuntimeObservabilitySample[]) =>
              avg(g.filter((s) => s.consistency).map((s) => s.consistency!.openLifecycles));
            return invertedTrend(fn(first), fn(second), 0.5);
          })()
        : undefined;

      const completenessFn = (g: ThreadRuntimeObservabilitySample[]) => {
        const list = g.filter((s) => s.silentZones);
        if (list.length === 0) return 0;
        return avg(list.map((s) => s.silentZones!.coveragePercent));
      };
      const traceCompletenessTrend = samples.some((s) => s.silentZones)
        ? trendDirection(completenessFn(first), completenessFn(second))
        : undefined;

      const snapshotFn = (g: ThreadRuntimeObservabilitySample[]) =>
        avg(g.filter((s) => typeof s.snapshotPhasesCaptured === 'number').map((s) => s.snapshotPhasesCaptured!));
      const snapshotCoverageTrend = samples.some((s) => typeof s.snapshotPhasesCaptured === 'number')
        ? trendDirection(snapshotFn(first), snapshotFn(second), 0.5)
        : undefined;

      // also feed the silent zone freq if any
      void silentFn;

      return {
        topologyHealthTrend,
        orphanSuppressionTrend,
        recoverySuccessTrend,
        nodeMutationTrend,
        persistenceDriftTrend,
        orchestrationStabilityTrend,
        sampleSize,
        ...(instrumentationCoveragePercentAvg !== undefined ? { instrumentationCoveragePercentAvg } : {}),
        ...(replayIntegrityTrend ? { replayIntegrityTrend } : {}),
        ...(silentZoneFrequencyAvg !== undefined ? { silentZoneFrequencyAvg } : {}),
        ...(lifecycleClosureTrend ? { lifecycleClosureTrend } : {}),
        ...(traceCompletenessTrend ? { traceCompletenessTrend } : {}),
        ...(snapshotCoverageTrend ? { snapshotCoverageTrend } : {}),
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

let _default: ThreadRuntimeObservabilityRegistry | null = null;
export function getDefaultThreadRuntimeObservabilityRegistry(): ThreadRuntimeObservabilityRegistry {
  if (!_default) _default = createThreadRuntimeObservabilityRegistry();
  return _default;
}
export function setDefaultThreadRuntimeObservabilityRegistry(r: ThreadRuntimeObservabilityRegistry): void {
  _default = r;
}
