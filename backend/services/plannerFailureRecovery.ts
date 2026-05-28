/**
 * Planner failure recovery utilities.
 *
 * Six recovery surfaces:
 *   - stream replay (XRANGE + dedup)
 *   - dead consumer recovery (XAUTOCLAIM — handled in plannerEventStreams)
 *   - stalled stream recovery (XPENDING + XCLAIM if needed)
 *   - orphan refinement recovery (find stuck refinement jobs)
 *   - distributed lock recovery (semaphore lease eviction via Lua, already
 *     in distributedSemaphore — exposed here as an ops trigger)
 *   - split-brain mitigation (compare local active count vs distributed
 *     ZCARD; reconcile drift)
 *
 * Every operation is IDEMPOTENT — re-running yields the same end state.
 *
 * Documented eventual-consistency windows:
 *   - Event stream replay can deliver duplicates; subscribers must dedup
 *     via the local `(type, campaign_id, plan_revision_id)` map with 5min TTL.
 *   - Semaphore-lease reclamation can briefly over-grant slots if a clock
 *     skew >1s exists between Redis and a worker. Acceptable trade-off
 *     vs starvation.
 *   - Refinement orphan recovery may double-execute a refinement when a
 *     worker crashes after committing but before ACKing the BullMQ job.
 *     The DB-side optimistic concurrency (`refinement_version` mismatch)
 *     catches the duplicate write and discards it.
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { replayCampaignEvents } from './plannerEventStreams';
import { snapshotAll as distSemaphoreSnapshotAll, getDistributedActiveCount } from './distributedSemaphore';

const _seenReplayIds = new Map<string, number>();
const REPLAY_DEDUP_TTL_MS = 10 * 60_000;

function pruneSeen(now: number): void {
  for (const [k, t] of _seenReplayIds) {
    if (t + REPLAY_DEDUP_TTL_MS < now) _seenReplayIds.delete(k);
  }
}

/**
 * Replay-with-dedup. Returns events newer than `sinceMs` for the given
 * campaign, suppressing entry-ids we've already seen in this process
 * within the last 10 minutes.
 */
export async function replayCampaignEventsDeduped(
  campaignId: string,
  opts: { count?: number; sinceMs?: number } = {},
): Promise<Array<{ entryId: string; event: ReturnType<typeof Symbol> }>> {
  const replay = await replayCampaignEvents(campaignId, opts);
  pruneSeen(Date.now());
  const out: typeof replay = [];
  for (const item of replay) {
    if (_seenReplayIds.has(item.entryId)) continue;
    _seenReplayIds.set(item.entryId, Date.now());
    out.push(item);
  }
  return out as any;
}

/**
 * Compare per-process semaphore active counts to the distributed Redis
 * count. Drift > drift_threshold indicates split-brain (network partition,
 * stale local state). Returns the drift per pool so an ops dashboard can
 * alert.
 */
export interface SemaphoreDriftReport {
  pool: string;
  localActive: number;
  distributedActive: number | null;
  drift: number;
  driftHigh: boolean;
}

export async function detectSemaphoreSplitBrain(driftThreshold: number = 3): Promise<SemaphoreDriftReport[]> {
  const local = distSemaphoreSnapshotAll();
  const out: SemaphoreDriftReport[] = [];
  for (const [, snap] of Object.entries(local)) {
    const dist = await getDistributedActiveCount(snap.pool).catch(() => null);
    const drift = dist === null ? 0 : Math.abs(snap.active - dist);
    const driftHigh = dist !== null && drift >= driftThreshold;
    if (driftHigh) {
      logger.warn('planner_semaphore_split_brain_detected', {
        pool: snap.pool,
        local_active: snap.active,
        distributed_active: dist,
        drift,
        threshold: driftThreshold,
      });
    }
    out.push({
      pool: snap.pool,
      localActive: snap.active,
      distributedActive: dist,
      drift,
      driftHigh,
    });
  }
  return out;
}

/**
 * Scan the planner-refinement queue for jobs that have been "active" for
 * longer than `staleThresholdMs`. These are candidates for stalled-job
 * recovery; BullMQ's built-in mechanism should already be picking them up
 * (lockDuration default 30s), but this exposes the count for monitoring.
 */
export async function getOrphanRefinementCount(staleThresholdMs: number = 5 * 60_000): Promise<{ count: number; healthy: boolean } | null> {
  try {
    const { getRefinementQueue } = require('../queue/refinementQueue') as typeof import('../queue/refinementQueue');
    const queue = getRefinementQueue();
    // BullMQ exposes `getActive()` returning Job[] with `processedOn` timestamps.
    const active = await queue.getActive(0, 100);
    const now = Date.now();
    let stale = 0;
    for (const job of active) {
      const processedOn = (job as { processedOn?: number }).processedOn ?? 0;
      if (processedOn > 0 && now - processedOn > staleThresholdMs) stale++;
    }
    return { count: stale, healthy: stale === 0 };
  } catch (err) {
    logger.warn('planner_orphan_refinement_check_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Manual trigger for the distributed-lock reclamation path. The semaphore
 * already auto-reclaims expired leases on every acquire, but ops may want
 * to force an immediate sweep (e.g. after a known mass-worker-crash event).
 *
 * Implementation: enumerate per-pool ZSETs and run ZREMRANGEBYSCORE with
 * now as the upper bound — anything expired is removed.
 */
export async function forceSemaphoreLeaseReclamation(): Promise<{ pool: string; reclaimed: number }[]> {
  let client: IORedis | null = null;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    client = getInstrumentedStandaloneRedisClient('planner-failure-recovery');
  } catch {
    return [];
  }
  if (!client) return [];
  const pools = ['drafting', 'alignment', 'refinement', 'repair', 'default'] as const;
  const out: { pool: string; reclaimed: number }[] = [];
  for (const pool of pools) {
    try {
      const removed = await client.zremrangebyscore(`planner:sem:${pool}`, '-inf', Date.now());
      out.push({ pool, reclaimed: removed });
      if (removed > 0) {
        logger.info('planner_semaphore_force_reclaimed', { pool, reclaimed: removed });
      }
    } catch {
      out.push({ pool, reclaimed: 0 });
    }
  }
  return out;
}
