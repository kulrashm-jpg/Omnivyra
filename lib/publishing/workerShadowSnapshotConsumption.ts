// Worker Shadow Snapshot Consumption Layer
//
// Simulates — in shadow mode only — what a publishing worker would do if it
// consumed a frozen snapshot instead of a live draft: resolve the snapshot,
// load it, resolve the contract, resolve the publish target, resolve
// idempotency, and compare the live draft against the frozen snapshot.
//
// NO real publishing execution. The live worker continues to use live drafts;
// this layer runs alongside, advisory-only.

import type { ContentPublishSnapshotRow } from './publishSnapshotRecord';
import type { BlogContentSource } from './publishSnapshotMapper';
import { isPublishModeSupported } from './publishTargetCompatibility';
import {
  resolveWorkerSnapshot,
  type WorkerSnapshotResolution,
  type WorkerSnapshotResolutionKey,
} from './workerSnapshotResolver';
import {
  verifyDraftVsSnapshotDrift,
  type WorkerSnapshotDriftReport,
} from './workerSnapshotDriftVerification';
import {
  deriveSnapshotRuntimeStatus,
  type SnapshotRuntimeFinding,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';

export interface WorkerShadowConsumptionInput {
  rows: readonly ContentPublishSnapshotRow[];
  resolutionKey: WorkerSnapshotResolutionKey;
  liveDraft: BlogContentSource;
  liveDraftRenderedHtml: string;
}

export interface WorkerShadowConsumptionResult {
  version: 'worker-shadow-snapshot-consumption-v1';
  generatedAt: string;
  resolution: WorkerSnapshotResolution;
  snapshotLoaded: boolean;
  contractResolved: boolean;
  publishTargetResolved: boolean;
  idempotencyResolved: boolean;
  driftReport: WorkerSnapshotDriftReport | null;
  status: SnapshotRuntimeStatus;
  findings: readonly SnapshotRuntimeFinding[];
}

export function simulateWorkerShadowConsumption(
  input: WorkerShadowConsumptionInput,
): WorkerShadowConsumptionResult {
  const resolution = resolveWorkerSnapshot(input.rows, input.resolutionKey);
  const findings: SnapshotRuntimeFinding[] = [];

  let snapshotLoaded = false;
  let contractResolved = false;
  let publishTargetResolved = false;
  let idempotencyResolved = false;
  let driftReport: WorkerSnapshotDriftReport | null = null;

  if (!resolution.resolved || !resolution.snapshot || !resolution.contract || !resolution.row) {
    findings.push({
      code: 'snapshot_not_resolved',
      severity: 'risk',
      message: resolution.reasons.join('; ') || 'snapshot could not be resolved in shadow mode',
    });
  } else {
    snapshotLoaded = true;
    contractResolved = true;

    publishTargetResolved = isPublishModeSupported(
      resolution.contract.publishTargetType,
      resolution.contract.publishMode,
    );
    if (!publishTargetResolved) {
      findings.push({
        code: 'publish_target_unresolved',
        severity: 'warning',
        message: `publish target ${resolution.contract.publishTargetType} does not support mode ${resolution.contract.publishMode}`,
      });
    }

    idempotencyResolved =
      resolution.contract.publishIdempotencyKey.length > 0
      && resolution.contract.publishIdempotencyKey === resolution.row.idempotency_key;
    if (!idempotencyResolved) {
      findings.push({
        code: 'idempotency_unresolved',
        severity: 'risk',
        message: 'idempotency key did not resolve consistently against the persisted row',
      });
    }

    driftReport = verifyDraftVsSnapshotDrift({
      draft: input.liveDraft,
      draftRenderedHtml: input.liveDraftRenderedHtml,
      snapshot: resolution.snapshot,
    });
    for (const finding of driftReport.findings) {
      findings.push({ code: `drift_${finding.kind}`, severity: finding.severity, message: finding.detail });
    }
  }

  return {
    version: 'worker-shadow-snapshot-consumption-v1',
    generatedAt: new Date(0).toISOString(),
    resolution,
    snapshotLoaded,
    contractResolved,
    publishTargetResolved,
    idempotencyResolved,
    driftReport,
    status: deriveSnapshotRuntimeStatus(findings),
    findings,
  };
}

export function serializeWorkerShadowConsumption(result: WorkerShadowConsumptionResult): string {
  return [
    '## WORKER SHADOW SNAPSHOT CONSUMPTION',
    `Version: ${result.version}`,
    `Snapshot loaded: ${result.snapshotLoaded}`,
    `Contract resolved: ${result.contractResolved}`,
    `Publish target resolved: ${result.publishTargetResolved}`,
    `Idempotency resolved: ${result.idempotencyResolved}`,
    `Drift: ${result.driftReport ? result.driftReport.driftKinds.join(', ') || 'none' : 'n/a'}`,
    `Status: ${result.status}`,
  ].join('\n');
}
