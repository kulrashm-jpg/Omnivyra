// Runtime Stability Verification — Worker Shadow Soak
//
// Deterministic, advisory-only verification of worker shadow telemetry
// stability over a soak window. Produces a stability report — it NEVER gates
// runtime or mutates anything.

import type { WorkerSnapshotRuntimeTelemetry } from './workerSnapshotRuntimeTelemetry';
import type { SnapshotRuntimeStatus } from './workerSnapshotRuntimeStatus';
import {
  worstShadowSoakStatus,
  type ShadowSoakStatus,
} from './workerSnapshotShadowSoakStatus';

export interface WorkerSnapshotRuntimeStabilityReport {
  version: 'worker-snapshot-runtime-stability-v1';
  generatedAt: string;
  status: ShadowSoakStatus;
  telemetryCount: number;
  runtimeStatusDistribution: Record<SnapshotRuntimeStatus, number>;
  ownershipDriftCount: number;
  compatibilityWarningCount: number;
  unresolvedSnapshotCount: number;
  idempotencyResolvedCount: number;
  runtimeRiskEscalationCount: number;
  rates: {
    ownershipDriftRate: number;
    compatibilityWarningRate: number;
    unresolvedSnapshotRate: number;
    idempotencyStabilityRate: number;
    runtimeRiskEscalationRate: number;
  };
  findings: readonly string[];
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function verifyWorkerSnapshotRuntimeStability(
  telemetries: readonly WorkerSnapshotRuntimeTelemetry[],
): WorkerSnapshotRuntimeStabilityReport {
  const runtimeStatusDistribution: Record<SnapshotRuntimeStatus, number> = {
    snapshot_runtime_clean: 0,
    snapshot_runtime_warning: 0,
    snapshot_runtime_risk: 0,
    snapshot_runtime_invalid: 0,
  };
  let ownershipDriftCount = 0;
  let compatibilityWarningCount = 0;
  let unresolvedSnapshotCount = 0;
  let idempotencyResolvedCount = 0;
  let runtimeRiskEscalationCount = 0;

  for (const telemetry of telemetries) {
    runtimeStatusDistribution[telemetry.runtimeStatus] += 1;
    if (telemetry.ownershipTelemetry.ownershipDrift) ownershipDriftCount += 1;
    if (telemetry.compatibilityTelemetry.status === 'snapshot_runtime_warning') compatibilityWarningCount += 1;
    if (!telemetry.resolutionTelemetry.resolved) unresolvedSnapshotCount += 1;
    if (telemetry.idempotencyTelemetry.idempotencyResolved) idempotencyResolvedCount += 1;
    if (telemetry.runtimeStatus === 'snapshot_runtime_risk' || telemetry.runtimeStatus === 'snapshot_runtime_invalid') {
      runtimeRiskEscalationCount += 1;
    }
  }

  const total = telemetries.length;
  const findings: string[] = [];
  if (ownershipDriftCount > 0) findings.push(`ownership drift detected in ${ownershipDriftCount} telemetry records`);
  if (runtimeStatusDistribution.snapshot_runtime_invalid > 0) {
    findings.push(`runtime invalid state in ${runtimeStatusDistribution.snapshot_runtime_invalid} telemetry records`);
  }
  if (runtimeStatusDistribution.snapshot_runtime_risk > 0) {
    findings.push(`runtime risk state in ${runtimeStatusDistribution.snapshot_runtime_risk} telemetry records`);
  }
  if (compatibilityWarningCount > 0) findings.push(`compatibility warnings in ${compatibilityWarningCount} telemetry records`);
  if (unresolvedSnapshotCount > 0) findings.push(`unresolved snapshots in ${unresolvedSnapshotCount} telemetry records`);

  let status: ShadowSoakStatus = 'shadow_soak_clean';
  if (ownershipDriftCount > 0 || runtimeStatusDistribution.snapshot_runtime_invalid > 0) {
    status = 'shadow_soak_invalid';
  } else if (runtimeStatusDistribution.snapshot_runtime_risk > 0) {
    status = 'shadow_soak_risk';
  } else if (compatibilityWarningCount > 0 || unresolvedSnapshotCount > 0
    || runtimeStatusDistribution.snapshot_runtime_warning > 0) {
    status = 'shadow_soak_warning';
  }

  return {
    version: 'worker-snapshot-runtime-stability-v1',
    generatedAt: new Date(0).toISOString(),
    status: worstShadowSoakStatus([status]),
    telemetryCount: total,
    runtimeStatusDistribution,
    ownershipDriftCount,
    compatibilityWarningCount,
    unresolvedSnapshotCount,
    idempotencyResolvedCount,
    runtimeRiskEscalationCount,
    rates: {
      ownershipDriftRate: rate(ownershipDriftCount, total),
      compatibilityWarningRate: rate(compatibilityWarningCount, total),
      unresolvedSnapshotRate: rate(unresolvedSnapshotCount, total),
      idempotencyStabilityRate: rate(idempotencyResolvedCount, total),
      runtimeRiskEscalationRate: rate(runtimeRiskEscalationCount, total),
    },
    findings,
  };
}

export function serializeWorkerSnapshotRuntimeStability(report: WorkerSnapshotRuntimeStabilityReport): string {
  return [
    '## WORKER SNAPSHOT RUNTIME STABILITY',
    `Version: ${report.version}`,
    `Status: ${report.status}`,
    `Telemetry count: ${report.telemetryCount}`,
    `Ownership drift: ${report.ownershipDriftCount}`,
    `Compatibility warnings: ${report.compatibilityWarningCount}`,
    `Unresolved snapshots: ${report.unresolvedSnapshotCount}`,
    `Risk escalation: ${report.runtimeRiskEscalationCount}`,
    `Findings: ${report.findings.join('; ') || 'none'}`,
  ].join('\n');
}
