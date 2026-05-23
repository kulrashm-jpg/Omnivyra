// Shadow Snapshot Verification Layer
//
// Deterministic, non-mutating, advisory-only verification of a single
// persisted publish snapshot row. Confirms the persisted snapshot, contract,
// audit references, version locking, idempotency behavior, and company
// isolation are all internally correct — BEFORE any worker/runtime begins
// consuming frozen snapshots. Verification-only; nothing is gated or mutated.

import { buildUniversalPublishingContract } from './universalPublishingContract';
import {
  hydratePublishSnapshotRow,
  type ContentPublishSnapshotRow,
} from './publishSnapshotRecord';
import {
  verifyPersistedHashConsistency,
  verifyPersistedContract,
  verifyPersistedImmutability,
} from './persistedSnapshotIntegrity';
import { verifyRowOwnershipConsistency } from './publishSnapshotIsolationVerification';
import {
  deriveVerificationStatus,
  type PublishVerificationFinding,
  type PublishVerificationStatus,
} from './publishVerificationStatus';

export interface ShadowSnapshotVerification {
  version: 'shadow-publish-snapshot-verification-v1';
  snapshotId: string;
  publishContractId: string;
  companyId: string;
  status: PublishVerificationStatus;
  findings: readonly PublishVerificationFinding[];
  checks: {
    persistedSnapshotCorrect: boolean;
    persistedContractCorrect: boolean;
    persistedAuditReferencesCorrect: boolean;
    persistedVersionLockingCorrect: boolean;
    persistedIdempotencyCorrect: boolean;
    persistedCompanyIsolationCorrect: boolean;
  };
}

export function verifyShadowPublishSnapshot(row: ContentPublishSnapshotRow): ShadowSnapshotVerification {
  const findings: PublishVerificationFinding[] = [];

  // Persisted snapshot correctness — hash + immutability.
  const hash = verifyPersistedHashConsistency(row);
  if (!hash.valid) {
    findings.push({ code: 'persisted_hash_mismatch', severity: 'invalid', message: hash.reasons.join('; ') });
  }
  const immutability = verifyPersistedImmutability(row);
  if (!immutability.valid) {
    findings.push({ code: 'persisted_immutability_violation', severity: 'invalid', message: immutability.reasons.join('; ') });
  }

  // Persisted contract correctness.
  const contract = verifyPersistedContract(row);
  if (!contract.valid) {
    findings.push({ code: 'persisted_contract_invalid', severity: 'invalid', message: contract.reasons.join('; ') });
  }

  // Persisted audit references.
  const auditReasons: string[] = [];
  const audit = row.audit_payload;
  if (audit.snapshotAuditReference.publishVersionHash !== row.publish_version_hash) {
    auditReasons.push('audit snapshot reference hash mismatch');
  }
  if (audit.contractAuditReference.publishContractId !== row.publish_contract_id) {
    auditReasons.push('audit contract reference id mismatch');
  }
  if (audit.contractAuditReference.publishIdempotencyKey !== row.idempotency_key) {
    auditReasons.push('audit idempotency reference mismatch');
  }
  if (auditReasons.length > 0) {
    findings.push({ code: 'persisted_audit_reference_mismatch', severity: 'risk', message: auditReasons.join('; ') });
  }

  // Persisted version locking.
  const versionReasons: string[] = [];
  if (row.publish_intent === 'schedule') {
    if (!row.scheduled_publish_at) versionReasons.push('scheduled snapshot missing scheduled_publish_at');
    if (row.scheduled_publish_at !== row.snapshot_payload.scheduledTimestamp) {
      versionReasons.push('scheduled_publish_at column drifts from snapshot');
    }
  }
  if (versionReasons.length > 0) {
    findings.push({ code: 'persisted_version_lock_drift', severity: 'risk', message: versionReasons.join('; ') });
  }

  // Persisted idempotency reproducibility.
  const rebuilt = buildUniversalPublishingContract({
    snapshot: hydratePublishSnapshotRow(row).snapshot,
    publishTargetType: row.contract_payload.publishTargetType,
    publishMode: row.contract_payload.publishMode,
    publishIntent: row.contract_payload.publishIntent,
  });
  const idempotencyOk = rebuilt.publishIdempotencyKey === row.idempotency_key
    && rebuilt.publishContractId === row.publish_contract_id;
  if (!idempotencyOk) {
    findings.push({ code: 'persisted_idempotency_non_reproducible', severity: 'risk', message: 'idempotency key or contract id is not reproducible' });
  }

  // Persisted company isolation.
  const isolation = verifyRowOwnershipConsistency(row);
  if (!isolation.consistent) findings.push(...isolation.findings);

  return {
    version: 'shadow-publish-snapshot-verification-v1',
    snapshotId: row.snapshot_id,
    publishContractId: row.publish_contract_id,
    companyId: row.company_id,
    status: deriveVerificationStatus(findings),
    findings,
    checks: {
      persistedSnapshotCorrect: hash.valid && immutability.valid,
      persistedContractCorrect: contract.valid,
      persistedAuditReferencesCorrect: auditReasons.length === 0,
      persistedVersionLockingCorrect: versionReasons.length === 0,
      persistedIdempotencyCorrect: idempotencyOk,
      persistedCompanyIsolationCorrect: isolation.consistent,
    },
  };
}

export function serializeShadowSnapshotVerification(verification: ShadowSnapshotVerification): string {
  return [
    '## SHADOW PUBLISH SNAPSHOT VERIFICATION',
    `Version: ${verification.version}`,
    `Snapshot: ${verification.snapshotId}`,
    `Contract: ${verification.publishContractId}`,
    `Company: ${verification.companyId}`,
    `Status: ${verification.status}`,
    `Findings: ${verification.findings.map((finding) => `${finding.code}(${finding.severity})`).join('; ') || 'none'}`,
  ].join('\n');
}
