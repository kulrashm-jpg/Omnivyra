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

const REDIS_KEY = 'omnivyra:cron:last_run_state';
const STATE_TTL_SECONDS = 8 * 24 * 3600; // 8 days

export class CronGuard {
  private client: IORedis | null = null;
  private available = false;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.client = new IORedis(url, {
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      this.client.on('connect', () => { this.available = true; });
      this.client.on('error', () => { this.available = false; });
      this.client.connect().catch(() => {});
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
}
