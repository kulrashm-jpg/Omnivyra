// Operational Reporting Layer — Worker Shadow Soak
//
// Deterministic, advisory-only operational summaries for a shadow soak cycle.
// Produces operator-readable health/frequency reporting — it makes NO runtime
// decisions and gates nothing.

import type { WorkerSnapshotRuntimeTelemetry } from './workerSnapshotRuntimeTelemetry';
import type { WorkerSnapshotShadowMetrics } from './workerSnapshotShadowMetrics';
import type { WorkerSnapshotShadowRiskSummary } from './workerSnapshotShadowRiskSummary';
import type { WorkerSnapshotRuntimeStabilityReport } from './workerSnapshotRuntimeStabilityVerifier';
import type { ShadowSoakStatus } from './workerSnapshotShadowSoakStatus';

export interface WorkerSnapshotOperationalReport {
  version: 'worker-snapshot-operational-report-v1';
  generatedAt: string;
  soakHealth: ShadowSoakStatus;
  driftFrequency: { driftCount: number; total: number; rate: number };
  ownershipDrift: { count: number; clean: boolean };
  compatibilityRisks: readonly string[];
  runtimeInvalidStates: number;
  unresolvedSnapshots: number;
  telemetryGaps: readonly string[];
}

export interface WorkerSnapshotOperationalReportInput {
  telemetries: readonly WorkerSnapshotRuntimeTelemetry[];
  metrics: WorkerSnapshotShadowMetrics;
  riskSummary: WorkerSnapshotShadowRiskSummary;
  stability: WorkerSnapshotRuntimeStabilityReport;
}

export function buildWorkerSnapshotOperationalReport(
  input: WorkerSnapshotOperationalReportInput,
): WorkerSnapshotOperationalReport {
  const { telemetries, metrics, riskSummary, stability } = input;
  const total = telemetries.length;

  const telemetryGaps: string[] = [];
  if (total === 0) {
    telemetryGaps.push('no shadow telemetry captured for this soak cycle');
  }
  if (total > 0 && stability.unresolvedSnapshotCount === total) {
    telemetryGaps.push('every telemetry record has an unresolved snapshot');
  }

  return {
    version: 'worker-snapshot-operational-report-v1',
    generatedAt: new Date(0).toISOString(),
    soakHealth: stability.status,
    driftFrequency: {
      driftCount: metrics.draftSnapshotDriftCount,
      total,
      rate: total > 0 ? metrics.draftSnapshotDriftCount / total : 0,
    },
    ownershipDrift: {
      count: metrics.crossCompanyOwnershipDriftCount,
      clean: metrics.crossCompanyOwnershipDriftCount === 0,
    },
    compatibilityRisks: riskSummary.runtimeCompatibilityRisks,
    runtimeInvalidStates: stability.runtimeStatusDistribution.snapshot_runtime_invalid,
    unresolvedSnapshots: stability.unresolvedSnapshotCount,
    telemetryGaps,
  };
}

export function serializeWorkerSnapshotOperationalReport(report: WorkerSnapshotOperationalReport): string {
  return [
    '## WORKER SNAPSHOT OPERATIONAL REPORT',
    `Version: ${report.version}`,
    `Soak health: ${report.soakHealth}`,
    `Drift frequency: ${report.driftFrequency.driftCount}/${report.driftFrequency.total}`,
    `Ownership drift: ${report.ownershipDrift.count} (clean: ${report.ownershipDrift.clean})`,
    `Runtime invalid states: ${report.runtimeInvalidStates}`,
    `Unresolved snapshots: ${report.unresolvedSnapshots}`,
    `Compatibility risks: ${report.compatibilityRisks.join('; ') || 'none'}`,
    `Telemetry gaps: ${report.telemetryGaps.join('; ') || 'none'}`,
  ].join('\n');
}
