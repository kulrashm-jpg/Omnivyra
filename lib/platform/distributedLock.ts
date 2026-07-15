/**
 * F-15 — Distributed Lock & Lease Framework (Foundation Batch E).
 *
 * Promotes the proven CronGuard pattern (SET NX EX + owner token) into the
 * canonical primitive every multi-replica-unsafe code path uses, adding the
 * three things CronGuard lacked for replica scaling:
 *   - FENCING TOKENS: a monotonic INCR per lock name, returned on acquire.
 *     Downstream writers can reject stale holders after a lease expiry race.
 *   - OWNERSHIP-VERIFIED RENEWAL + RELEASE (Lua compare-owner-then-act) — a
 *     holder can never release or extend a lock another instance now owns.
 *   - withLease(): acquire → run → always release; skipped (not queued) when
 *     another instance holds the lease — the semantics every scheduleWorker
 *     timer needs under numReplicas > 1.
 *
 * Fail modes are EXPLICIT: Redis unreachable → acquire returns
 * { acquired:false, reason:'unavailable' } and withLease SKIPS by default
 * (safe under replicas: rather miss a tick than double-fire). Single-replica
 * deployments may set DISTRIBUTED_LOCKS_FAIL_OPEN=1 to run anyway (today's
 * behavior). Kill switch DISTRIBUTED_LOCKS_KILL=1 restores pure pass-through
 * — ONLY safe at numReplicas=1, which the kill path logs loudly.
 */
import { randomUUID } from 'crypto';
import { recordRawCounter, recordRawHistogram } from '../../backend/observability';

const PREFIX = 'omnivyra:lock';
const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
const RENEW_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end`;

async function redis() {
  const { getStandaloneRedis } = await import('../redis/canonicalClient');
  return getStandaloneRedis('cron');
}

function killed(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.DISTRIBUTED_LOCKS_KILL ?? ''));
}
function failOpen(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.DISTRIBUTED_LOCKS_FAIL_OPEN ?? ''));
}

export interface LeaseHandle {
  acquired: boolean;
  reason?: 'held' | 'unavailable' | 'killed';
  /** Monotonic fencing token (only when acquired). */
  fencingToken?: number;
  owner: string;
  /** Extend the lease TTL; false = ownership lost (stop writing!). */
  renew(ttlSeconds: number): Promise<boolean>;
  /** Ownership-verified release; safe to call multiple times. */
  release(): Promise<void>;
}

/** Try to acquire `name` for ttlSeconds. Never throws. */
export async function acquireLease(name: string, ttlSeconds: number): Promise<LeaseHandle> {
  const key = `${PREFIX}:${name}`;
  const owner = INSTANCE_ID;
  const noop = async () => {};
  if (killed()) {
    console.warn('[distributed-lock] KILLED — pass-through acquire (single-replica ONLY)', { name });
    return { acquired: true, reason: 'killed', owner, renew: async () => true, release: noop };
  }
  try {
    const client = await redis();
    const set = await client.set(key, owner, 'EX', Math.max(1, ttlSeconds), 'NX');
    if (set !== 'OK') {
      try { recordRawCounter('lock.denied', 1, { name }); } catch { /* fail-safe */ }
      return { acquired: false, reason: 'held', owner, renew: async () => false, release: noop };
    }
    const fencingToken = await client.incr(`${key}:fence`);
    try { recordRawCounter('lock.acquired', 1, { name }); } catch { /* fail-safe */ }
    return {
      acquired: true,
      fencingToken,
      owner,
      async renew(nextTtlSeconds: number): Promise<boolean> {
        try {
          const ok = await (await redis()).eval(RENEW_LUA, 1, key, owner, String(Math.max(1, nextTtlSeconds)));
          return Number(ok) === 1;
        } catch {
          return false;
        }
      },
      async release(): Promise<void> {
        try {
          await (await redis()).eval(RELEASE_LUA, 1, key, owner);
          try { recordRawCounter('lock.released', 1, { name }); } catch { /* fail-safe */ }
        } catch { /* TTL is the backstop */ }
      },
    };
  } catch {
    try { recordRawCounter('lock.unavailable', 1, { name }); } catch { /* fail-safe */ }
    return { acquired: false, reason: 'unavailable', owner, renew: async () => false, release: noop };
  }
}

export interface WithLeaseResult<T> {
  ran: boolean;
  reason?: LeaseHandle['reason'];
  value?: T;
}

/**
 * Run `fn` iff the lease is acquired; always release afterwards. Redis
 * unavailable → skip (or run, under DISTRIBUTED_LOCKS_FAIL_OPEN=1).
 *
 * CERT-FIX P3 (certification §14.3): the lease is AUTO-RENEWED at ttl/2 for
 * as long as `fn` runs, so a body that outlives its initial TTL can no
 * longer silently lose the lock and double-execute against another replica.
 * Renewal is ownership-verified (RENEW_LUA): if renewal ever reports
 * ownership lost (Redis blip past the TTL, or takeover), we record
 * `lock.ownership_lost` — the replica-canary rollback signal — and stop
 * renewing; the body is not aborted (in-flight work can't be safely torn
 * down) but the event is loud, counted, and carries the fencing token so
 * downstream writers holding `lease.fencingToken` can reject stale writes.
 * Lease-pressure metrics: lock.renewed / lock.renew_failed / lock.section_ms
 * (compare section_ms p95 against TTLs before enabling replicas).
 */
export async function withLease<T>(
  name: string,
  ttlSeconds: number,
  fn: (lease: LeaseHandle) => Promise<T>,
): Promise<WithLeaseResult<T>> {
  const lease = await acquireLease(name, ttlSeconds);
  if (!lease.acquired) {
    if (lease.reason === 'unavailable' && failOpen()) {
      const startedAt = Date.now();
      const value = await fn(lease);
      try { recordRawHistogram('lock.section_ms', Date.now() - startedAt, { name, mode: 'fail_open' }); } catch { /* fail-safe */ }
      return { ran: true, reason: 'unavailable', value };
    }
    return { ran: false, reason: lease.reason };
  }

  // Heartbeat renewal at half-TTL while the body runs.
  let ownershipLost = false;
  const renewEveryMs = Math.max(1_000, Math.floor((ttlSeconds * 1_000) / 2));
  const heartbeat = setInterval(() => {
    void lease.renew(ttlSeconds).then((ok) => {
      if (ok) {
        try { recordRawCounter('lock.renewed', 1, { name }); } catch { /* fail-safe */ }
        return;
      }
      if (!ownershipLost) {
        ownershipLost = true;
        try { recordRawCounter('lock.ownership_lost', 1, { name }); } catch { /* fail-safe */ }
        console.error('[distributed-lock] OWNERSHIP LOST mid-section — possible concurrent holder; ' +
          'writers must honor fencing tokens', { name, fencingToken: lease.fencingToken, owner: lease.owner });
      }
      try { recordRawCounter('lock.renew_failed', 1, { name }); } catch { /* fail-safe */ }
      clearInterval(heartbeat);
    }).catch(() => { /* renew() never throws, defensive */ });
  }, renewEveryMs);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const startedAt = Date.now();
  try {
    const value = await fn(lease);
    return { ran: true, value };
  } finally {
    clearInterval(heartbeat);
    try { recordRawHistogram('lock.section_ms', Date.now() - startedAt, { name, mode: 'leased' }); } catch { /* fail-safe */ }
    await lease.release();
  }
}

/** Stable identity of this process (diagnostics + duplicate detection). */
export function lockInstanceId(): string {
  return INSTANCE_ID;
}
