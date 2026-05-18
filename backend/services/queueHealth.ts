/**
 * Lightweight queue health + recovery (Round-2 item 4).
 *
 * NO infra redesign, NO Redis architecture change. Just:
 *  - Redis reachability ping (bounded)
 *  - BullMQ worker-availability detection (Queue.getWorkers())
 *  - global stale-execution sweep (callable; mirrors the inline sweep in
 *    pages/api/bolt/execute.ts but not gated on a user re-trigger)
 *
 * All functions are best-effort and NEVER throw — a health probe must
 * not be able to take down a request path. Heavy deps are lazy-required
 * so importing this module has zero side effects.
 */

import { logPipelineEvent } from '../../lib/shared/observability';
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';

export interface QueueHealth {
  redisOk: boolean;
  boltWorkers: number;
  operational: boolean;
  checkedAt: string;
  detail?: string;
}

let _cache: { at: number; value: QueueHealth } | null = null;
const HEALTH_TTL_MS = 10_000; // brief cache — health probes are cheap but not free

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function pingRedis(): Promise<boolean> {
  try {
    const { getSharedRedisClient } = await import('../queue/bullmqClient');
    const client = getSharedRedisClient();
    const pong = await withTimeout(client.ping() as Promise<string>, 2000, '');
    return pong === 'PONG';
  } catch {
    return false;
  }
}

async function countBoltWorkers(): Promise<number> {
  try {
    const { getBoltQueue } = await import('../queue/boltQueue');
    const q = getBoltQueue();
    const workers = await withTimeout(q.getWorkers() as Promise<unknown[]>, 2500, []);
    return Array.isArray(workers) ? workers.length : 0;
  } catch {
    return 0;
  }
}

/** Cached (10s) health snapshot. Never throws. */
export async function getQueueHealth(force = false): Promise<QueueHealth> {
  const now = Date.now();
  if (!force && _cache && now - _cache.at < HEALTH_TTL_MS) return _cache.value;

  const redisOk = await pingRedis();
  const boltWorkers = redisOk ? await countBoltWorkers() : 0;
  const value: QueueHealth = {
    redisOk,
    boltWorkers,
    operational: redisOk && boltWorkers > 0,
    checkedAt: new Date().toISOString(),
    detail: !redisOk ? 'redis_unreachable' : boltWorkers === 0 ? 'no_bolt_workers' : 'ok',
  };
  _cache = { at: now, value };
  logPipelineEvent(
    'queue.health',
    value.operational ? 'info' : 'warn',
    { redisOk, boltWorkers, operational: value.operational, detail: value.detail },
    { dedupeKey: value.detail, throttleMs: 60_000 },
  );
  return value;
}

/** Convenience boolean — safe to gate the queue path on. */
export async function isQueueOperational(): Promise<boolean> {
  return (await getQueueHealth()).operational;
}

/**
 * Global stale-execution sweep. Reclaims runs that are still
 * `started`/`running` but whose heartbeat is older than `staleMs` and
 * whose lock has expired — marks them `failed` so they stop showing as
 * "running" and so a retry can proceed.
 *
 * Defensive: tolerates a desynced schema (the `lock_expires_at` column
 * may be absent on prod per the known ledger desync) by falling back to
 * a heartbeat-only predicate. Best-effort; returns reclaimed count.
 */
export async function sweepStaleExecutions(
  staleMs = 300_000,
): Promise<{ reclaimed: number; ok: boolean; detail?: string }> {
  try {
    const { ownedDbTable } = await import('../db/writeOwner');
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - staleMs).toISOString();
    const patch = {
      status: 'failed',
      error_message:
        'Your campaign was interrupted by a worker restart and could not resume automatically. Please try again.',
      raw_error_message: `Stale execution reclaimed by sweep: no heartbeat for >${Math.round(staleMs / 1000)}s.`,
      failed_stage: 'stale-sweep',
      lock_owner: null,
      updated_at: nowIso,
    };

    // Primary attempt: include lock_expires_at predicate when present.
    let reclaimed = 0;
    try {
      const { data, error } = await ownedDbTable('bolt_execution_runs')
        .update({ ...patch, lock_expires_at: null })
        .in('status', ['started', 'running'])
        .lt('heartbeat_at', cutoffIso)
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
        .select('id');
      if (error) throw error;
      reclaimed = Array.isArray(data) ? data.length : 0;
    } catch (primaryErr) {
      // Schema desync fallback: heartbeat-only, no lock_expires_at.
      const { data, error } = await ownedDbTable('bolt_execution_runs')
        .update(patch)
        .in('status', ['started', 'running'])
        .lt('heartbeat_at', cutoffIso)
        .select('id');
      if (error) {
        logPipelineEvent('queue.stale_sweep', 'warn', {
          ok: false,
          detail: 'sweep_failed',
          err: (error as { message?: string })?.message,
          primary: (primaryErr as Error)?.message,
        });
        return { reclaimed: 0, ok: false, detail: 'sweep_failed' };
      }
      reclaimed = Array.isArray(data) ? data.length : 0;
    }

    if (reclaimed > 0) {
      logPipelineEvent('queue.stale_sweep', 'warn', {
        ok: true,
        reclaimed,
        code: PipelineErrorCode.STALE_EXECUTION_RECLAIMED,
      }, { throttleMs: 0 });
    }
    return { reclaimed, ok: true };
  } catch (err) {
    logPipelineEvent('queue.stale_sweep', 'warn', {
      ok: false,
      detail: 'sweep_crashed',
      err: (err as Error)?.message,
    });
    return { reclaimed: 0, ok: false, detail: 'sweep_crashed' };
  }
}
