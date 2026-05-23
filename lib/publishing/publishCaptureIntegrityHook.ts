// Persistence Integrity Verification Hook
//
// Runs BEFORE a captured snapshot is persisted. Verifies snapshot integrity,
// contract integrity, idempotency integrity, and version-lock consistency.
// Returns an advisory result only — it NEVER blocks or gates runtime. The
// capture service reads `valid` and decides whether to persist.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';
import {
  buildUniversalPublishingContract,
  type UniversalPublishingContract,
} from './universalPublishingContract';
import { verifySnapshotIntegrity, verifyPublishContract } from './publishSnapshotIntegrity';
import type { ScheduledPublishLock } from './scheduledPublishLock';

export interface PublishCaptureIntegrityResult {
  valid: boolean;
  reasons: readonly string[];
  checks: {
    snapshotIntegrity: boolean;
    contractIntegrity: boolean;
    idempotencyIntegrity: boolean;
    versionLockConsistency: boolean;
  };
}

export function verifyCaptureBeforePersistence(
  snapshot: UniversalPublishSnapshot,
  contract: UniversalPublishingContract,
  scheduledLock: ScheduledPublishLock | null,
): PublishCaptureIntegrityResult {
  const reasons: string[] = [];

  const snapshotIntegrity = verifySnapshotIntegrity(snapshot);
  if (!snapshotIntegrity.valid) reasons.push(...snapshotIntegrity.reasons);

  const contractIntegrity = verifyPublishContract(contract, snapshot);
  if (!contractIntegrity.valid) reasons.push(...contractIntegrity.reasons);

  // Idempotency integrity — the persisted key must equal a freshly recomputed one.
  const recomputed = buildUniversalPublishingContract({
    snapshot,
    publishTargetType: contract.publishTargetType,
    publishMode: contract.publishMode,
    publishIntent: contract.publishIntent,
  });
  const idempotencyOk = recomputed.publishIdempotencyKey === contract.publishIdempotencyKey
    && recomputed.publishContractId === contract.publishContractId;
  if (!idempotencyOk) reasons.push('idempotency key or contract id is not reproducible');

  // Version-lock consistency — if a lock exists it must reference this exact snapshot.
  let versionLockConsistency = true;
  if (scheduledLock) {
    if (scheduledLock.lockedSnapshotHash !== snapshot.publishVersionHash) {
      versionLockConsistency = false;
      reasons.push('scheduled lock hash does not match snapshot');
    }
    if (scheduledLock.lockedContractId !== contract.publishContractId) {
      versionLockConsistency = false;
      reasons.push('scheduled lock contract id does not match contract');
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
    checks: {
      snapshotIntegrity: snapshotIntegrity.valid,
      contractIntegrity: contractIntegrity.valid,
      idempotencyIntegrity: idempotencyOk,
      versionLockConsistency,
    },
  };
}

export function serializePublishCaptureIntegrity(result: PublishCaptureIntegrityResult): string {
  return [
    '## PUBLISH CAPTURE INTEGRITY',
    `Valid: ${result.valid}`,
    `Snapshot integrity: ${result.checks.snapshotIntegrity}`,
    `Contract integrity: ${result.checks.contractIntegrity}`,
    `Idempotency integrity: ${result.checks.idempotencyIntegrity}`,
    `Version-lock consistency: ${result.checks.versionLockConsistency}`,
    `Reasons: ${result.reasons.join('; ') || 'none'}`,
  ].join('\n');
}
