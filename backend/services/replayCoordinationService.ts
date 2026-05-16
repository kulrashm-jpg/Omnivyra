/**
 * Phase 9 — Distributed replay partition + checkpoint coordinator.
 *
 * Phase 7 introduced replay_operations (preview + approve + execute).
 * Phase 8 left non-projection replays "deferred". Phase 9 makes replay
 * partitionable: the approved operation is split into bounded shards,
 * each with its own checkpoint, processed in parallel via the
 * `replay-partition` BullMQ queue. The parent op is only marked complete
 * once every partition reaches a terminal state.
 *
 * Hard guarantees:
 *   • Replay is still gated by `replay_operations.status = 'approved'` —
 *     this service does not bypass approval.
 *   • Per-partition jobId is deterministic; re-enqueue is idempotent.
 *   • Checkpoints store last-processed item ref so workers resume safely.
 *   • Per-item processing reuses the Phase 7 `executeReplay` semantics
 *     for projection replays. Non-projection partitions complete with a
 *     deferred result; we do NOT execute outside the approved batch.
 *   • Best-effort observability publishes — never block on transport.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  REPLAY_PARTITION_DEFAULT_SIZE,
  REPLAY_PARTITION_MAX_ATTEMPTS,
  type ReplayCheckpoint,
  type ReplayPartition,
  type ReplayPartitionStatus,
} from '../types/replayPartition';
import type { ReplayOperation, ReplayStatus } from '../types/replayOps';
import {
  buildReplayPartitionJobId,
  replayPartitionQueue,
} from '../queue/replayPartitionQueue';
import { publishRealtime } from './realtimePublisherService';
import { advanceProjectionCursor } from './projectionSyncService';
import {
  publishReplayPartitionStarted,
  publishReplayPartitionCompleted,
} from '../events/listeningEvents';

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PartitionAndEnqueueReplayResult = {
  replayOperationId: string;
  partitions: ReplayPartition[];
  enqueued: number;
};

/**
 * Partition an approved replay operation and enqueue partition workers.
 * Refuses if the operation is not in `approved` state.
 */
export async function partitionAndEnqueueReplay(
  organizationId: string,
  replayOperationId: string,
  options?: { partitionSize?: number },
): Promise<PartitionAndEnqueueReplayResult> {
  const { data: opRow } = await ownedDbTable('replay_operations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', replayOperationId)
    .maybeSingle();
  const op = opRow as ReplayOperation | null;
  if (!op) throw new Error(`replay_not_found:${replayOperationId}`);
  if (op.status !== 'approved') throw new Error(`replay_not_partitionable:${op.status}`);

  const size = Math.max(1, Math.min(REPLAY_PARTITION_DEFAULT_SIZE, options?.partitionSize ?? REPLAY_PARTITION_DEFAULT_SIZE));
  const groups = chunkArray(op.requested_items, size);

  const partitions: ReplayPartition[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const ids = groups[i];
    const existing = await ownedDbTable('replay_partitions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('replay_operation_id', op.id)
      .eq('partition_index', i)
      .maybeSingle();
    if (existing.data) {
      partitions.push(existing.data as ReplayPartition);
      continue;
    }
    const ins = await ownedDbTable('replay_partitions')
      .insert({
        organization_id: organizationId,
        replay_operation_id: op.id,
        partition_index: i,
        status: 'queued' as ReplayPartitionStatus,
        item_ids: ids,
        checkpoint: {
          last_item_ref: null,
          processed_count: 0,
          skipped_count: 0,
          resumable: true,
        } satisfies ReplayCheckpoint,
      })
      .select('*')
      .single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code === '23505') {
        const reread = await ownedDbTable('replay_partitions')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('replay_operation_id', op.id)
          .eq('partition_index', i)
          .single();
        partitions.push(reread.data as ReplayPartition);
        continue;
      }
      throw new Error(`replay_partition_insert_failed:${ins.error.message}`);
    }
    partitions.push(ins.data as ReplayPartition);
  }

  // Flip the parent operation to `executing` once partitions exist.
  await ownedDbTable('replay_operations')
    .update({ status: 'executing' as ReplayStatus })
    .eq('id', op.id)
    .eq('status', 'approved');

  let enqueued = 0;
  for (const p of partitions) {
    if (p.status !== 'queued') continue;
    try {
      await replayPartitionQueue.add(
        'process-partition',
        { partitionId: p.id, organizationId, replayOperationId: op.id },
        { jobId: buildReplayPartitionJobId(p.id) },
      );
      enqueued += 1;
    } catch (err: any) {
      console.warn('[replayCoordination] enqueue failed:', { partitionId: p.id, error: err?.message });
    }
  }

  return { replayOperationId: op.id, partitions, enqueued };
}

/**
 * Process a single replay partition. Worker entry-point. Resumable via
 * the checkpoint: items already processed (by ref) are skipped.
 */
export async function processReplayPartition(partitionId: string): Promise<ReplayPartition> {
  const { data: pRow } = await ownedDbTable('replay_partitions')
    .select('*')
    .eq('id', partitionId)
    .maybeSingle();
  const partition = pRow as ReplayPartition | null;
  if (!partition) throw new Error(`replay_partition_not_found:${partitionId}`);
  if (partition.status === 'complete' || partition.status === 'cancelled') return partition;

  const { data: opRow } = await ownedDbTable('replay_operations')
    .select('*')
    .eq('organization_id', partition.organization_id)
    .eq('id', partition.replay_operation_id)
    .maybeSingle();
  const op = opRow as ReplayOperation | null;
  if (!op) throw new Error(`replay_operation_not_found:${partition.replay_operation_id}`);

  const nextAttempts = Math.min(REPLAY_PARTITION_MAX_ATTEMPTS, partition.attempts_made + 1);
  await ownedDbTable('replay_partitions')
    .update({
      status: 'running' as ReplayPartitionStatus,
      attempts_made: nextAttempts,
      started_at: partition.started_at ?? new Date().toISOString(),
    })
    .eq('id', partition.id);

  try {
    void publishReplayPartitionStarted({
      organizationId: partition.organization_id,
      replayOperationId: partition.replay_operation_id,
      partitionId: partition.id,
      partitionIndex: partition.partition_index,
    });
  } catch { /* best effort */ }

  const checkpoint: ReplayCheckpoint = partition.checkpoint ?? {
    last_item_ref: null,
    processed_count: 0,
    skipped_count: 0,
    resumable: true,
  };
  let processed = checkpoint.processed_count;
  let skipped = checkpoint.skipped_count;
  let lastRef = checkpoint.last_item_ref;

  const startIndex = lastRef ? Math.max(0, partition.item_ids.indexOf(lastRef) + 1) : 0;

  try {
    if (op.target_kind === 'projection') {
      for (let i = startIndex; i < partition.item_ids.length; i += 1) {
        const id = partition.item_ids[i];
        const { data: row } = await ownedDbTable('projection_sync_state')
          .select('*')
          .eq('organization_id', partition.organization_id)
          .eq('id', id)
          .maybeSingle();
        if (!row) {
          skipped += 1;
        } else {
          const r = row as { projection_kind: string; cursor_position: string | null };
          await publishRealtime({
            organizationId: partition.organization_id,
            topic: 'opportunity_feed',
            eventName: 'projection.replayed',
            payload: { projection_kind: r.projection_kind, cursor_position: r.cursor_position, replay_id: op.id, partition_id: partition.id },
          });
          if (r.cursor_position) {
            await advanceProjectionCursor({
              organizationId: partition.organization_id,
              projectionKind: r.projection_kind as 'opportunity_feed' | 'graph' | 'alerts' | 'clusters' | 'lifecycle',
              cursor: r.cursor_position,
            });
          }
          processed += 1;
        }
        lastRef = id;

        if ((processed + skipped) % 10 === 0) {
          await ownedDbTable('replay_partitions')
            .update({
              checkpoint: { last_item_ref: lastRef, processed_count: processed, skipped_count: skipped, resumable: true } satisfies ReplayCheckpoint,
              processed_count: processed,
              skipped_count: skipped,
            })
            .eq('id', partition.id);
        }
      }
    } else {
      // Non-projection replays remain deferred. Mark partition complete
      // with all items skipped so the rollup completes without surprise.
      skipped = partition.item_ids.length;
    }

    const completed = await ownedDbTable('replay_partitions')
      .update({
        status: 'complete' as ReplayPartitionStatus,
        processed_count: processed,
        skipped_count: skipped,
        checkpoint: { last_item_ref: lastRef, processed_count: processed, skipped_count: skipped, resumable: false } satisfies ReplayCheckpoint,
        completed_at: new Date().toISOString(),
      })
      .eq('id', partition.id)
      .select('*')
      .single();

    try {
      void publishReplayPartitionCompleted({
        organizationId: partition.organization_id,
        replayOperationId: partition.replay_operation_id,
        partitionId: partition.id,
        partitionIndex: partition.partition_index,
        processedCount: processed,
        skippedCount: skipped,
        finalStatus: 'complete',
      });
      void publishRealtime({
        organizationId: partition.organization_id,
        topic: 'replay_coordination',
        eventName: 'replay.partition_completed',
        payload: { replayOperationId: op.id, partitionId: partition.id, partitionIndex: partition.partition_index, processed, skipped },
      });
    } catch { /* best effort */ }

    await rollupReplayOperation(partition.organization_id, partition.replay_operation_id);
    return (completed.data as ReplayPartition) ?? partition;
  } catch (err: any) {
    const failed = await ownedDbTable('replay_partitions')
      .update({
        status: 'failed' as ReplayPartitionStatus,
        processed_count: processed,
        skipped_count: skipped,
        failure_reason: err?.message ?? 'unknown',
        checkpoint: { last_item_ref: lastRef, processed_count: processed, skipped_count: skipped, resumable: true } satisfies ReplayCheckpoint,
        completed_at: new Date().toISOString(),
      })
      .eq('id', partition.id)
      .select('*')
      .single();
    try {
      void publishReplayPartitionCompleted({
        organizationId: partition.organization_id,
        replayOperationId: partition.replay_operation_id,
        partitionId: partition.id,
        partitionIndex: partition.partition_index,
        processedCount: processed,
        skippedCount: skipped,
        finalStatus: 'failed',
      });
    } catch { /* best effort */ }
    await rollupReplayOperation(partition.organization_id, partition.replay_operation_id);
    return (failed.data as ReplayPartition) ?? partition;
  }
}

async function rollupReplayOperation(organizationId: string, replayOperationId: string): Promise<void> {
  const { data } = await ownedDbTable('replay_partitions')
    .select('status, processed_count, skipped_count')
    .eq('organization_id', organizationId)
    .eq('replay_operation_id', replayOperationId);
  const rows = (data as { status: ReplayPartitionStatus; processed_count: number; skipped_count: number }[]) ?? [];
  if (rows.length === 0) return;
  const allTerminal = rows.every((r) => ['complete', 'failed', 'cancelled'].includes(r.status));
  if (!allTerminal) return;

  const processed = rows.reduce((acc, r) => acc + (r.processed_count ?? 0), 0);
  const skipped = rows.reduce((acc, r) => acc + (r.skipped_count ?? 0), 0);
  const anyFailed = rows.some((r) => r.status === 'failed');
  const finalStatus: ReplayStatus = anyFailed && processed === 0 ? 'failed' : 'complete';

  await ownedDbTable('replay_operations')
    .update({
      status: finalStatus,
      result_summary: { processed, skipped, partitions: rows.length, any_failed: anyFailed },
      executed_at: new Date().toISOString(),
    })
    .eq('organization_id', organizationId)
    .eq('id', replayOperationId)
    .in('status', ['executing', 'approved']);
}

export async function listReplayPartitionsForOperation(
  organizationId: string,
  replayOperationId: string,
): Promise<ReplayPartition[]> {
  const { data } = await ownedDbTable('replay_partitions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('replay_operation_id', replayOperationId)
    .order('partition_index', { ascending: true });
  return (data as ReplayPartition[]) ?? [];
}

export async function listReplayPartitionsForOrg(
  organizationId: string,
  options?: { status?: ReplayPartitionStatus; limit?: number },
): Promise<ReplayPartition[]> {
  let q = ownedDbTable('replay_partitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as ReplayPartition[]) ?? [];
}
