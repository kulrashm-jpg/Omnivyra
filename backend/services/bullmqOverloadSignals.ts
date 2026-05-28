/**
 * BullMQ-aware planner overload signals.
 *
 * Reads queue health (waiting / delayed / active / failed / retry rate) from
 * the BOLT execution queue and feeds the result into the orchestrator's
 * overload-mode decision so the planner can degrade BEFORE the LLM pool
 * itself saturates.
 *
 * The legacy overload check (`getLlmPoolPressure`) only sees gateway-level
 * pressure. BullMQ backlogs upstream of the planner (e.g. a burst of BOLT
 * runs queued faster than workers can process) are invisible there. This
 * module fills that gap.
 *
 * Reads are cached for `CACHE_TTL_MS` (default 2s) — calling on every plan
 * request would be 4 Redis round-trips × N plans per second.
 *
 * Failures: a Redis read failure returns `{ healthy: true, ... }` so the
 * planner never DEGRADES because of an observability outage. A repeatedly
 * failing read is logged once per minute.
 */

import { logger } from './logger';

const CACHE_TTL_MS = 2_000;

export interface BullMqQueueSnapshot {
  /** Queue name. */
  queue: string;
  waiting: number;
  delayed: number;
  active: number;
  failed: number;
  /** True when at least one metric crossed its threshold. The planner uses
   *  this as a single boolean. */
  pressureHigh: boolean;
  /** Reason strings for the pressureHigh decision. */
  reasons: string[];
  /** Snapshot freshness. */
  takenAtMs: number;
  /** Source — 'redis' = live read; 'cache' = served from cache; 'fallback'
   *  = Redis read failed, returned neutral health. */
  source: 'redis' | 'cache' | 'fallback';
}

let _cache: BullMqQueueSnapshot | null = null;
let _cacheAt = 0;
let _lastErrorAt = 0;

function pressureThresholds(): {
  waitingHigh: number;
  delayedHigh: number;
  failedHigh: number;
} {
  return {
    waitingHigh: Math.max(0, Number(process.env.BULLMQ_WAITING_PRESSURE_THRESHOLD || 20)),
    delayedHigh: Math.max(0, Number(process.env.BULLMQ_DELAYED_PRESSURE_THRESHOLD || 50)),
    failedHigh:  Math.max(0, Number(process.env.BULLMQ_FAILED_PRESSURE_THRESHOLD || 10)),
  };
}

/**
 * Snapshot of BOLT queue pressure. Cached for ~2s. Designed so callers
 * can `if (snap.pressureHigh) ...` directly.
 */
export async function getBoltQueuePressure(): Promise<BullMqQueueSnapshot> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) {
    return { ..._cache, source: 'cache', takenAtMs: now };
  }

  try {
    const { getBoltQueue } =
      require('../queue/boltQueue') as typeof import('../queue/boltQueue');
    const queue = getBoltQueue();
    const counts = await queue.getJobCounts(
      'waiting',
      'delayed',
      'active',
      'failed',
    );
    const t = pressureThresholds();
    const reasons: string[] = [];
    if ((counts.waiting ?? 0) >= t.waitingHigh) reasons.push(`waiting>=${t.waitingHigh}`);
    if ((counts.delayed ?? 0) >= t.delayedHigh) reasons.push(`delayed>=${t.delayedHigh}`);
    if ((counts.failed ?? 0)  >= t.failedHigh)  reasons.push(`failed>=${t.failedHigh}`);
    const snap: BullMqQueueSnapshot = {
      queue: 'bolt-execution',
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      active:  counts.active  ?? 0,
      failed:  counts.failed  ?? 0,
      pressureHigh: reasons.length > 0,
      reasons,
      takenAtMs: now,
      source: 'redis',
    };
    _cache = snap;
    _cacheAt = now;
    if (snap.pressureHigh) {
      logger.warn('bullmq_queue_pressure_high', {
        queue: snap.queue,
        waiting: snap.waiting,
        delayed: snap.delayed,
        active: snap.active,
        failed: snap.failed,
        reasons: snap.reasons,
      });
    }
    return snap;
  } catch (err) {
    if (now - _lastErrorAt > 60_000) {
      _lastErrorAt = now;
      logger.warn('bullmq_queue_pressure_read_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Fail-open so the planner doesn't degrade because of an observability outage.
    return {
      queue: 'bolt-execution',
      waiting: 0,
      delayed: 0,
      active: 0,
      failed: 0,
      pressureHigh: false,
      reasons: [],
      takenAtMs: now,
      source: 'fallback',
    };
  }
}

/** Test-only: reset the cache. */
export function __resetBullMqSignalsForTests(): void {
  _cache = null;
  _cacheAt = 0;
  _lastErrorAt = 0;
}
