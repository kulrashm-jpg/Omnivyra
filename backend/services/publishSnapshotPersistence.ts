// Snapshot Persistence Service
//
// Thin, additive persistence wrapper over the `content_publish_snapshots`
// table. It persists and loads immutable publish snapshots + publishing
// contracts. It does NOT publish, schedule, execute, or rewrite any worker /
// queue / scheduler. There is intentionally NO update API for frozen
// snapshot/contract payloads — persisted records are immutable.

import { ownedDbTable } from '../db/writeOwner';
import type { UniversalPublishSnapshot } from '../../lib/publishing/universalPublishSnapshot';
import type { UniversalPublishingContract } from '../../lib/publishing/universalPublishingContract';
import { buildPublishingAuditContract, type PublishingAuditContract } from '../../lib/publishing/publishingAuditContracts';
import {
  buildPublishSnapshotRow,
  hydratePublishSnapshotRow,
  type ContentPublishSnapshotRow,
  type HydratedPublishSnapshot,
} from '../../lib/publishing/publishSnapshotRecord';
import {
  verifyPersistedSnapshotRow,
  type PersistenceVerificationResult,
} from '../../lib/publishing/persistedSnapshotIntegrity';

const TABLE = 'content_publish_snapshots';

export interface CreatePersistedSnapshotInput {
  snapshot: UniversalPublishSnapshot;
  contract: UniversalPublishingContract;
  audit?: PublishingAuditContract;
  blogId?: string | null;
  contentId?: string | null;
}

// Persist an immutable snapshot + contract. Idempotent: a second call with the
// same publish idempotency key returns the already-persisted record rather
// than creating a duplicate.
export async function createPersistedSnapshot(
  input: CreatePersistedSnapshotInput,
): Promise<ContentPublishSnapshotRow> {
  const audit = input.audit
    ?? buildPublishingAuditContract({ snapshot: input.snapshot, contract: input.contract });
  const row = buildPublishSnapshotRow({
    snapshot: input.snapshot,
    contract: input.contract,
    audit,
    blogId: input.blogId ?? null,
    contentId: input.contentId ?? null,
  });

  const inserted = await ownedDbTable(TABLE)
    .upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (inserted.error) throw new Error(inserted.error.message);
  if (inserted.data) return inserted.data as ContentPublishSnapshotRow;

  // Conflict path — the record already exists; return the persisted row.
  const existing = await loadPersistedSnapshotRowByIdempotencyKey(row.idempotency_key);
  if (!existing) throw new Error('Persisted snapshot not found after idempotent conflict');
  return existing;
}

export async function loadPersistedSnapshotRowByContractId(
  publishContractId: string,
): Promise<ContentPublishSnapshotRow | null> {
  const { data, error } = await ownedDbTable(TABLE)
    .select('*')
    .eq('publish_contract_id', publishContractId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContentPublishSnapshotRow) ?? null;
}

export async function loadPersistedSnapshotRowByIdempotencyKey(
  idempotencyKey: string,
): Promise<ContentPublishSnapshotRow | null> {
  const { data, error } = await ownedDbTable(TABLE)
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContentPublishSnapshotRow) ?? null;
}

export async function loadPersistedSnapshotRowsBySnapshotId(
  snapshotId: string,
): Promise<ContentPublishSnapshotRow[]> {
  const { data, error } = await ownedDbTable(TABLE)
    .select('*')
    .eq('snapshot_id', snapshotId);
  if (error) throw new Error(error.message);
  return (data as ContentPublishSnapshotRow[]) ?? [];
}

// Loads and re-hydrates a persisted snapshot (re-frozen, re-hashed).
export async function loadPersistedSnapshot(
  publishContractId: string,
): Promise<HydratedPublishSnapshot | null> {
  const row = await loadPersistedSnapshotRowByContractId(publishContractId);
  return row ? hydratePublishSnapshotRow(row) : null;
}

export async function loadPersistedPublishingContract(
  publishContractId: string,
): Promise<UniversalPublishingContract | null> {
  const hydrated = await loadPersistedSnapshot(publishContractId);
  return hydrated?.contract ?? null;
}

export async function loadPersistedAuditContract(
  publishContractId: string,
): Promise<PublishingAuditContract | null> {
  const hydrated = await loadPersistedSnapshot(publishContractId);
  return hydrated?.audit ?? null;
}

// Loads a persisted record and runs full tamper-detection verification.
export async function verifyPersistedSnapshotIntegrity(
  publishContractId: string,
): Promise<PersistenceVerificationResult> {
  const row = await loadPersistedSnapshotRowByContractId(publishContractId);
  if (!row) return { valid: false, reasons: ['persisted snapshot not found'] };
  return verifyPersistedSnapshotRow(row);
}
