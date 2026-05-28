/**
 * Centralized planner ops snapshot.
 *
 * Aggregates every monitorable signal into a single JSON shape suitable for
 * a `/api/super-admin/planner-ops` endpoint or a periodic exporter that
 * pushes to Datadog. Read-only — never writes Redis, never mutates state.
 *
 * Covers:
 *   - cluster overload mode + pressure score
 *   - distributed semaphore active counts per pool
 *   - distributed + local provider token bucket state
 *   - Redis Streams length + consumer-group lag
 *   - planner alert counters (per-process + cluster-wide totals)
 *   - SSE connection counts (advisory — best-effort estimate)
 *   - refinement throughput indicators
 *
 * Designed to fail-soft: any sub-snapshot that errors returns `null` for
 * that field; the overall snapshot is always returned with at least the
 * available data.
 */

import { logger } from './logger';
import { getClusterOverloadMode } from './distributedOverloadCoordinator';
import { snapshotAll as distSemaphoreSnapshotAll, getDistributedActiveCount } from './distributedSemaphore';
import { snapshotAll as localBucketSnapshotAll } from './providerTokenBucket';
import { distributedBucketSnapshot } from './distributedProviderTokenBucket';
import { getPlannerAlertSnapshot, getClusterCounterCount, type PlannerAlertCounter } from './plannerAlerting';
import { getStreamLagSnapshot } from './plannerEventStreams';
import { getBoltQueuePressure } from './bullmqOverloadSignals';

export interface PlannerOpsSnapshot {
  taken_at_ms: number;
  cluster_overload: {
    mode: string;
    pressure_score: number;
    source: string;
  } | null;
  semaphore_pools: Array<{
    pool: string;
    local_active: number;
    local_pending: number;
    max_allowed: number;
    distributed_active: number | null;
    recent_avg_wait_ms: number;
    fallback_in_use: boolean;
  }>;
  provider_buckets: Array<{
    provider: string;
    local_tokens: number;
    distributed_tokens: number | null;
    qps: number;
    burst: number;
    distributed_enabled: boolean;
    distributed_healthy: boolean;
  }>;
  alert_counters: Array<{
    counter: PlannerAlertCounter;
    recent_local: number;
    recent_cluster: number | null;
    threshold: number;
    window_ms: number;
    total_since_boot: number;
  }>;
  stream_lag: Array<{
    stream: string;
    length: number;
    pending: number;
    oldest_pending_age_ms: number | null;
  }> | null;
  bullmq_pressure: {
    waiting: number;
    delayed: number;
    active: number;
    failed: number;
    pressure_high: boolean;
    reasons: string[];
  } | null;
}

export async function getPlannerOpsSnapshot(): Promise<PlannerOpsSnapshot> {
  const snap: PlannerOpsSnapshot = {
    taken_at_ms: Date.now(),
    cluster_overload: null,
    semaphore_pools: [],
    provider_buckets: [],
    alert_counters: [],
    stream_lag: null,
    bullmq_pressure: null,
  };

  // Cluster overload — short, single Redis read.
  try {
    const o = await getClusterOverloadMode();
    snap.cluster_overload = { mode: o.mode, pressure_score: o.pressureScore, source: o.source };
  } catch (err) {
    logger.warn('planner_ops_overload_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Semaphore pools — local + distributed live count.
  try {
    const pools = distSemaphoreSnapshotAll();
    for (const [name, p] of Object.entries(pools)) {
      const distActive = await getDistributedActiveCount(p.pool).catch(() => null);
      snap.semaphore_pools.push({
        pool: name,
        local_active: p.active,
        local_pending: p.pending,
        max_allowed: p.maxAllowed,
        distributed_active: distActive,
        recent_avg_wait_ms: p.recentAvgWaitMs,
        fallback_in_use: p.fallbackInUse,
      });
    }
  } catch (err) {
    logger.warn('planner_ops_semaphore_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Provider buckets.
  try {
    const local = localBucketSnapshotAll();
    for (const p of ['openai', 'anthropic'] as const) {
      const dist = await distributedBucketSnapshot(p).catch(() => null);
      snap.provider_buckets.push({
        provider: p,
        local_tokens: local[p].tokens,
        distributed_tokens: dist?.tokens ?? null,
        qps: local[p].qps,
        burst: local[p].burst,
        distributed_enabled: dist?.enabled ?? false,
        distributed_healthy: dist?.redisHealthy ?? false,
      });
    }
  } catch (err) {
    logger.warn('planner_ops_buckets_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Alert counters — local + cluster.
  try {
    const local = getPlannerAlertSnapshot();
    for (const counter of Object.keys(local) as PlannerAlertCounter[]) {
      const cluster = await getClusterCounterCount(counter).catch(() => null);
      snap.alert_counters.push({
        counter,
        recent_local: local[counter].recentInWindow,
        recent_cluster: cluster,
        threshold: local[counter].threshold,
        window_ms: local[counter].windowMs,
        total_since_boot: local[counter].total,
      });
    }
  } catch (err) {
    logger.warn('planner_ops_alerts_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Redis Streams lag.
  try {
    const lag = await getStreamLagSnapshot();
    if (lag) {
      snap.stream_lag = lag.map((l) => ({
        stream: l.stream,
        length: l.length,
        pending: l.pending,
        oldest_pending_age_ms: l.oldestPendingAgeMs,
      }));
    }
  } catch (err) {
    logger.warn('planner_ops_streams_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // BullMQ pressure.
  try {
    const q = await getBoltQueuePressure();
    snap.bullmq_pressure = {
      waiting: q.waiting,
      delayed: q.delayed,
      active: q.active,
      failed: q.failed,
      pressure_high: q.pressureHigh,
      reasons: q.reasons,
    };
  } catch (err) {
    logger.warn('planner_ops_bullmq_read_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return snap;
}
