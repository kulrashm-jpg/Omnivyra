/**
 * Phase 9 — Extended runtime observability.
 *
 * Aggregates queue depth + worker state + recent failure rates across
 * the BullMQ surfaces that Phase 3-9 introduce. Returns a single
 * `RuntimeHealthSnapshot` per call — synchronous probe, no caching, no
 * background poller (Phase 9 does NOT add an autonomous health loop).
 *
 * Used by:
 *   • /api/active-leads/runtime-observability   — operator dashboard
 *   • Manual incident triage flows
 *
 * Hard guarantees:
 *   • Read-only. No queue mutation. No worker control. Failure to read
 *     a queue degrades to `unknown` for that queue, never throws.
 *   • Best-effort realtime publish when congestion thresholds are
 *     breached — caller decides whether to wire to UI.
 */

import { listeningExecutionQueue } from '../queue/listeningExecutionQueue';
import { semanticIndexingQueue } from '../queue/semanticIndexingQueue';
import { replayPartitionQueue } from '../queue/replayPartitionQueue';
import { ownedDbTable } from '../db/writeOwner';
import { publishRealtime } from './realtimePublisherService';
import { publishRuntimeCongested, publishRuntimeRecovered } from '../events/listeningEvents';

export type QueueHealthSnapshot = {
  name: string;
  waiting: number | null;
  active: number | null;
  delayed: number | null;
  failed: number | null;
  completed: number | null;
  congested: boolean;
  threshold: number;
};

export type RuntimeHealthSnapshot = {
  organization_id: string;
  generated_at: string;
  queues: QueueHealthSnapshot[];
  recent_failures: {
    semantic_partitions: number;
    replay_partitions: number;
    executions: number;
  };
};

const CONGESTION_THRESHOLDS: Record<string, number> = {
  'listening-executions': 200,
  'semantic-indexing': 200,
  'replay-partition': 200,
};

async function probeQueue(queue: { name: string; getJobCounts: () => Promise<Record<string, number>> }): Promise<QueueHealthSnapshot> {
  const threshold = CONGESTION_THRESHOLDS[queue.name] ?? 200;
  try {
    const counts = await queue.getJobCounts();
    const waiting = counts.waiting ?? null;
    const active = counts.active ?? null;
    const delayed = counts.delayed ?? null;
    const congested = (waiting ?? 0) + (delayed ?? 0) > threshold;
    return {
      name: queue.name,
      waiting,
      active,
      delayed,
      failed: counts.failed ?? null,
      completed: counts.completed ?? null,
      congested,
      threshold,
    };
  } catch {
    return {
      name: queue.name,
      waiting: null,
      active: null,
      delayed: null,
      failed: null,
      completed: null,
      congested: false,
      threshold,
    };
  }
}

export async function getRuntimeHealthSnapshot(organizationId: string): Promise<RuntimeHealthSnapshot> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();

  const [listening, semantic, replay] = await Promise.all([
    probeQueue(listeningExecutionQueue as unknown as { name: string; getJobCounts: () => Promise<Record<string, number>> }),
    probeQueue(semanticIndexingQueue as unknown as { name: string; getJobCounts: () => Promise<Record<string, number>> }),
    probeQueue(replayPartitionQueue as unknown as { name: string; getJobCounts: () => Promise<Record<string, number>> }),
  ]);
  const queues = [listening, semantic, replay];

  const failures = await Promise.all([
    countRecentFailures('semantic_indexing_partitions', organizationId, since),
    countRecentFailures('replay_partitions', organizationId, since),
    countRecentFailures('listening_executions', organizationId, since),
  ]);

  // Best-effort congestion publish — operator-facing only; no action taken.
  for (const q of queues) {
    try {
      if (q.congested) {
        await publishRuntimeCongested({
          organizationId,
          queue: q.name,
          depth: (q.waiting ?? 0) + (q.delayed ?? 0),
          threshold: q.threshold,
        });
        void publishRealtime({
          organizationId,
          topic: 'runtime_health',
          eventName: 'runtime.congested',
          payload: { queue: q.name, depth: (q.waiting ?? 0) + (q.delayed ?? 0), threshold: q.threshold },
        });
      } else if (q.waiting !== null && q.waiting === 0 && (q.active ?? 0) <= 1) {
        await publishRuntimeRecovered({ organizationId, queue: q.name, depth: q.waiting ?? 0 });
      }
    } catch { /* best effort */ }
  }

  return {
    organization_id: organizationId,
    generated_at: new Date().toISOString(),
    queues,
    recent_failures: {
      semantic_partitions: failures[0],
      replay_partitions: failures[1],
      executions: failures[2],
    },
  };
}

async function countRecentFailures(table: string, organizationId: string, since: string): Promise<number> {
  try {
    const { count } = await ownedDbTable(table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'failed')
      .gte('updated_at', since);
    return count ?? 0;
  } catch {
    return 0;
  }
}
