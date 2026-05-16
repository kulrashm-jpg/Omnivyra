/**
 * Phase 8 — Distributed execution partition coordination.
 *
 * Bounded lease-based ownership. A worker calls `acquirePartitionLease` to
 * claim ownership of a (org, partition_key); the service refuses if an
 * unexpired lease is already held by another worker. Renewal extends the
 * lease via `renewPartitionLease`. Recovery is operator-triggered ONLY —
 * `recoverExpiredLeases` flips expired rows to `expired` so a new worker
 * can claim them. No autonomous recovery loop exists.
 *
 * Hard guarantees:
 *   • At most one active lease per (org, partition_key). UNIQUE constraint
 *     on (org, partition_key) + service-level atomic upsert protects this.
 *   • Idempotent renewals — same worker can re-renew without contention.
 *   • Tenant-scoped: every read/write starts on organization_id.
 *   • No worker scaling logic in this service; workers self-identify by
 *     `workerId` and announce themselves at lease time.
 */

import { ownedDbTable } from '../db/writeOwner';
import type { ExecutionPartition, PartitionStatus } from '../types/executionPartition';
import {
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_RECOVERY_BATCH,
} from '../types/executionPartition';

export type LeaseAcquireInput = {
  organizationId: string;
  partitionKey: string;
  workerId: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
};

export type LeaseAcquireResult =
  | { ok: true; partition: ExecutionPartition; renewed: boolean }
  | { ok: false; reason: 'held_by_other_worker'; current_owner: string | null; lease_expires_at: string | null };

export async function acquirePartitionLease(input: LeaseAcquireInput): Promise<LeaseAcquireResult> {
  const ttl = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const now = Date.now();
  const expiresAt = new Date(now + ttl).toISOString();
  const nowIso = new Date(now).toISOString();

  // Read existing row first.
  const { data: existing } = await ownedDbTable('execution_partitions')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('partition_key', input.partitionKey)
    .maybeSingle();
  const row = existing as ExecutionPartition | null;

  if (row && row.status === 'leased' && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > now) {
    // Already held — only the current owner can renew.
    if (row.owner_worker_id === input.workerId) {
      const { data: renewed, error } = await ownedDbTable('execution_partitions')
        .update({
          lease_expires_at: expiresAt,
          heartbeat_at: nowIso,
        })
        .eq('id', row.id)
        .select('*')
        .single();
      if (error || !renewed) throw new Error(`partition_renew_failed:${error?.message ?? 'unknown'}`);
      return { ok: true, partition: renewed as ExecutionPartition, renewed: true };
    }
    return {
      ok: false,
      reason: 'held_by_other_worker',
      current_owner: row.owner_worker_id,
      lease_expires_at: row.lease_expires_at,
    };
  }

  if (row) {
    // Claim the existing row (idle / expired / released / quarantined→leased
    // allowed only if previous was idle / expired / released; quarantined is
    // explicit-recovery-only).
    if (row.status === 'quarantined') {
      return {
        ok: false,
        reason: 'held_by_other_worker',
        current_owner: row.owner_worker_id,
        lease_expires_at: row.lease_expires_at,
      };
    }
    const { data: updated, error } = await ownedDbTable('execution_partitions')
      .update({
        owner_worker_id: input.workerId,
        lease_acquired_at: nowIso,
        lease_expires_at: expiresAt,
        heartbeat_at: nowIso,
        status: 'leased' as PartitionStatus,
        released_at: null,
        metadata: { ...row.metadata, ...input.metadata },
      })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error || !updated) throw new Error(`partition_acquire_failed:${error?.message ?? 'unknown'}`);
    return { ok: true, partition: updated as ExecutionPartition, renewed: false };
  }

  // First-time creation. The UNIQUE constraint catches concurrent inserts.
  const { data: inserted, error: insErr } = await ownedDbTable('execution_partitions')
    .insert({
      organization_id: input.organizationId,
      partition_key: input.partitionKey,
      owner_worker_id: input.workerId,
      lease_acquired_at: nowIso,
      lease_expires_at: expiresAt,
      heartbeat_at: nowIso,
      status: 'leased' as PartitionStatus,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (insErr) {
    if (insErr.code === '23505') {
      // Race — another worker just inserted. Re-read.
      const { data: raced } = await ownedDbTable('execution_partitions')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('partition_key', input.partitionKey)
        .maybeSingle();
      const racedRow = raced as ExecutionPartition | null;
      if (racedRow && racedRow.owner_worker_id === input.workerId) {
        return { ok: true, partition: racedRow, renewed: false };
      }
      return {
        ok: false,
        reason: 'held_by_other_worker',
        current_owner: racedRow?.owner_worker_id ?? null,
        lease_expires_at: racedRow?.lease_expires_at ?? null,
      };
    }
    throw new Error(`partition_insert_failed:${insErr.message}`);
  }
  return { ok: true, partition: inserted as ExecutionPartition, renewed: false };
}

export async function renewPartitionLease(args: {
  organizationId: string;
  partitionKey: string;
  workerId: string;
  ttlMs?: number;
}): Promise<LeaseAcquireResult> {
  return acquirePartitionLease({ ...args });
}

export async function releasePartitionLease(args: {
  organizationId: string;
  partitionKey: string;
  workerId: string;
}): Promise<ExecutionPartition | null> {
  const { data, error } = await ownedDbTable('execution_partitions')
    .update({
      status: 'released' as PartitionStatus,
      released_at: new Date().toISOString(),
      owner_worker_id: null,
      lease_expires_at: null,
    })
    .eq('organization_id', args.organizationId)
    .eq('partition_key', args.partitionKey)
    .eq('owner_worker_id', args.workerId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`partition_release_failed:${error.message}`);
  return (data as ExecutionPartition | null) ?? null;
}

/**
 * Operator-triggered recovery. Marks expired leases as `expired` so a new
 * worker can re-acquire. Bounded batch.
 */
export async function recoverExpiredLeases(
  organizationId: string,
): Promise<{ recovered: number }> {
  const nowIso = new Date().toISOString();
  const { data: candidates } = await ownedDbTable('execution_partitions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'leased')
    .lt('lease_expires_at', nowIso)
    .limit(MAX_LEASE_RECOVERY_BATCH);
  const ids = ((candidates as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  if (ids.length === 0) return { recovered: 0 };
  const { error } = await ownedDbTable('execution_partitions')
    .update({ status: 'expired' as PartitionStatus, owner_worker_id: null })
    .in('id', ids);
  if (error) throw new Error(`partition_recovery_failed:${error.message}`);
  return { recovered: ids.length };
}

export async function listPartitions(
  organizationId: string,
  options?: { status?: PartitionStatus; limit?: number },
): Promise<ExecutionPartition[]> {
  let q = ownedDbTable('execution_partitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`partition_list_failed:${error.message}`);
  return (data as ExecutionPartition[]) ?? [];
}
