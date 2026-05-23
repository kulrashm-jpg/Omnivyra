// Shadow Soak Runner
//
// Runs advisory, non-production shadow soak cycles: consumes worker shadow
// runtime telemetry, aggregates runtime/drift/compatibility/ownership/
// idempotency telemetry into metrics + risk + stability + operational reports,
// and (optionally) persists the aggregate summaries append-only.
//
// SAFETY GUARD: a soak cycle NEVER blocks publishing, alters retries, queue
// outcomes, worker execution, or scheduler behavior, and never mutates
// snapshots/contracts. Every failure becomes an advisory result only.

import type { WorkerSnapshotRuntimeTelemetry } from '../../lib/publishing/workerSnapshotRuntimeTelemetry';
import {
  buildWorkerSnapshotShadowMetrics,
  type WorkerSnapshotShadowMetrics,
} from '../../lib/publishing/workerSnapshotShadowMetrics';
import {
  summarizeWorkerSnapshotShadowRisk,
  type WorkerSnapshotShadowRiskSummary,
} from '../../lib/publishing/workerSnapshotShadowRiskSummary';
import {
  verifyWorkerSnapshotRuntimeStability,
  type WorkerSnapshotRuntimeStabilityReport,
} from '../../lib/publishing/workerSnapshotRuntimeStabilityVerifier';
import {
  buildWorkerSnapshotOperationalReport,
  type WorkerSnapshotOperationalReport,
} from '../../lib/publishing/workerSnapshotOperationalReporting';
import {
  worstShadowSoakStatus,
  shadowSoakStatusFromRuntime,
  type ShadowSoakStatus,
} from '../../lib/publishing/workerSnapshotShadowSoakStatus';
import {
  buildShadowTelemetryRow,
  loadShadowTelemetryRecords,
  persistShadowTelemetryRecords,
  type WorkerSnapshotShadowTelemetryRow,
} from './workerSnapshotShadowTelemetryStore';

export interface WorkerSnapshotShadowSoakReport {
  version: 'worker-snapshot-shadow-soak-report-v1';
  generatedAt: string;
  soakCycleId: string;
  telemetryCount: number;
  shadowSoakStatus: ShadowSoakStatus;
  metrics: WorkerSnapshotShadowMetrics;
  riskSummary: WorkerSnapshotShadowRiskSummary;
  stability: WorkerSnapshotRuntimeStabilityReport;
  operationalReport: WorkerSnapshotOperationalReport;
}

// Pure aggregation core — deterministic, no DB, no execution.
export function buildShadowSoakReport(
  soakCycleId: string,
  telemetries: readonly WorkerSnapshotRuntimeTelemetry[],
): WorkerSnapshotShadowSoakReport {
  const metrics = buildWorkerSnapshotShadowMetrics(telemetries);
  const riskSummary = summarizeWorkerSnapshotShadowRisk(telemetries);
  const stability = verifyWorkerSnapshotRuntimeStability(telemetries);
  const operationalReport = buildWorkerSnapshotOperationalReport({
    telemetries,
    metrics,
    riskSummary,
    stability,
  });
  const shadowSoakStatus = worstShadowSoakStatus([
    stability.status,
    shadowSoakStatusFromRuntime(riskSummary.overallStatus),
  ]);
  return {
    version: 'worker-snapshot-shadow-soak-report-v1',
    generatedAt: new Date(0).toISOString(),
    soakCycleId,
    telemetryCount: telemetries.length,
    shadowSoakStatus,
    metrics,
    riskSummary,
    stability,
    operationalReport,
  };
}

// Builds append-only summary rows for a completed soak report.
export function buildShadowSoakSummaryRows(
  report: WorkerSnapshotShadowSoakReport,
): WorkerSnapshotShadowTelemetryRow[] {
  const base = { soakCycleId: report.soakCycleId, shadowSoakStatus: report.shadowSoakStatus };
  return [
    buildShadowTelemetryRow({ ...base, recordKind: 'metrics_snapshot', payload: report.metrics }),
    buildShadowTelemetryRow({ ...base, recordKind: 'risk_summary', payload: report.riskSummary }),
    buildShadowTelemetryRow({
      ...base,
      recordKind: 'drift_summary',
      payload: { driftFrequency: report.operationalReport.driftFrequency, driftRisks: report.riskSummary.runtimeDriftRisks },
    }),
    buildShadowTelemetryRow({
      ...base,
      recordKind: 'compatibility_summary',
      payload: {
        compatibilityRisks: report.riskSummary.runtimeCompatibilityRisks,
        compatibilityWarnings: report.metrics.snapshotCompatibilityWarnings,
        compatibilityInvalidStates: report.metrics.snapshotCompatibilityInvalidStates,
      },
    }),
    buildShadowTelemetryRow({
      ...base,
      recordKind: 'ownership_summary',
      payload: { ownership: report.operationalReport.ownershipDrift, ownershipRisks: report.riskSummary.ownershipRisks },
    }),
  ];
}

export interface ShadowSoakCycleInput {
  soakCycleId: string;
  // If provided, the soak runs against these telemetry records in-memory.
  // If omitted, runtime telemetry is loaded from the append-only store.
  telemetries?: readonly WorkerSnapshotRuntimeTelemetry[];
  // Off by default — summary persistence is opt-in.
  persistSummaries?: boolean;
}

export interface ShadowSoakCycleResult {
  executed: boolean;
  report: WorkerSnapshotShadowSoakReport | null;
  persisted: boolean;
  reasons: readonly string[];
}

// Runs one advisory soak cycle. NEVER throws — the body is fully guarded; any
// failure is returned as an advisory result so publishing is unaffected.
export async function runWorkerSnapshotShadowSoakCycle(
  input: ShadowSoakCycleInput,
): Promise<ShadowSoakCycleResult> {
  try {
    let telemetries = input.telemetries;
    if (!telemetries) {
      const rows = await loadShadowTelemetryRecords({
        soakCycleId: input.soakCycleId,
        recordKind: 'runtime_telemetry',
      });
      telemetries = rows.map((row) => row.payload as WorkerSnapshotRuntimeTelemetry);
    }
    const report = buildShadowSoakReport(input.soakCycleId, telemetries);

    let persisted = false;
    if (input.persistSummaries) {
      await persistShadowTelemetryRecords(buildShadowSoakSummaryRows(report));
      persisted = true;
    }
    return { executed: true, report, persisted, reasons: [] };
  } catch (error) {
    return {
      executed: false,
      report: null,
      persisted: false,
      reasons: [`soak cycle error: ${error instanceof Error ? error.message : 'unknown error'}`],
    };
  }
}

export function serializeWorkerSnapshotShadowSoakReport(report: WorkerSnapshotShadowSoakReport): string {
  return [
    '## WORKER SNAPSHOT SHADOW SOAK REPORT',
    `Version: ${report.version}`,
    `Soak cycle: ${report.soakCycleId}`,
    `Telemetry count: ${report.telemetryCount}`,
    `Shadow soak status: ${report.shadowSoakStatus}`,
    `Drift count: ${report.metrics.draftSnapshotDriftCount}`,
    `Ownership drift: ${report.metrics.crossCompanyOwnershipDriftCount}`,
    `Resolution failures: ${report.metrics.snapshotResolutionFailures}`,
    `Soak health: ${report.operationalReport.soakHealth}`,
  ].join('\n');
}
