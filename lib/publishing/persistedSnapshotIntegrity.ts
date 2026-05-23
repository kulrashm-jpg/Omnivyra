// Persistence Integrity Verification
//
// Deterministic, tamper-detection-only verification of persisted snapshot rows.
// No execution, no mutation. Confirms a stored row's snapshot/contract payloads
// are internally consistent, immutable, and hash-stable.

import { computeSnapshotHash } from './universalPublishSnapshot';
import { verifySnapshotImmutability, verifyPublishContract } from './publishSnapshotIntegrity';
import { hydratePublishSnapshotRow, type ContentPublishSnapshotRow } from './publishSnapshotRecord';

export interface PersistenceVerificationResult {
  valid: boolean;
  reasons: readonly string[];
}

function result(reasons: string[]): PersistenceVerificationResult {
  return { valid: reasons.length === 0, reasons };
}

// The persisted snapshot payload hashes to its declared publish_version_hash.
export function verifyPersistedHashConsistency(row: ContentPublishSnapshotRow): PersistenceVerificationResult {
  const reasons: string[] = [];
  const recomputed = computeSnapshotHash(row.snapshot_payload);
  if (recomputed !== row.publish_version_hash) {
    reasons.push(`row hash mismatch: column ${row.publish_version_hash}, recomputed ${recomputed}`);
  }
  if (row.snapshot_payload.publishVersionHash !== row.publish_version_hash) {
    reasons.push('snapshot payload hash does not match the row hash column');
  }
  return result(reasons);
}

// Row scalar columns agree with the embedded snapshot/contract payloads.
export function verifyPersistedReferenceConsistency(row: ContentPublishSnapshotRow): PersistenceVerificationResult {
  const reasons: string[] = [];
  const snapshot = row.snapshot_payload;
  const contract = row.contract_payload;
  if (row.snapshot_id !== snapshot.snapshotId) reasons.push('row snapshot_id mismatch');
  if (row.publish_contract_id !== contract.publishContractId) reasons.push('row publish_contract_id mismatch');
  if (row.idempotency_key !== contract.publishIdempotencyKey) reasons.push('row idempotency_key mismatch');
  if (row.company_id !== snapshot.companyContext.companyId) reasons.push('row company_id mismatch');
  if (row.content_type !== snapshot.contentType) reasons.push('row content_type mismatch');
  if (row.publish_target_type !== contract.publishTargetType) reasons.push('row publish_target_type mismatch');
  if (row.publish_mode !== contract.publishMode) reasons.push('row publish_mode mismatch');
  if (row.publish_intent !== snapshot.publishIntent) reasons.push('row publish_intent mismatch');
  if (row.scheduled_publish_at !== snapshot.scheduledTimestamp) reasons.push('row scheduled_publish_at mismatch');
  if (contract.snapshotReference.publishVersionHash !== snapshot.publishVersionHash) {
    reasons.push('contract snapshot reference hash mismatch');
  }
  return result(reasons);
}

// Persisted contract verifies against its persisted snapshot.
export function verifyPersistedContract(row: ContentPublishSnapshotRow): PersistenceVerificationResult {
  const hydrated = hydratePublishSnapshotRow(row);
  return verifyPublishContract(hydrated.contract, hydrated.snapshot);
}

// Re-hydrated snapshot is deeply immutable and hash-stable.
export function verifyPersistedImmutability(row: ContentPublishSnapshotRow): PersistenceVerificationResult {
  const hydrated = hydratePublishSnapshotRow(row);
  const reasons: string[] = [];
  if (!hydrated.hashConsistent) reasons.push('rehydrated snapshot hash does not match persisted hash');
  const immutability = verifySnapshotImmutability(hydrated.snapshot);
  if (!immutability.valid) reasons.push(...immutability.reasons);
  return result(reasons);
}

// Aggregate verification — runs every persisted integrity check.
export function verifyPersistedSnapshotRow(row: ContentPublishSnapshotRow): PersistenceVerificationResult {
  const reasons: string[] = [];
  for (const check of [
    verifyPersistedHashConsistency(row),
    verifyPersistedReferenceConsistency(row),
    verifyPersistedContract(row),
    verifyPersistedImmutability(row),
  ]) {
    if (!check.valid) reasons.push(...check.reasons);
  }
  return result(reasons);
}

export function serializePersistenceVerification(
  label: string,
  verification: PersistenceVerificationResult,
): string {
  return [
    `## ${label}`,
    `Valid: ${verification.valid}`,
    `Reasons: ${verification.reasons.join('; ') || 'none'}`,
  ].join('\n');
}
