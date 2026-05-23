// Snapshot Soak Verification Service
//
// Loads persisted publish snapshots and runs the shadow verification + cross-
// company isolation + observability layers over them. Verification-only: it
// does NOT publish, execute, mutate, or gate anything. This is the pre-runtime
// soak that must pass before any worker begins consuming frozen snapshots.

import { ownedDbTable } from '../db/writeOwner';
import type { ContentPublishSnapshotRow } from '../../lib/publishing/publishSnapshotRecord';
import {
  verifyShadowPublishSnapshot,
  type ShadowSnapshotVerification,
} from '../../lib/publishing/shadowPublishSnapshotVerification';
import { verifyCrossCompanyIsolation } from '../../lib/publishing/publishSnapshotIsolationVerification';
import {
  summarizeShadowVerifications,
  type ShadowObservabilitySummary,
} from '../../lib/publishing/publishSnapshotShadowObservability';

const TABLE = 'content_publish_snapshots';

export interface PublishSnapshotSoakReport {
  generatedAt: string;
  rowsVerified: number;
  observability: ShadowObservabilitySummary;
  verifications: readonly ShadowSnapshotVerification[];
  idempotencyUniqueness: { unique: boolean; duplicateKeys: readonly string[] };
}

export interface PublishSnapshotSoakInput {
  companyId?: string;
  limit?: number;
}

// Runs the pre-runtime soak verification. Read-only against
// content_publish_snapshots — never writes, never gates.
export async function runPublishSnapshotSoakVerification(
  input: PublishSnapshotSoakInput = {},
): Promise<PublishSnapshotSoakReport> {
  let query = ownedDbTable(TABLE)
    .select('*')
    .order('created_at', { ascending: true })
    .limit(input.limit ?? 500);
  if (input.companyId) query = query.eq('company_id', input.companyId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContentPublishSnapshotRow[];

  const verifications = rows.map(verifyShadowPublishSnapshot);
  const crossCompanyIsolation = verifyCrossCompanyIsolation(rows);
  const observability = summarizeShadowVerifications(verifications, crossCompanyIsolation);

  // Repeated-capture idempotency soak — every idempotency key must be unique.
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.idempotency_key, (counts.get(row.idempotency_key) ?? 0) + 1);
  const duplicateKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();

  return {
    generatedAt: new Date(0).toISOString(),
    rowsVerified: rows.length,
    observability,
    verifications,
    idempotencyUniqueness: { unique: duplicateKeys.length === 0, duplicateKeys },
  };
}
