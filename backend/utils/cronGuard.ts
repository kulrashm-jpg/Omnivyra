/**
 * cronGuard — Redis-backed cron state persistence.
 *
 * Solves the restart-reset problem: in-memory `last*Run` variables reset to 0
 * every time the cron process restarts, causing ALL tasks to fire immediately
 * on the next startup regardless of when they last ran.
 *
 * Usage in cron.ts:
 *
 *   const cronGuard = new CronGuard();
 *
 *   // In startCron(), before runSchedulerCycle():
 *   const saved = await cronGuard.load();
 *   lastSignalClusteringRun = saved.signalClustering ?? 0;
 *   // ... etc for each task
 *
 *   // At the end of runSchedulerCycle(), persist current state:
 *   void cronGuard.save({ signalClustering: lastSignalClusteringRun, ... });
 *
 * Falls back silently when Redis is unavailable — no behaviour change.
 */

import IORedis from 'ioredis';
import { config } from '@/config';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';

const REDIS_KEY  = 'omnivyra:cron:last_run_state';
const LOCK_KEY   = 'omnivyra:cron:lock';
const LOCK_TTL_S = 90;   // seconds — auto-expire if process dies mid-cycle

const STATE_TTL_SECONDS = 8 * 24 * 3600; // 8 days

export class CronGuard {
  private client: IORedis | null = null;
  private available = false;

  constructor() {
    const url = config.REDIS_URL;
    try {
      const raw = new IORedis(url, {
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      raw.on('connect', () => { this.available = true; });
      raw.on('error', () => { this.available = false; });
      raw.connect().catch(() => {});
      this.client = createInstrumentedClient(raw, 'cron') as IORedis;
    } catch {
      this.client = null;
    }
  }

  /**
   * Load previously persisted last-run timestamps.
   * Returns a record of taskName → timestamp (ms since epoch).
   * Returns {} when Redis is unavailable (safe fallback).
   */
  async load(): Promise<Record<string, number>> {
    if (!this.client || !this.available) return {};
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

  /**
   * Persist the current last-run state snapshot to Redis.
   * Fire-and-forget — call with void at end of each scheduler cycle.
   */
  async save(state: Record<string, number>): Promise<void> {
    if (!this.client || !this.available) return;
    try {
      await this.client.set(REDIS_KEY, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
    } catch (err: any) {
      console.warn('[cron-guard] save failed:', err?.message);
    }
  }

  /**
   * Acquire distributed cycle lock via SET NX EX.
   * Returns true if lock acquired (this instance should proceed).
   * Returns false if another instance already holds the lock.
   *
   * Stores instanceId as value so releaseLock() can safely delete only its own lock.
   */
  async tryAcquireLock(instanceId: string): Promise<boolean> {
    if (!this.client || !this.available) return true; // Redis down → allow (single-instance safe)
    try {
      const result = await this.client.set(LOCK_KEY, instanceId, 'EX', LOCK_TTL_S, 'NX');
      return result === 'OK';
    } catch {
      return true; // Redis error → allow rather than block all cron work
    }
  }

  /**
   * Release the cycle lock, but only if it still belongs to this instance.
   * Uses a Lua script for atomic check-and-delete.
   */
  async releaseLock(instanceId: string): Promise<void> {
    if (!this.client || !this.available) return;
    try {
      // Lua: if value matches instanceId, delete; otherwise no-op
      await (this.client as IORedis).eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        LOCK_KEY,
        instanceId,
      );
    } catch { /* ignore — lock will expire via TTL */ }
  }

  /** Disconnect the Redis client (for graceful shutdown). */
  shutdown(): void {
    if (this.client) {
      this.client.quit().catch(() => {});
      this.client = null;
      this.available = false;
    }
  }
}
