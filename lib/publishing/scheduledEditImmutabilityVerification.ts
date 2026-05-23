// Scheduled Edit Immutability Verification
//
// Deterministic, verification-only utilities confirming that editing scheduled
// content NEVER mutates the persisted scheduled snapshot: the persisted
// snapshot payload, publish version hash, contract payload, and idempotency
// key must all remain unchanged, and an edit must fork a new working draft.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';
import type { ContentPublishSnapshotRow } from './publishSnapshotRecord';
import {
  deriveVerificationStatus,
  type PublishVerificationFinding,
  type PublishVerificationStatus,
} from './publishVerificationStatus';

export interface ScheduledEditImmutabilityInput {
  // The persisted scheduled row as captured.
  persistedRowBefore: ContentPublishSnapshotRow;
  // The same persisted row re-loaded after an edit happened elsewhere.
  persistedRowAfter: ContentPublishSnapshotRow;
  // The new working-draft snapshot the edit produced (optional).
  workingDraftSnapshot?: UniversalPublishSnapshot;
}

export interface ScheduledEditImmutabilityVerification {
  status: PublishVerificationStatus;
  findings: readonly PublishVerificationFinding[];
  checks: {
    persistedSnapshotUnchanged: boolean;
    persistedHashUnchanged: boolean;
    persistedContractUnchanged: boolean;
    persistedIdempotencyUnchanged: boolean;
    editForkedNewDraft: boolean;
  };
}

export function verifyScheduledEditImmutability(
  input: ScheduledEditImmutabilityInput,
): ScheduledEditImmutabilityVerification {
  const { persistedRowBefore: before, persistedRowAfter: after } = input;
  const findings: PublishVerificationFinding[] = [];

  const persistedSnapshotUnchanged =
    JSON.stringify(before.snapshot_payload) === JSON.stringify(after.snapshot_payload);
  const persistedHashUnchanged = before.publish_version_hash === after.publish_version_hash;
  const persistedContractUnchanged =
    JSON.stringify(before.contract_payload) === JSON.stringify(after.contract_payload);
  const persistedIdempotencyUnchanged = before.idempotency_key === after.idempotency_key;

  if (!persistedSnapshotUnchanged) {
    findings.push({ code: 'scheduled_snapshot_mutated', severity: 'invalid', message: 'persisted scheduled snapshot payload changed after an edit' });
  }
  if (!persistedHashUnchanged) {
    findings.push({ code: 'scheduled_hash_mutated', severity: 'invalid', message: 'persisted publish version hash changed after an edit' });
  }
  if (!persistedContractUnchanged) {
    findings.push({ code: 'scheduled_contract_mutated', severity: 'invalid', message: 'persisted publishing contract changed after an edit' });
  }
  if (!persistedIdempotencyUnchanged) {
    findings.push({ code: 'scheduled_idempotency_mutated', severity: 'invalid', message: 'persisted idempotency key changed after an edit' });
  }

  let editForkedNewDraft = true;
  if (input.workingDraftSnapshot) {
    editForkedNewDraft = input.workingDraftSnapshot.publishVersionHash !== before.publish_version_hash;
    if (!editForkedNewDraft) {
      findings.push({ code: 'edit_did_not_fork', severity: 'risk', message: 'working draft shares its hash with the locked scheduled snapshot' });
    }
  }

  return {
    status: deriveVerificationStatus(findings),
    findings,
    checks: {
      persistedSnapshotUnchanged,
      persistedHashUnchanged,
      persistedContractUnchanged,
      persistedIdempotencyUnchanged,
      editForkedNewDraft,
    },
  };
}

export function serializeScheduledEditImmutabilityVerification(
  verification: ScheduledEditImmutabilityVerification,
): string {
  return [
    '## SCHEDULED EDIT IMMUTABILITY VERIFICATION',
    `Status: ${verification.status}`,
    `Snapshot unchanged: ${verification.checks.persistedSnapshotUnchanged}`,
    `Hash unchanged: ${verification.checks.persistedHashUnchanged}`,
    `Contract unchanged: ${verification.checks.persistedContractUnchanged}`,
    `Idempotency unchanged: ${verification.checks.persistedIdempotencyUnchanged}`,
    `Edit forked new draft: ${verification.checks.editForkedNewDraft}`,
  ].join('\n');
}
