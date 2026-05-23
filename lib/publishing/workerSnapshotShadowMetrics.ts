// Runtime Shadow Metrics — Worker Shadow Snapshot
//
// Deterministic, non-gating metrics aggregated over worker shadow telemetry
// records. Counts only — these metrics inform but never gate runtime.

import type { WorkerSnapshotRuntimeTelemetry } from './workerSnapshotRuntimeTelemetry';

export interface WorkerSnapshotShadowMetrics {
  version: 'worker-snapshot-shadow-metrics-v1';
  shadowConsumptionCount: number;
  snapshotResolutionFailures: number;
  draftSnapshotDriftCount: number;
  crossCompanyOwnershipDriftCount: number;
  snapshotCompatibilityWarnings: number;
  snapshotCompatibilityInvalidStates: number;
  publishTargetIncompatibilityCount: number;
}

export function buildWorkerSnapshotShadowMetrics(
  telemetries: readonly WorkerSnapshotRuntimeTelemetry[],
): WorkerSnapshotShadowMetrics {
  let snapshotResolutionFailures = 0;
  let draftSnapshotDriftCount = 0;
  let crossCompanyOwnershipDriftCount = 0;
  let snapshotCompatibilityWarnings = 0;
  let snapshotCompatibilityInvalidStates = 0;
  let publishTargetIncompatibilityCount = 0;

  for (const telemetry of telemetries) {
    if (!telemetry.resolutionTelemetry.resolved) snapshotResolutionFailures += 1;
    if (telemetry.driftTelemetry.hasDrift) draftSnapshotDriftCount += 1;
    if (telemetry.ownershipTelemetry.ownershipDrift) crossCompanyOwnershipDriftCount += 1;
    if (telemetry.compatibilityTelemetry.status === 'snapshot_runtime_warning') snapshotCompatibilityWarnings += 1;
    if (telemetry.compatibilityTelemetry.status === 'snapshot_runtime_invalid') snapshotCompatibilityInvalidStates += 1;
    if (!telemetry.publishTargetTelemetry.publishTargetResolved) publishTargetIncompatibilityCount += 1;
  }

  return {
    version: 'worker-snapshot-shadow-metrics-v1',
    shadowConsumptionCount: telemetries.length,
    snapshotResolutionFailures,
    draftSnapshotDriftCount,
    crossCompanyOwnershipDriftCount,
    snapshotCompatibilityWarnings,
    snapshotCompatibilityInvalidStates,
    publishTargetIncompatibilityCount,
  };
}

export function serializeWorkerSnapshotShadowMetrics(metrics: WorkerSnapshotShadowMetrics): string {
  return [
    '## WORKER SNAPSHOT SHADOW METRICS',
    `Version: ${metrics.version}`,
    `Shadow consumptions: ${metrics.shadowConsumptionCount}`,
    `Resolution failures: ${metrics.snapshotResolutionFailures}`,
    `Draft-vs-snapshot drift: ${metrics.draftSnapshotDriftCount}`,
    `Cross-company ownership drift: ${metrics.crossCompanyOwnershipDriftCount}`,
    `Compatibility warnings: ${metrics.snapshotCompatibilityWarnings}`,
    `Compatibility invalid states: ${metrics.snapshotCompatibilityInvalidStates}`,
    `Publish-target incompatibility: ${metrics.publishTargetIncompatibilityCount}`,
  ].join('\n');
}
