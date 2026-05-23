// Snapshot Capture Audit References
//
// Additive companion to the publishing audit contract. Captures the lifecycle
// context of a snapshot capture — timestamp, source, phase, intent, integrity
// status, and the reference ids that bind snapshot/contract/audit together.
// Non-executing; carries no reconciliation behavior.

import { publishSha256, stablePublishStringify } from './universalPublishSnapshot';
import type {
  PublishCaptureIntent,
  PublishCaptureLifecyclePhase,
} from './publishSnapshotCaptureEligibility';

export type PublishCaptureIntegrityStatus = 'capture_integrity_ok' | 'capture_integrity_failed';

export interface PublishCaptureAuditReference {
  version: 'publish-capture-audit-reference-v1';
  captureReferenceId: string;
  captureTimestamp: string;
  captureSource: string;
  captureLifecyclePhase: PublishCaptureLifecyclePhase;
  captureIntent: PublishCaptureIntent;
  captureIntegrityStatus: PublishCaptureIntegrityStatus;
  snapshotId: string;
  publishContractId: string;
  publishVersionHash: string;
  idempotencyKey: string;
  auditContractId: string;
}

export interface PublishCaptureAuditReferenceInput {
  captureSource: string;
  captureLifecyclePhase: PublishCaptureLifecyclePhase;
  captureIntent: PublishCaptureIntent;
  captureIntegrityStatus: PublishCaptureIntegrityStatus;
  snapshotId: string;
  publishContractId: string;
  publishVersionHash: string;
  idempotencyKey: string;
  auditContractId: string;
}

export function buildPublishCaptureAuditReference(
  input: PublishCaptureAuditReferenceInput,
): PublishCaptureAuditReference {
  const captureReferenceId = `capr_${publishSha256(stablePublishStringify([
    input.snapshotId,
    input.publishContractId,
    input.captureSource,
    input.captureLifecyclePhase,
  ])).slice(0, 24)}`;
  return {
    version: 'publish-capture-audit-reference-v1',
    captureReferenceId,
    captureTimestamp: new Date(0).toISOString(),
    captureSource: input.captureSource,
    captureLifecyclePhase: input.captureLifecyclePhase,
    captureIntent: input.captureIntent,
    captureIntegrityStatus: input.captureIntegrityStatus,
    snapshotId: input.snapshotId,
    publishContractId: input.publishContractId,
    publishVersionHash: input.publishVersionHash,
    idempotencyKey: input.idempotencyKey,
    auditContractId: input.auditContractId,
  };
}

export function serializePublishCaptureAuditReference(reference: PublishCaptureAuditReference): string {
  return [
    '## PUBLISH CAPTURE AUDIT REFERENCE',
    `Version: ${reference.version}`,
    `Capture reference id: ${reference.captureReferenceId}`,
    `Capture source: ${reference.captureSource}`,
    `Lifecycle phase: ${reference.captureLifecyclePhase}`,
    `Capture intent: ${reference.captureIntent}`,
    `Integrity status: ${reference.captureIntegrityStatus}`,
    `Snapshot: ${reference.snapshotId} (${reference.publishVersionHash})`,
    `Contract: ${reference.publishContractId}`,
  ].join('\n');
}
