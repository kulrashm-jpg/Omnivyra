// Worker Compatibility Verification
//
// Deterministic verification that a resolved frozen snapshot + contract + audit
// are complete and compatible with worker snapshot consumption and the publish
// target. Verification-only — no runtime mutation, no gating.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';
import type { UniversalPublishingContract } from './universalPublishingContract';
import type { PublishingAuditContract } from './publishingAuditContracts';
import { isPublishModeSupported } from './publishTargetCompatibility';
import {
  deriveSnapshotRuntimeStatus,
  type SnapshotRuntimeFinding,
  type SnapshotRuntimeStatus,
} from './workerSnapshotRuntimeStatus';
import type { WorkerSnapshotResolution } from './workerSnapshotResolver';

export interface WorkerCompatibilityVerification {
  status: SnapshotRuntimeStatus;
  findings: readonly SnapshotRuntimeFinding[];
  checks: {
    workerSnapshotCompatible: boolean;
    publishTargetCompatible: boolean;
    frozenSnapshotComplete: boolean;
    contractComplete: boolean;
    auditComplete: boolean;
    workerResolutionComplete: boolean;
  };
}

export interface WorkerCompatibilityInput {
  snapshot: UniversalPublishSnapshot | null;
  contract: UniversalPublishingContract | null;
  audit: PublishingAuditContract | null;
  resolution: WorkerSnapshotResolution;
}

export function verifyWorkerSnapshotCompatibility(
  input: WorkerCompatibilityInput,
): WorkerCompatibilityVerification {
  const { snapshot, contract, audit, resolution } = input;
  const findings: SnapshotRuntimeFinding[] = [];

  const workerSnapshotCompatible =
    !!snapshot && snapshot.version === 'universal-publish-snapshot-v1' && snapshot.immutable === true;
  if (!workerSnapshotCompatible) {
    findings.push({ code: 'worker_snapshot_incompatible', severity: 'invalid', message: 'snapshot is missing or not an immutable universal publish snapshot' });
  }

  const publishTargetCompatible =
    !!contract && isPublishModeSupported(contract.publishTargetType, contract.publishMode);
  if (contract && !publishTargetCompatible) {
    findings.push({ code: 'publish_target_incompatible', severity: 'warning', message: `publish target ${contract.publishTargetType} does not support mode ${contract.publishMode}` });
  }

  const frozenSnapshotComplete =
    !!snapshot
    && snapshot.publishVersionHash.length > 0
    && snapshot.companyContext.companyId.length > 0
    && (snapshot.renderedHtml.trim().length > 0 || snapshot.contentBlocks.length > 0);
  if (snapshot && !frozenSnapshotComplete) {
    findings.push({ code: 'frozen_snapshot_incomplete', severity: 'risk', message: 'frozen snapshot is missing hash, company, or content' });
  }

  const contractComplete =
    !!contract
    && contract.publishContractId.length > 0
    && contract.publishIdempotencyKey.length > 0
    && contract.snapshotReference.publishVersionHash.length > 0;
  if (contract && !contractComplete) {
    findings.push({ code: 'contract_incomplete', severity: 'risk', message: 'publishing contract is missing id, idempotency key, or snapshot reference' });
  }

  const auditComplete =
    !!audit
    && audit.auditContractId.length > 0
    && audit.snapshotAuditReference.publishVersionHash.length > 0
    && audit.contractAuditReference.publishContractId.length > 0;
  if (audit && !auditComplete) {
    findings.push({ code: 'audit_incomplete', severity: 'warning', message: 'audit contract is missing id or references' });
  }

  const workerResolutionComplete = resolution.resolved && !!snapshot && !!contract && !!audit;
  if (!workerResolutionComplete) {
    findings.push({ code: 'worker_resolution_incomplete', severity: 'risk', message: resolution.reasons.join('; ') || 'worker resolution did not produce a complete snapshot bundle' });
  }

  return {
    status: deriveSnapshotRuntimeStatus(findings),
    findings,
    checks: {
      workerSnapshotCompatible,
      publishTargetCompatible,
      frozenSnapshotComplete,
      contractComplete,
      auditComplete,
      workerResolutionComplete,
    },
  };
}

export function serializeWorkerCompatibilityVerification(
  verification: WorkerCompatibilityVerification,
): string {
  return [
    '## WORKER SNAPSHOT COMPATIBILITY VERIFICATION',
    `Status: ${verification.status}`,
    `Worker snapshot compatible: ${verification.checks.workerSnapshotCompatible}`,
    `Publish target compatible: ${verification.checks.publishTargetCompatible}`,
    `Frozen snapshot complete: ${verification.checks.frozenSnapshotComplete}`,
    `Contract complete: ${verification.checks.contractComplete}`,
    `Audit complete: ${verification.checks.auditComplete}`,
    `Worker resolution complete: ${verification.checks.workerResolutionComplete}`,
    `Findings: ${verification.findings.map((finding) => `${finding.code}(${finding.severity})`).join('; ') || 'none'}`,
  ].join('\n');
}
