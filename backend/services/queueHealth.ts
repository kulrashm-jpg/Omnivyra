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
    // Forensic-integrity contract (aligned with the inline + operator
    // sweepers): NEVER touch error_message / raw_error_message /
    // failed_stage — those are the exclusive domain of
    // persistPipelineFailure. The sweep ONLY records abandonment
    // metadata in dedicated columns so the real stage-thrown cause
    // (if any) survives alongside the sweep marker. The progress
    // endpoint derives a user-facing message from abandonment_reason
    // when error_message is null.
    const patch: Record<string, unknown> = {
      status: 'failed',
      abandonment_reason: 'cron_stale_execution_sweep',
      abandonment_detected_at: nowIso,
      lock_owner: null,
      updated_at: nowIso,
    };

    // Primary attempt: include lock_expires_at + abandonment columns.
    // Select `payload` too so we can stamp attribution (campaign_type /
    // pipeline_mode) on the swept rows — abandoned runs never threw, so
    // persistPipelineFailure never tagged them and analytics couldn't
    // slice them by surface (Phase 6I-3).
    let reclaimed = 0;
    let sweptRows: Array<{ id: string; payload?: Record<string, unknown> | null }> = [];
    try {
      const { data, error } = await ownedDbTable('bolt_execution_runs')
        .update({ ...patch, lock_expires_at: null })
        .in('status', ['started', 'running'])
        .lt('heartbeat_at', cutoffIso)
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
        .is('abandonment_detected_at', null)
        .select('id, payload');
      if (error) throw error;
      sweptRows = Array.isArray(data) ? (data as typeof sweptRows) : [];
      reclaimed = sweptRows.length;
    } catch (primaryErr) {
      // Schema desync fallback: drop abandonment columns AND
      // lock_expires_at if the migration hasn't been applied yet.
      // Without forensic columns the sweep falls back to legacy
      // behavior — flips status to failed only — but still does NOT
      // clobber error_message. The fallback is the absolute floor of
      // safety; full forensic integrity requires migrations 20260725
      // and 20260727 to be applied.
      const fallbackPatch = {
        status: 'failed',
        lock_owner: null,
        updated_at: nowIso,
      };
      const { data, error } = await ownedDbTable('bolt_execution_runs')
        .update(fallbackPatch)
        .in('status', ['started', 'running'])
        .lt('heartbeat_at', cutoffIso)
        .select('id, payload');
      if (error) {
        logPipelineEvent('queue.stale_sweep', 'warn', {
          ok: false,
          detail: 'sweep_failed',
          err: (error as { message?: string })?.message,
          primary: (primaryErr as Error)?.message,
        });
        return { reclaimed: 0, ok: false, detail: 'sweep_failed' };
      }
      sweptRows = Array.isArray(data) ? (data as typeof sweptRows) : [];
      reclaimed = sweptRows.length;
    }

    // ── Phase 6I-3 — attribution stamping ───────────────────────────────────
    // Stamp campaign_type + pipeline_mode on each swept run using the same
    // authority persistPipelineFailure uses (deriveAbandonmentAttribution).
    // Best-effort: per-row, never throws, only touches these two columns.
    if (sweptRows.length > 0) {
      const { deriveAbandonmentAttribution } = await import('../../lib/shared/bolt/abandonmentAttribution');
      for (const r of sweptRows) {
        try {
          const attribution = deriveAbandonmentAttribution(r.payload ?? null);
          await ownedDbTable('bolt_execution_runs')
            .update({ campaign_type: attribution.campaign_type, pipeline_mode: attribution.pipeline_mode })
            .eq('id', r.id);
        } catch {
          // Best-effort — attribution is additive; the sweep itself already succeeded.
        }
      }
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
