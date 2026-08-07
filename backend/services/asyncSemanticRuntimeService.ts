/**
 * Phase 9 — Async semantic indexing runtime.
 *
 * Split a queued `semantic_indexing_jobs` row into bounded partitions,
 * enqueue each partition into the `semantic-indexing` BullMQ queue, and
 * process them deterministically. A partition is the smallest replayable
 * unit — failure of one partition does not block its siblings. After all
 * partitions reach a terminal state, the parent job is rolled up.
 *
 * Hard guarantees:
 *   • Idempotent SELECT-then-INSERT on partitions (UNIQUE
 *     (semantic_indexing_job_id, partition_index) anchors race safety).
 *   • Per-partition jobId is deterministic; BullMQ dedups re-enqueues.
 *   • No autonomous fanout — partitions exist only because an operator
 *     created the parent job (Phase 8 contract preserved).
 *   • All counts/cost roll up additively from partition rows; the parent
 *     job's totals reflect the sum of partitions, never a recomputation.
 *   • Best-effort observability + realtime publishes do not block job
 *     progression.
 */

import { ownedDbTable } from '../db/writeOwner';
import { safeEnqueue } from '../middleware/queueBackpressure';
import {
  SEMANTIC_PARTITION_DEFAULT_SIZE,
  SEMANTIC_PARTITION_MAX_ATTEMPTS,
  type SemanticIndexingPartition,
  type SemanticPartitionStatus,
} from '../types/semanticIndexingPartition';
import type { SemanticIndexingJob, SemanticJobStatus } from '../types/semanticIndexingJob';
import { processSemanticSourceForJob } from './semanticIndexingService';
import {
  buildSemanticPartitionJobId,
  semanticIndexingQueue,
} from '../queue/semanticIndexingQueue';
import { publishRealtime } from './realtimePublisherService';
import { publishSemanticJobQueued, publishSemanticJobCompleted } from '../events/listeningEvents';

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PartitionAndEnqueueResult = {
  jobId: string;
  partitions: SemanticIndexingPartition[];
  enqueued: number;
};

/**
 * Partition a queued semantic indexing job and enqueue each partition.
 * Safe to call repeatedly: existing partitions are not re-created, and
 * the queue rejects duplicate jobIds.
 */
export async function partitionAndEnqueueSemanticJob(
  organizationId: string,
  jobId: string,
  options?: { partitionSize?: number },
): Promise<PartitionAndEnqueueResult> {
  const { data: jobRow } = await ownedDbTable('semantic_indexing_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', jobId)
    .maybeSingle();
  const job = jobRow as SemanticIndexingJob | null;
  if (!job) throw new Error(`semantic_job_not_found:${jobId}`);
  if (job.status !== 'queued') throw new Error(`semantic_job_not_queueable:${job.status}`);

  const size = Math.max(1, Math.min(SEMANTIC_PARTITION_DEFAULT_SIZE, options?.partitionSize ?? SEMANTIC_PARTITION_DEFAULT_SIZE));
  const groups = chunkArray(job.source_ids, size);

  const partitions: SemanticIndexingPartition[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const ids = groups[i];
    const existing = await ownedDbTable('semantic_indexing_partitions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('semantic_indexing_job_id', job.id)
      .eq('partition_index', i)
      .maybeSingle();
    if (existing.data) {
      partitions.push(existing.data as SemanticIndexingPartition);
      continue;
    }
    const ins = await ownedDbTable('semantic_indexing_partitions')
      .insert({
        organization_id: organizationId,
        semantic_indexing_job_id: job.id,
        partition_index: i,
        source_ids: ids,
        status: 'queued' as SemanticPartitionStatus,
      })
      .select('*')
      .single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code === '23505') {
        const reread = await ownedDbTable('semantic_indexing_partitions')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('semantic_indexing_job_id', job.id)
          .eq('partition_index', i)
          .single();
        partitions.push(reread.data as SemanticIndexingPartition);
        continue;
      }
      throw new Error(`partition_insert_failed:${ins.error.message}`);
    }
    partitions.push(ins.data as SemanticIndexingPartition);
  }

  // Flip the parent job to `running` once partitions exist.
  await ownedDbTable('semantic_indexing_jobs')
    .update({ status: 'running', started_at: job.started_at ?? new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued');

  let enqueued = 0;
  for (const p of partitions) {
    if (p.status !== 'queued') continue;
    try {
      const queued = await safeEnqueue(
        semanticIndexingQueue,
        'semantic-indexing',
        'process-partition',
        { partitionId: p.id, organizationId, semanticIndexingJobId: job.id },
        { jobId: buildSemanticPartitionJobId(p.id) },
      );
      // Shed by backpressure — the partition stays `queued`, so the next
      // coordination pass re-enqueues it. Do not count it.
      if (!queued) continue;
      enqueued += 1;
    } catch (err: any) {
      console.warn('[asyncSemanticRuntime] enqueue failed:', { partitionId: p.id, error: err?.message });
    }
  }

  try {
    await publishSemanticJobQueued({
      organizationId,
      semanticIndexingJobId: job.id,
      partitions: partitions.length,
      totalSources: job.source_ids.length,
    });
    void publishRealtime({
      organizationId,
      topic: 'semantic_indexing',
      eventName: 'semantic.job_queued',
      payload: { semanticIndexingJobId: job.id, partitions: partitions.length },
    });
  } catch { /* best effort */ }

  return { jobId: job.id, partitions, enqueued };
}

/**
 * Process a single partition end-to-end. Worker entry-point. Idempotent:
 * a partition that is already terminal short-circuits.
 */
export async function processSemanticPartition(partitionId: string): Promise<SemanticIndexingPartition> {
  const { data: row } = await ownedDbTable('semantic_indexing_partitions')
    .select('*')
    .eq('id', partitionId)
    .maybeSingle();
  const partition = row as SemanticIndexingPartition | null;
  if (!partition) throw new Error(`semantic_partition_not_found:${partitionId}`);
  if (partition.status === 'complete' || partition.status === 'cancelled') return partition;

  const { data: jobRow } = await ownedDbTable('semantic_indexing_jobs')
    .select('*')
    .eq('organization_id', partition.organization_id)
    .eq('id', partition.semantic_indexing_job_id)
    .maybeSingle();
  const job = jobRow as SemanticIndexingJob | null;
  if (!job) throw new Error(`semantic_job_not_found:${partition.semantic_indexing_job_id}`);

  const nextAttempts = Math.min(SEMANTIC_PARTITION_MAX_ATTEMPTS, partition.attempts_made + 1);
  await ownedDbTable('semantic_indexing_partitions')
    .update({
      status: 'running' as SemanticPartitionStatus,
      attempts_made: nextAttempts,
      started_at: partition.started_at ?? new Date().toISOString(),
    })
    .eq('id', partition.id);

  let chunksIndexed = 0;
  let chunksFailed = 0;
  let costUnits = 0;
  try {
    for (const sourceId of partition.source_ids) {
      const r = await processSemanticSourceForJob(partition.organization_id, job, sourceId);
      chunksIndexed += r.chunksIndexed;
      chunksFailed += r.chunksFailed;
      costUnits += r.costUnits;
    }
    const completed = await ownedDbTable('semantic_indexing_partitions')
      .update({
        status: 'complete' as SemanticPartitionStatus,
        chunks_indexed: chunksIndexed,
        chunks_failed: chunksFailed,
        cost_units: costUnits,
        completed_at: new Date().toISOString(),
      })
      .eq('id', partition.id)
      .select('*')
      .single();
    await rollupParentJob(partition.organization_id, partition.semantic_indexing_job_id);
    return (completed.data as SemanticIndexingPartition) ?? partition;
  } catch (err: any) {
    const failed = await ownedDbTable('semantic_indexing_partitions')
      .update({
        status: 'failed' as SemanticPartitionStatus,
        failure_reason: err?.message ?? 'unknown',
        chunks_indexed: chunksIndexed,
        chunks_failed: chunksFailed,
        cost_units: costUnits,
        completed_at: new Date().toISOString(),
      })
      .eq('id', partition.id)
      .select('*')
      .single();
    await rollupParentJob(partition.organization_id, partition.semantic_indexing_job_id);
    return (failed.data as SemanticIndexingPartition) ?? partition;
  }
}

/**
 * Roll up partition status into the parent job. Called after every
 * partition transitions to a terminal state. No-op when partitions are
 * still in flight.
 */
async function rollupParentJob(organizationId: string, jobId: string): Promise<void> {
  const { data } = await ownedDbTable('semantic_indexing_partitions')
    .select('status, chunks_indexed, chunks_failed, cost_units')
    .eq('organization_id', organizationId)
    .eq('semantic_indexing_job_id', jobId);
  const rows = (data as { status: SemanticPartitionStatus; chunks_indexed: number; chunks_failed: number; cost_units: number }[]) ?? [];
  if (rows.length === 0) return;
  const allTerminal = rows.every((r) => ['complete', 'failed', 'cancelled'].includes(r.status));
  if (!allTerminal) return;

  const chunksIndexed = rows.reduce((acc, r) => acc + (r.chunks_indexed ?? 0), 0);
  const chunksFailed = rows.reduce((acc, r) => acc + (r.chunks_failed ?? 0), 0);
  const costUnits = rows.reduce((acc, r) => acc + (r.cost_units ?? 0), 0);
  const anyFailed = rows.some((r) => r.status === 'failed');
  const finalStatus: SemanticJobStatus = anyFailed && chunksIndexed === 0 ? 'failed' : 'complete';

  await ownedDbTable('semantic_indexing_jobs')
    .update({
      status: finalStatus,
      chunks_indexed: chunksIndexed,
      chunks_failed: chunksFailed,
      cost_units: costUnits,
      completed_at: new Date().toISOString(),
      failure_reason: anyFailed && finalStatus === 'failed' ? 'one_or_more_partitions_failed' : null,
    })
    .eq('organization_id', organizationId)
    .eq('id', jobId)
    .in('status', ['queued', 'running']);

  try {
    await publishSemanticJobCompleted({
      organizationId,
      semanticIndexingJobId: jobId,
      chunksIndexed,
      chunksFailed,
      costUnits,
      finalStatus,
    });
    void publishRealtime({
      organizationId,
      topic: 'semantic_indexing',
      eventName: 'semantic.job_completed',
      payload: { semanticIndexingJobId: jobId, finalStatus, chunksIndexed, chunksFailed },
    });
  } catch { /* best effort */ }
}

export async function listSemanticPartitionsForJob(
  organizationId: string,
  semanticIndexingJobId: string,
): Promise<SemanticIndexingPartition[]> {
  const { data } = await ownedDbTable('semantic_indexing_partitions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('semantic_indexing_job_id', semanticIndexingJobId)
    .order('partition_index', { ascending: true });
  return (data as SemanticIndexingPartition[]) ?? [];
}

export async function listSemanticPartitionsForOrg(
  organizationId: string,
  options?: { status?: SemanticPartitionStatus; limit?: number },
): Promise<SemanticIndexingPartition[]> {
  let q = ownedDbTable('semantic_indexing_partitions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as SemanticIndexingPartition[]) ?? [];
}
