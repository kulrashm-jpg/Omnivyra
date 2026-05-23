// Shadow Snapshot Worker Resolver
//
// Read-only, non-executing, shadow-only resolution of a persisted publish
// snapshot for a publishing worker. Resolves by publish contract id,
// idempotency key, blog/content id, or scheduled-publish reference (the
// content-addressed snapshot id), then hydrates the frozen snapshot, contract,
// and audit references.
//
// This NEVER publishes, executes, or mutates — it only resolves and hydrates.

import type { UniversalPublishSnapshot } from './universalPublishSnapshot';
import type { UniversalPublishingContract } from './universalPublishingContract';
import type { PublishingAuditContract } from './publishingAuditContracts';
import {
  hydratePublishSnapshotRow,
  type ContentPublishSnapshotRow,
} from './publishSnapshotRecord';

export type WorkerSnapshotResolutionKey =
  | { kind: 'publish_contract_id'; value: string }
  | { kind: 'idempotency_key'; value: string }
  | { kind: 'blog_id'; value: string }
  | { kind: 'scheduled_publish_reference'; value: string };

export interface WorkerSnapshotResolution {
  version: 'worker-snapshot-resolution-v1';
  resolved: boolean;
  resolutionKey: WorkerSnapshotResolutionKey;
  matchedRowCount: number;
  row: ContentPublishSnapshotRow | null;
  snapshot: UniversalPublishSnapshot | null;
  contract: UniversalPublishingContract | null;
  audit: PublishingAuditContract | null;
  reasons: readonly string[];
}

function matchRows(
  rows: readonly ContentPublishSnapshotRow[],
  key: WorkerSnapshotResolutionKey,
): ContentPublishSnapshotRow[] {
  switch (key.kind) {
    case 'publish_contract_id':
      return rows.filter((row) => row.publish_contract_id === key.value);
    case 'idempotency_key':
      return rows.filter((row) => row.idempotency_key === key.value);
    case 'blog_id':
      return rows.filter((row) => row.blog_id === key.value);
    case 'scheduled_publish_reference':
      // The snapshot id is content + schedule addressed — it IS the
      // canonical scheduled-publish reference.
      return rows.filter((row) => row.snapshot_id === key.value);
  }
}

export function resolveWorkerSnapshot(
  rows: readonly ContentPublishSnapshotRow[],
  key: WorkerSnapshotResolutionKey,
): WorkerSnapshotResolution {
  const matched = matchRows(rows, key);
  const reasons: string[] = [];
  let resolved = false;
  let row: ContentPublishSnapshotRow | null = matched[0] ?? null;

  if (matched.length === 0) {
    reasons.push(`no persisted snapshot matched ${key.kind}=${key.value}`);
  } else if (matched.length === 1) {
    resolved = true;
  } else {
    reasons.push(`ambiguous: ${matched.length} rows matched ${key.kind}=${key.value}`);
  }

  let snapshot: UniversalPublishSnapshot | null = null;
  let contract: UniversalPublishingContract | null = null;
  let audit: PublishingAuditContract | null = null;

  if (resolved && row) {
    const hydrated = hydratePublishSnapshotRow(row);
    snapshot = hydrated.snapshot;
    contract = hydrated.contract;
    audit = hydrated.audit;
    if (!hydrated.hashConsistent) {
      reasons.push('hydrated snapshot hash is inconsistent with the persisted hash');
    }
  }

  return {
    version: 'worker-snapshot-resolution-v1',
    resolved,
    resolutionKey: key,
    matchedRowCount: matched.length,
    row,
    snapshot,
    contract,
    audit,
    reasons,
  };
}

export function serializeWorkerSnapshotResolution(resolution: WorkerSnapshotResolution): string {
  return [
    '## WORKER SNAPSHOT RESOLUTION',
    `Version: ${resolution.version}`,
    `Resolution key: ${resolution.resolutionKey.kind}=${resolution.resolutionKey.value}`,
    `Resolved: ${resolution.resolved}`,
    `Matched rows: ${resolution.matchedRowCount}`,
    `Snapshot: ${resolution.snapshot ? resolution.snapshot.snapshotId : 'none'}`,
    `Reasons: ${resolution.reasons.join('; ') || 'none'}`,
  ].join('\n');
}
