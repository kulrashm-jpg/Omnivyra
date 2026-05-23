// Snapshot Integrity Utilities
//
// Deterministic verification of publish snapshots and contracts: hash
// generation, integrity verification, immutability verification, contract
// verification, and snapshot-reference validation.
//
// Pure and deterministic — no execution, no mutation.

import {
  computeSnapshotHash,
  type UniversalPublishSnapshot,
} from './universalPublishSnapshot';
import type {
  PublishSnapshotReference,
  UniversalPublishingContract,
} from './universalPublishingContract';

export interface VerificationResult {
  valid: boolean;
  reasons: readonly string[];
}

// Recomputes the deterministic content hash for a snapshot.
export function generateSnapshotHash(snapshot: UniversalPublishSnapshot): string {
  return computeSnapshotHash(snapshot);
}

// Verifies the snapshot's declared hash matches its content.
export function verifySnapshotIntegrity(snapshot: UniversalPublishSnapshot): VerificationResult {
  const recomputed = generateSnapshotHash(snapshot);
  const reasons: string[] = [];
  if (recomputed !== snapshot.publishVersionHash) {
    reasons.push(`hash mismatch: declared ${snapshot.publishVersionHash}, recomputed ${recomputed}`);
  }
  if (snapshot.snapshotId !== `snap_${snapshot.publishVersionHash.slice(0, 24)}`) {
    reasons.push('snapshot id is not derived from the publish version hash');
  }
  return { valid: reasons.length === 0, reasons };
}

function isDeeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeeplyFrozen);
}

// Verifies the snapshot is deeply immutable.
export function verifySnapshotImmutability(snapshot: UniversalPublishSnapshot): VerificationResult {
  const reasons: string[] = [];
  if (snapshot.immutable !== true) reasons.push('snapshot is not marked immutable');
  if (!isDeeplyFrozen(snapshot)) reasons.push('snapshot is not deeply frozen');
  return { valid: reasons.length === 0, reasons };
}

// Validates that a snapshot reference points at the given snapshot.
export function validateSnapshotReference(
  reference: PublishSnapshotReference,
  snapshot: UniversalPublishSnapshot,
): VerificationResult {
  const reasons: string[] = [];
  if (reference.snapshotId !== snapshot.snapshotId) reasons.push('snapshot id mismatch');
  if (reference.publishVersionHash !== snapshot.publishVersionHash) reasons.push('publish version hash mismatch');
  if (reference.contentType !== snapshot.contentType) reasons.push('content type mismatch');
  return { valid: reasons.length === 0, reasons };
}

// Verifies a publishing contract against its snapshot — reference + integrity.
export function verifyPublishContract(
  contract: UniversalPublishingContract,
  snapshot: UniversalPublishSnapshot,
): VerificationResult {
  const reasons: string[] = [];
  const integrity = verifySnapshotIntegrity(snapshot);
  if (!integrity.valid) reasons.push(...integrity.reasons);
  const reference = validateSnapshotReference(contract.snapshotReference, snapshot);
  if (!reference.valid) reasons.push(...reference.reasons);
  if (contract.companyId !== snapshot.companyContext.companyId) reasons.push('company id mismatch');
  if (contract.websiteId !== snapshot.companyContext.websiteId) reasons.push('website id mismatch');
  if (contract.integrationId !== snapshot.companyContext.integrationId) reasons.push('integration id mismatch');
  return { valid: reasons.length === 0, reasons };
}

export function serializeVerificationResult(label: string, result: VerificationResult): string {
  return [
    `## ${label}`,
    `Valid: ${result.valid}`,
    `Reasons: ${result.reasons.join('; ') || 'none'}`,
  ].join('\n');
}
