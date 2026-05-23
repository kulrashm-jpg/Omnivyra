// Runtime Shadow Risk Summaries — Worker Shadow Snapshot
//
// Deterministic, advisory-only aggregation of worker shadow telemetry into
// risk buckets: drift, compatibility, integrity, ownership, publish-target,
// and unresolved-snapshot risks. Advisory only — never gates runtime.

import type { WorkerSnapshotRuntimeTelemetry } from './workerSnapshotRuntimeTelemetry';
import {
  worstSnapshotRuntimeStatus,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';

export interface WorkerSnapshotShadowRiskSummary {
  version: 'worker-snapshot-shadow-risk-summary-v1';
  generatedAt: string;
  overallStatus: SnapshotRuntimeStatus;
  runtimeDriftRisks: readonly string[];
  runtimeCompatibilityRisks: readonly string[];
  snapshotIntegrityRisks: readonly string[];
  ownershipRisks: readonly string[];
  publishTargetRisks: readonly string[];
  unresolvedSnapshotRisks: readonly string[];
}

export function summarizeWorkerSnapshotShadowRisk(
  telemetries: readonly WorkerSnapshotRuntimeTelemetry[],
): WorkerSnapshotShadowRiskSummary {
  const drift = new Set<string>();
  const compatibility = new Set<string>();
  const integrity = new Set<string>();
  const ownership = new Set<string>();
  const publishTarget = new Set<string>();
  const unresolved = new Set<string>();

  for (const telemetry of telemetries) {
    if (telemetry.driftTelemetry.hasDrift) {
      for (const kind of telemetry.driftTelemetry.driftKinds) {
        if (kind === 'company_ownership') {
          ownership.add(`ownership drift on blog ${telemetry.blogId}`);
        } else {
          drift.add(`${kind} drift on blog ${telemetry.blogId}`);
        }
      }
    }
    if (
      telemetry.compatibilityTelemetry.status === 'snapshot_runtime_risk'
      || telemetry.compatibilityTelemetry.status === 'snapshot_runtime_invalid'
    ) {
      compatibility.add(`compatibility ${telemetry.compatibilityTelemetry.status} on blog ${telemetry.blogId}`);
    }
    if (!telemetry.integrityTelemetry.snapshotLoaded || !telemetry.integrityTelemetry.contractResolved) {
      integrity.add(`snapshot or contract not loaded for blog ${telemetry.blogId}`);
    }
    if (!telemetry.publishTargetTelemetry.publishTargetResolved) {
      publishTarget.add(`publish target unresolved for blog ${telemetry.blogId}`);
    }
    if (!telemetry.resolutionTelemetry.resolved) {
      unresolved.add(`snapshot unresolved for blog ${telemetry.blogId} (${telemetry.resolutionTelemetry.reasons.join('; ') || 'no match'})`);
    }
  }

  return {
    version: 'worker-snapshot-shadow-risk-summary-v1',
    generatedAt: new Date(0).toISOString(),
    overallStatus: worstSnapshotRuntimeStatus(
      telemetries.length > 0 ? telemetries.map((telemetry) => telemetry.runtimeStatus) : ['snapshot_runtime_clean'],
    ),
    runtimeDriftRisks: [...drift].sort(),
    runtimeCompatibilityRisks: [...compatibility].sort(),
    snapshotIntegrityRisks: [...integrity].sort(),
    ownershipRisks: [...ownership].sort(),
    publishTargetRisks: [...publishTarget].sort(),
    unresolvedSnapshotRisks: [...unresolved].sort(),
  };
}

export function serializeWorkerSnapshotShadowRiskSummary(summary: WorkerSnapshotShadowRiskSummary): string {
  return [
    '## WORKER SNAPSHOT SHADOW RISK SUMMARY',
    `Version: ${summary.version}`,
    `Overall status: ${summary.overallStatus}`,
    `Drift risks: ${summary.runtimeDriftRisks.join('; ') || 'none'}`,
    `Compatibility risks: ${summary.runtimeCompatibilityRisks.join('; ') || 'none'}`,
    `Integrity risks: ${summary.snapshotIntegrityRisks.join('; ') || 'none'}`,
    `Ownership risks: ${summary.ownershipRisks.join('; ') || 'none'}`,
    `Publish target risks: ${summary.publishTargetRisks.join('; ') || 'none'}`,
    `Unresolved snapshot risks: ${summary.unresolvedSnapshotRisks.join('; ') || 'none'}`,
  ].join('\n');
}
