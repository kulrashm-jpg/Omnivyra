// Publishing Audit Structure
//
// Non-executing audit contract binding an immutable snapshot and a publishing
// contract to a deterministic audit identity, with reference slots for the
// future publish lifecycle, reconciliation, retry, and rollback layers.
//
// No execution — this defines the audit shape that future layers will append
// to. It records nothing on its own.

import { publishSha256, stablePublishStringify, type UniversalPublishSnapshot } from './universalPublishSnapshot';
import type { UniversalPublishingContract } from './universalPublishingContract';

export type PublishingAuditContractVersion = 'publishing-audit-contract-v1';

export interface SnapshotAuditReference {
  snapshotId: string;
  publishVersionHash: string;
  contentType: string;
}

export interface ContractAuditReference {
  publishContractId: string;
  publishVersion: string;
  publishIdempotencyKey: string;
  publishMode: string;
  publishTargetType: string;
}

export interface PublishingAuditContract {
  version: PublishingAuditContractVersion;
  auditContractId: string;
  generatedAt: string;
  companyId: string;
  websiteId: string;
  snapshotAuditReference: SnapshotAuditReference;
  contractAuditReference: ContractAuditReference;
  publishLifecycleReferences: readonly string[];
  reconciliationReferences: readonly string[];
  retryReferences: readonly string[];
  rollbackReferences: readonly string[];
  auditRequirements: readonly string[];
}

export interface PublishingAuditContractInput {
  snapshot: UniversalPublishSnapshot;
  contract: UniversalPublishingContract;
}

export function buildPublishingAuditContract(
  input: PublishingAuditContractInput,
): PublishingAuditContract {
  const { snapshot, contract } = input;
  const auditContractId = `pauc_${publishSha256(stablePublishStringify([
    snapshot.snapshotId,
    snapshot.publishVersionHash,
    contract.publishContractId,
    contract.publishIdempotencyKey,
  ])).slice(0, 24)}`;

  return {
    version: 'publishing-audit-contract-v1',
    auditContractId,
    generatedAt: new Date(0).toISOString(),
    companyId: contract.companyId,
    websiteId: contract.websiteId,
    snapshotAuditReference: {
      snapshotId: snapshot.snapshotId,
      publishVersionHash: snapshot.publishVersionHash,
      contentType: snapshot.contentType,
    },
    contractAuditReference: {
      publishContractId: contract.publishContractId,
      publishVersion: contract.publishVersion,
      publishIdempotencyKey: contract.publishIdempotencyKey,
      publishMode: contract.publishMode,
      publishTargetType: contract.publishTargetType,
    },
    // Lifecycle references — populated as the snapshot/contract are prepared.
    publishLifecycleReferences: [
      `snapshot:${snapshot.snapshotId}`,
      `contract:${contract.publishContractId}`,
      `contract-state:${contract.publishState}`,
    ],
    // Future layers append here — empty by design at the contract stage.
    reconciliationReferences: [],
    retryReferences: [],
    rollbackReferences: [],
    auditRequirements: [
      'audit contract is non-executing and append-only',
      'record snapshot id and publish version hash for every publish attempt',
      'record publish contract id and idempotency key',
      'reconciliation, retry, and rollback references are reserved for future layers',
      'audit records must never mutate the referenced snapshot or contract',
    ],
  };
}

export function serializePublishingAuditContract(audit: PublishingAuditContract): string {
  return [
    '## PUBLISHING AUDIT CONTRACT',
    `Version: ${audit.version}`,
    `Audit contract id: ${audit.auditContractId}`,
    `Snapshot: ${audit.snapshotAuditReference.snapshotId} (${audit.snapshotAuditReference.publishVersionHash})`,
    `Contract: ${audit.contractAuditReference.publishContractId}`,
    `Idempotency key: ${audit.contractAuditReference.publishIdempotencyKey}`,
    `Lifecycle references: ${audit.publishLifecycleReferences.join('; ')}`,
    `Reconciliation/retry/rollback references: ${
      audit.reconciliationReferences.length + audit.retryReferences.length + audit.rollbackReferences.length
    } (reserved)`,
  ].join('\n');
}
