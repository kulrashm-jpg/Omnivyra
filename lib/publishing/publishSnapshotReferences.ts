// Snapshot Reference Resolution
//
// Deterministic, pure reference-resolution utilities over a collection of
// persisted snapshot rows. No DB access, no execution — these are lookup
// helpers that future runtime/worker layers can use to resolve a snapshot,
// contract, audit, idempotency key, or publish version.

import type { ContentPublishSnapshotRow } from './publishSnapshotRecord';
import type { PublishingAuditContract } from './publishingAuditContracts';
import type { UniversalPublishingContract } from './universalPublishingContract';

// A snapshot_id is content-addressed and may map to multiple rows
// (e.g. the same content published to multiple targets).
export function resolveRowsBySnapshotId(
  rows: readonly ContentPublishSnapshotRow[],
  snapshotId: string,
): ContentPublishSnapshotRow[] {
  return rows.filter((row) => row.snapshot_id === snapshotId);
}

// publish_contract_id is unique per (snapshot, target, mode).
export function resolveRowByContractId(
  rows: readonly ContentPublishSnapshotRow[],
  publishContractId: string,
): ContentPublishSnapshotRow | undefined {
  return rows.find((row) => row.publish_contract_id === publishContractId);
}

// idempotency_key is unique per publish attempt.
export function resolveRowByIdempotencyKey(
  rows: readonly ContentPublishSnapshotRow[],
  idempotencyKey: string,
): ContentPublishSnapshotRow | undefined {
  return rows.find((row) => row.idempotency_key === idempotencyKey);
}

export function resolveRowsByPublishVersionHash(
  rows: readonly ContentPublishSnapshotRow[],
  publishVersionHash: string,
): ContentPublishSnapshotRow[] {
  return rows.filter((row) => row.publish_version_hash === publishVersionHash);
}

export function resolveContractByContractId(
  rows: readonly ContentPublishSnapshotRow[],
  publishContractId: string,
): UniversalPublishingContract | undefined {
  return resolveRowByContractId(rows, publishContractId)?.contract_payload;
}

export function resolveAuditByContractId(
  rows: readonly ContentPublishSnapshotRow[],
  publishContractId: string,
): PublishingAuditContract | undefined {
  return resolveRowByContractId(rows, publishContractId)?.audit_payload;
}

export interface SnapshotReferenceIndex {
  bySnapshotId: ReadonlyMap<string, ContentPublishSnapshotRow[]>;
  byContractId: ReadonlyMap<string, ContentPublishSnapshotRow>;
  byIdempotencyKey: ReadonlyMap<string, ContentPublishSnapshotRow>;
  byPublishVersionHash: ReadonlyMap<string, ContentPublishSnapshotRow[]>;
}

// Deterministic index build — useful for batch resolution.
export function buildSnapshotReferenceIndex(
  rows: readonly ContentPublishSnapshotRow[],
): SnapshotReferenceIndex {
  const bySnapshotId = new Map<string, ContentPublishSnapshotRow[]>();
  const byContractId = new Map<string, ContentPublishSnapshotRow>();
  const byIdempotencyKey = new Map<string, ContentPublishSnapshotRow>();
  const byPublishVersionHash = new Map<string, ContentPublishSnapshotRow[]>();
  for (const row of rows) {
    (bySnapshotId.get(row.snapshot_id) ?? bySnapshotId.set(row.snapshot_id, []).get(row.snapshot_id)!)
      .push(row);
    if (!byContractId.has(row.publish_contract_id)) byContractId.set(row.publish_contract_id, row);
    if (!byIdempotencyKey.has(row.idempotency_key)) byIdempotencyKey.set(row.idempotency_key, row);
    (byPublishVersionHash.get(row.publish_version_hash)
      ?? byPublishVersionHash.set(row.publish_version_hash, []).get(row.publish_version_hash)!)
      .push(row);
  }
  return { bySnapshotId, byContractId, byIdempotencyKey, byPublishVersionHash };
}
