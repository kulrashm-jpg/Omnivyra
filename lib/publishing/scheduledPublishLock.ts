// Scheduled Version Locking
//
// Once content is scheduled, its publish snapshot becomes locked: the scheduled
// publish always uses the frozen snapshot, and any subsequent edit produces a
// NEW working draft snapshot — it never mutates the locked one.
//
// This module is non-executing: it models the lock and the edit-forking
// behavior. It does not rewrite the publish processor or any execution path.

import {
  createUniversalPublishSnapshot,
  type UniversalPublishSnapshot,
  type UniversalPublishSnapshotInput,
} from './universalPublishSnapshot';
import { publishSha256, stablePublishStringify } from './universalPublishSnapshot';
import type { UniversalPublishingContract } from './universalPublishingContract';

export type ScheduledPublishLockVersion = 'scheduled-publish-lock-v1';
export type ScheduledPublishLockState = 'locked' | 'unlocked';

export interface ScheduledPublishLock {
  version: ScheduledPublishLockVersion;
  lockId: string;
  generatedAt: string;
  lockState: ScheduledPublishLockState;
  lockedSnapshotId: string;
  lockedSnapshotHash: string;
  lockedContractId: string;
  scheduledTimestamp: string | null;
  lockBoundaries: readonly string[];
  lockPreservationRequirements: readonly string[];
}

export interface ScheduledEditResult {
  lock: ScheduledPublishLock;
  // The locked snapshot is returned UNCHANGED — proof of immutability.
  lockedSnapshot: UniversalPublishSnapshot;
  lockedSnapshotUnchanged: boolean;
  // Editing a locked schedule produces a NEW working draft only.
  workingDraftSnapshot: UniversalPublishSnapshot;
}

export function createScheduledPublishLock(
  snapshot: UniversalPublishSnapshot,
  contract: UniversalPublishingContract,
): ScheduledPublishLock {
  const lockId = `lock_${publishSha256(stablePublishStringify([
    snapshot.snapshotId,
    snapshot.publishVersionHash,
    contract.publishContractId,
  ])).slice(0, 24)}`;
  return {
    version: 'scheduled-publish-lock-v1',
    lockId,
    generatedAt: new Date(0).toISOString(),
    lockState: 'locked',
    lockedSnapshotId: snapshot.snapshotId,
    lockedSnapshotHash: snapshot.publishVersionHash,
    lockedContractId: contract.publishContractId,
    scheduledTimestamp: snapshot.scheduledTimestamp,
    lockBoundaries: [
      'locked snapshot is immutable for the lifetime of the schedule',
      'scheduled publishing must use the locked snapshot only',
      'editing must not mutate the locked snapshot',
    ],
    lockPreservationRequirements: [
      'preserve locked snapshot hash until the schedule is published or cancelled',
      'preserve the bound publish contract id',
      'editing produces a new working draft snapshot, never an in-place change',
    ],
  };
}

// Editing a locked schedule: the locked snapshot stays frozen and unchanged;
// the edit becomes a brand-new working draft snapshot.
export function applyEditToLockedSchedule(
  lock: ScheduledPublishLock,
  lockedSnapshot: UniversalPublishSnapshot,
  editedInput: UniversalPublishSnapshotInput,
): ScheduledEditResult {
  const workingDraftSnapshot = createUniversalPublishSnapshot(editedInput);
  const lockedSnapshotUnchanged =
    lockedSnapshot.publishVersionHash === lock.lockedSnapshotHash
    && Object.isFrozen(lockedSnapshot);
  return {
    lock,
    lockedSnapshot,
    lockedSnapshotUnchanged,
    workingDraftSnapshot,
  };
}

// Verifies the lock still references an intact, frozen snapshot.
export function verifyScheduledLockIntact(
  lock: ScheduledPublishLock,
  snapshot: UniversalPublishSnapshot,
): { intact: boolean; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (lock.lockState !== 'locked') reasons.push('lock state is not locked');
  if (lock.lockedSnapshotId !== snapshot.snapshotId) reasons.push('snapshot id mismatch');
  if (lock.lockedSnapshotHash !== snapshot.publishVersionHash) reasons.push('snapshot hash mismatch');
  if (!Object.isFrozen(snapshot)) reasons.push('snapshot is not frozen');
  return { intact: reasons.length === 0, reasons };
}

export function serializeScheduledPublishLock(lock: ScheduledPublishLock): string {
  return [
    '## SCHEDULED PUBLISH LOCK',
    `Version: ${lock.version}`,
    `Lock id: ${lock.lockId}`,
    `Lock state: ${lock.lockState}`,
    `Locked snapshot: ${lock.lockedSnapshotId} (${lock.lockedSnapshotHash})`,
    `Locked contract: ${lock.lockedContractId}`,
    `Scheduled timestamp: ${lock.scheduledTimestamp ?? 'none'}`,
  ].join('\n');
}
