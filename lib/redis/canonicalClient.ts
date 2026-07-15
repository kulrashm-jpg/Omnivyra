/**
 * F-06 — Canonical Redis client access layer (Foundation Batch B).
 *
 * ONE import point for Redis connectivity, promoting the two blessed
 * factories that already exist. This is a consolidation facade — it creates
 * no new connection strategy and changes no consumer behavior. Wave 2 (W2-7)
 * migrates the remaining option-object BullMQ constructions onto it; new code
 * MUST come here instead of `new IORedis(...)`.
 *
 * WHICH CLIENT WHEN:
 *   - BullMQ queues/workers → `getSharedQueueRedis()` (bullmqClient's shared
 *     connection: bounded retry strategy, reconnect policy, infra bootstrap
 *     on 'connect'). BullMQ duplicates it internally for blocking ops.
 *   - Everything else (rate limits, caches, locks, config) →
 *     `getStandaloneRedis(feature)` (instrumented, per-feature accounting,
 *     command timeouts). Features share one physical connection per process.
 *   - NEVER construct raw `new IORedis(...)` outside these factories — every
 *     extra connection is a TLS handshake + AUTH against Upstash limits and
 *     escapes instrumentation/usage-protection (audit B-21/B-45).
 *
 * All accessors are LAZY (dynamic import) so importing this module from
 * config-light contexts (lib/platform, tests) pulls no ioredis/bullmq until
 * a client is actually requested.
 */
import type IORedis from 'ioredis';

/** True when any Redis endpoint is configured for this process. */
export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL);
}

/**
 * Instrumented standalone client (non-queue workloads). `feature` attributes
 * command counts per subsystem (e.g. 'rate_limit', 'cron', 'ai_cache').
 */
export async function getStandaloneRedis(feature: string): Promise<IORedis> {
  const { getInstrumentedStandaloneRedisClient } = await import(
    '../../backend/queue/standaloneRedisClient'
  );
  return getInstrumentedStandaloneRedisClient(feature);
}

/** The shared BullMQ connection (queue/worker construction only). */
export async function getSharedQueueRedis(): Promise<IORedis> {
  const { getSharedRedisClient } = await import('../../backend/queue/bullmqClient');
  return getSharedRedisClient();
}

export interface RedisHealthSnapshot {
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
}

/**
 * Bounded connectivity probe on the standalone client. Never throws; a
 * timeout/unreachable Redis reports `reachable: false`.
 */
export async function getRedisHealthSnapshot(timeoutMs = 1_500): Promise<RedisHealthSnapshot> {
  if (!redisConfigured()) {
    return { configured: false, reachable: false, latencyMs: null };
  }
  try {
    const client = await getStandaloneRedis('health');
    const started = Date.now();
    const pong = await Promise.race<string | null>([
      client.ping(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (pong === null) {
      return { configured: true, reachable: false, latencyMs: null, error: `ping timed out after ${timeoutMs}ms` };
    }
    return { configured: true, reachable: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
