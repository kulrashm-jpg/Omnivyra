import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { evaluateAnalyticsMutationSafety } from './analyticsEnvironmentGuardService';

export type SnapshotLifecycleMetadata = {
  snapshot_version: 'ga_gsc_enterprise_v2';
  retention_days: number;
  payload_bytes: number;
  integrity_hash: string;
  integrity_valid: boolean;
  lineage_parent_fingerprint: string | null;
  warmed: boolean;
};

export type SnapshotPruneResult = {
  allowed: boolean;
  deleted: number;
  reason: string;
};

const MAX_SNAPSHOT_PAYLOAD_BYTES = 350_000;
const RETENTION_DAYS = 30;

export function buildSnapshotLifecycleMetadata(input: {
  payload: unknown;
  parentFingerprint?: string | null;
  warmed?: boolean;
}): SnapshotLifecycleMetadata {
  const serialized = JSON.stringify(input.payload);
  const payloadBytes = Buffer.byteLength(serialized, 'utf8');
  const integrityHash = createHash('sha256').update(serialized).digest('hex');
  return {
    snapshot_version: 'ga_gsc_enterprise_v2',
    retention_days: RETENTION_DAYS,
    payload_bytes: payloadBytes,
    integrity_hash: integrityHash,
    integrity_valid: payloadBytes > 0 && payloadBytes <= MAX_SNAPSHOT_PAYLOAD_BYTES,
    lineage_parent_fingerprint: input.parentFingerprint ?? null,
    warmed: Boolean(input.warmed),
  };
}

export function assertSnapshotPayloadSafe(metadata: SnapshotLifecycleMetadata): void {
  if (!metadata.integrity_valid) {
    throw new Error(`Analytics snapshot payload exceeds enterprise size controls (${metadata.payload_bytes} bytes).`);
  }
}

export async function pruneExpiredAnalyticsSnapshots(): Promise<SnapshotPruneResult> {
  const decision = evaluateAnalyticsMutationSafety('snapshot_write');
  if (!decision.allowed) {
    return { allowed: false, deleted: 0, reason: decision.reason };
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ownedDbTable('analytics_intelligence_snapshots')
    .delete()
    .lt('expires_at', cutoff)
    .select('id');

  if (error) {
    throw new Error(`Failed to prune analytics intelligence snapshots: ${error.message}`);
  }

  return {
    allowed: true,
    deleted: Array.isArray(data) ? data.length : 0,
    reason: 'Expired analytics intelligence snapshots pruned.',
  };
}
