// Runtime Drift Telemetry — Worker Shadow Snapshot
//
// Deterministic, advisory-only, non-blocking telemetry record built from a
// shadow consumption result + compatibility verification. It carries seven
// telemetry channels — resolution, drift, compatibility, integrity, ownership,
// idempotency, publish-target — for emission alongside the live publish flow.

import type { WorkerShadowConsumptionResult } from './workerShadowSnapshotConsumption';
import type { WorkerCompatibilityVerification } from './workerSnapshotCompatibilityVerification';
import type { DriftKind } from './workerSnapshotDriftVerification';
import {
  worstSnapshotRuntimeStatus,
  type SnapshotRuntimeFinding,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';

export interface WorkerSnapshotRuntimeTelemetry {
  version: 'worker-snapshot-runtime-telemetry-v1';
  generatedAt: string;
  jobId: string;
  blogId: string;
  companyId: string;
  shadowEnabled: boolean;
  runtimeStatus: SnapshotRuntimeStatus;
  resolutionTelemetry: { resolved: boolean; matchedRowCount: number; reasons: readonly string[] };
  driftTelemetry: { hasDrift: boolean; driftKinds: readonly DriftKind[]; status: SnapshotRuntimeStatus };
  compatibilityTelemetry: { status: SnapshotRuntimeStatus; checks: WorkerCompatibilityVerification['checks'] };
  integrityTelemetry: { snapshotLoaded: boolean; contractResolved: boolean };
  ownershipTelemetry: { ownershipDrift: boolean };
  idempotencyTelemetry: { idempotencyResolved: boolean };
  publishTargetTelemetry: { publishTargetResolved: boolean };
  findings: readonly SnapshotRuntimeFinding[];
  advisoryNote: string;
}

export interface WorkerSnapshotRuntimeTelemetryInput {
  jobId: string;
  blogId: string;
  companyId: string;
  shadowEnabled: boolean;
  consumption: WorkerShadowConsumptionResult;
  compatibility: WorkerCompatibilityVerification;
}

export function buildWorkerSnapshotRuntimeTelemetry(
  input: WorkerSnapshotRuntimeTelemetryInput,
): WorkerSnapshotRuntimeTelemetry {
  const { consumption, compatibility } = input;
  const ownershipDrift = !!consumption.driftReport
    && consumption.driftReport.driftKinds.includes('company_ownership');

  return {
    version: 'worker-snapshot-runtime-telemetry-v1',
    generatedAt: new Date(0).toISOString(),
    jobId: input.jobId,
    blogId: input.blogId,
    companyId: input.companyId,
    shadowEnabled: input.shadowEnabled,
    runtimeStatus: worstSnapshotRuntimeStatus([consumption.status, compatibility.status]),
    resolutionTelemetry: {
      resolved: consumption.resolution.resolved,
      matchedRowCount: consumption.resolution.matchedRowCount,
      reasons: consumption.resolution.reasons,
    },
    driftTelemetry: {
      hasDrift: consumption.driftReport ? consumption.driftReport.hasDrift : false,
      driftKinds: consumption.driftReport ? consumption.driftReport.driftKinds : [],
      status: consumption.driftReport ? consumption.driftReport.status : 'snapshot_runtime_clean',
    },
    compatibilityTelemetry: {
      status: compatibility.status,
      checks: compatibility.checks,
    },
    integrityTelemetry: {
      snapshotLoaded: consumption.snapshotLoaded,
      contractResolved: consumption.contractResolved,
    },
    ownershipTelemetry: { ownershipDrift },
    idempotencyTelemetry: { idempotencyResolved: consumption.idempotencyResolved },
    publishTargetTelemetry: { publishTargetResolved: consumption.publishTargetResolved },
    findings: [...consumption.findings, ...compatibility.findings],
    advisoryNote: 'shadow-only telemetry; the live publish flow is unaffected',
  };
}

export function serializeWorkerSnapshotRuntimeTelemetry(telemetry: WorkerSnapshotRuntimeTelemetry): string {
  return [
    '## WORKER SNAPSHOT RUNTIME TELEMETRY',
    `Version: ${telemetry.version}`,
    `Job: ${telemetry.jobId} / blog ${telemetry.blogId}`,
    `Runtime status: ${telemetry.runtimeStatus}`,
    `Resolved: ${telemetry.resolutionTelemetry.resolved} (${telemetry.resolutionTelemetry.matchedRowCount} rows)`,
    `Drift: ${telemetry.driftTelemetry.hasDrift} [${telemetry.driftTelemetry.driftKinds.join(', ') || 'none'}]`,
    `Compatibility: ${telemetry.compatibilityTelemetry.status}`,
    `Ownership drift: ${telemetry.ownershipTelemetry.ownershipDrift}`,
    `Idempotency resolved: ${telemetry.idempotencyTelemetry.idempotencyResolved}`,
    `Publish target resolved: ${telemetry.publishTargetTelemetry.publishTargetResolved}`,
  ].join('\n');
}
