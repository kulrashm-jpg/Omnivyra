/**
 * cronGuard - Redis-backed cron state persistence.
 *
 * Falls back silently when Redis is unavailable; no scheduler behavior changes.
 */

import IORedis from 'ioredis';
import {
  getInstrumentedStandaloneRedisClient,
  isSharedStandaloneRedisAvailable,
} from '../queue/standaloneRedisClient';

const REDIS_KEY = 'omnivyra:cron:last_run_state';
const LOCK_KEY = 'omnivyra:cron:lock';
const LOCK_TTL_S = 90;
const STATE_TTL_SECONDS = 8 * 24 * 3600;

export class CronGuard {
  private client: IORedis | null = null;

  constructor() {
    try {
      this.client = getInstrumentedStandaloneRedisClient('cron');
    } catch {
      this.client = null;
    }
  }

  async load(): Promise<Record<string, number>> {
    if (!this.client || !isSharedStandaloneRedisAvailable()) return {};
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

  async tryAcquireLock(instanceId: string): Promise<boolean> {
    if (!this.client || !isSharedStandaloneRedisAvailable()) return true;
    try {
      const result = await this.client.set(LOCK_KEY, instanceId, 'EX', LOCK_TTL_S, 'NX');
      return result === 'OK';
    } catch {
      return true;
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
