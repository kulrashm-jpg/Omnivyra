/**
 * cronGuard - Redis-backed cron state persistence + scheduler cycle lock.
 *
 * Falls back when Redis is unavailable; no scheduler behavior changes.
 *
 * SEC-C3 (STEP 3AH-91) — lock failure policy, made explicit:
 *
 *   - A client that is still making its INITIAL connection is not treated as
 *     "unavailable": callers wait (bounded, READY_WAIT_MS) for readiness. The
 *     old check treated "not ready yet" as "no Redis" and ran the cycle
 *     unguarded — precisely the boot cycle of a new deployment while the old
 *     container is still running (the one moment a second instance exists),
 *     and it also skipped restoring last-run timestamps, so every task ran.
 *
 *   - Genuine unavailability (client ended / reconnecting / SET error) keeps
 *     the historical FAIL-OPEN default — INTENTIONALLY ACCEPTED for the
 *     single-replica worker: the side effects that must not duplicate carry
 *     their own Redis-independent claims (post-level publish claim,
 *     token_refresh_locks for single-use refresh tokens, BOLT run claims), and
 *     failing closed would silently stop token refresh for the whole Redis
 *     outage. Local development without Redis keeps working. Every fail-open
 *     cycle now logs a structured `cron_lock_fail_open` warning.
 *
 *   - CRON_LOCK_FAIL_CLOSED=1 flips unavailability to SKIP the cycle (the
 *     F-15 distributedLock default). Set it before running numReplicas > 1.
 */

import IORedis from 'ioredis';
import {
  getInstrumentedStandaloneRedisClient,
  getSharedStandaloneRedisClient,
  isSharedStandaloneRedisAvailable,
} from '../queue/standaloneRedisClient';

const REDIS_KEY = 'omnivyra:cron:last_run_state';
const LOCK_KEY = 'omnivyra:cron:lock';
const LOCK_TTL_S = 90;
const STATE_TTL_SECONDS = 8 * 24 * 3600;
/** Bound on waiting for an initial connection before deciding "unavailable". */
const READY_WAIT_MS = 3_000;
/** ioredis states of a client that is still establishing its FIRST connection. */
const INITIAL_CONNECT_STATES = new Set(['wait', 'connecting', 'connect']);

function lockFailClosed(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.CRON_LOCK_FAIL_CLOSED ?? ''));
}

export class CronGuard {
  private client: IORedis | null = null;

  constructor() {
    try {
      this.client = getInstrumentedStandaloneRedisClient('cron');
    } catch {
      this.client = null;
    }
  }

  /**
   * True once the shared standalone client is ready. While it is still making
   * its initial connection, waits up to READY_WAIT_MS for 'ready'. Never throws.
   */
  private async ready(): Promise<boolean> {
    if (!this.client) return false;
    if (isSharedStandaloneRedisAvailable()) return true;
    let raw: IORedis | null = null;
    try { raw = getSharedStandaloneRedisClient(); } catch { return false; }
    if (!raw || !INITIAL_CONNECT_STATES.has(String(raw.status))) return false;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); raw!.removeListener('ready', done); resolve(); };
      const timer = setTimeout(done, READY_WAIT_MS);
      if (typeof timer.unref === 'function') timer.unref();
      raw!.once('ready', done);
    });
    return isSharedStandaloneRedisAvailable();
  }

  async load(): Promise<Record<string, number>> {
    if (!this.client || !(await this.ready())) return {};
    try {
      const raw = await this.client.get(REDIS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        console.info('[cron-guard] restored', Object.keys(parsed).length, 'task timestamps');
        return parsed as Record<string, number>;
      }
    } catch (err: any) {
      console.warn('[cron-guard] load failed, using fresh state:', err?.message);
    }
    return {};
  }

  async save(state: Record<string, number>): Promise<void> {
    if (!this.client || !isSharedStandaloneRedisAvailable()) return;
    try {
      await this.client.set(REDIS_KEY, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
    } catch (err: any) {
      console.warn('[cron-guard] save failed:', err?.message);
    }
  }

  /** Policy when the lock cannot be verified (see module doc). */
  private unverifiedLock(instanceId: string, reason: string): boolean {
    if (lockFailClosed()) {
      console.error(JSON.stringify({
        level: 'ERROR', event: 'cron_lock_fail_closed', instanceId, reason,
        detail: 'scheduler cycle skipped: lock could not be verified (CRON_LOCK_FAIL_CLOSED=1)',
      }));
      return false;
    }
    console.warn(JSON.stringify({
      level: 'WARN', event: 'cron_lock_fail_open', instanceId, reason,
      detail: 'scheduler cycle runs WITHOUT the cross-instance lock (single-replica policy; set CRON_LOCK_FAIL_CLOSED=1 before scaling replicas)',
    }));
    return true;
  }

  async tryAcquireLock(instanceId: string): Promise<boolean> {
    if (!this.client || !(await this.ready())) return this.unverifiedLock(instanceId, 'redis_unavailable');
    try {
      const result = await this.client.set(LOCK_KEY, instanceId, 'EX', LOCK_TTL_S, 'NX');
      return result === 'OK';
    } catch (err: any) {
      return this.unverifiedLock(instanceId, `redis_error:${String(err?.message ?? 'unknown').slice(0, 120)}`);
    }
  }

  async releaseLock(instanceId: string): Promise<void> {
    if (!this.client || !isSharedStandaloneRedisAvailable()) return;
    try {
      await this.client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        LOCK_KEY,
        instanceId,
      );
    } catch {
      // Lock will expire via TTL.
    }
  }

  shutdown(): void {
    this.client = null;
  }
}
