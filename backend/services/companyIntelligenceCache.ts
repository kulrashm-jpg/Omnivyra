/**
 * Company Intelligence Cache
 * Phase 2: Redis cache for aggregated company intelligence insights.
 * Keys: virality:company:intelligence:{companyId}, virality:company:intelligence:clusters:{companyId}
 * TTL: 300 seconds
 */

import IORedis from 'ioredis';
import type { CompanyIntelligenceInsights } from './companyIntelligenceAggregator';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';

const PREFIX = 'virality:company';
const TTL_SEC = 300;

let redisClient: IORedis | null = null;
const inMemoryCache = new Map<
  string,
  { value: unknown; expires_at: number }
>();

function getRedisClient(): IORedis | null {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const raw = new IORedis(url, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    raw.on('error', () => {
      console.warn('[companyIntelligenceCache] Redis error');
    });
    raw.connect().catch(() => {
      console.warn('[companyIntelligenceCache] Redis unavailable, falling back to in-memory');
    });
    redisClient = createInstrumentedClient(raw, 'intelligence_cache') as IORedis;
    return redisClient;
  } catch {
    console.warn('[companyIntelligenceCache] Redis unavailable, falling back to in-memory');
    return null;
  }
}

/** Disconnect the Redis client (for graceful shutdown). */
export function shutdownCompanyIntelligenceCache(): void {
  if (redisClient) {
    redisClient.quit().catch(() => {});
    redisClient = null;
  }
}

async function isRedisOk(): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export const buildInsightsKey = (companyId: string): string =>
  `${PREFIX}:intelligence:${companyId}`;

export const buildClustersKey = (companyId: string): string =>
  `${PREFIX}:intelligence:clusters:${companyId}`;

export async function getCachedInsights(
  companyId: string
): Promise<CompanyIntelligenceInsights | null> {
  const key = buildInsightsKey(companyId);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CompanyIntelligenceInsights;
    } catch {
      // fall through
    }
  }
  const entry = inMemoryCache.get(key);
  if (!entry || entry.expires_at <= Date.now()) {
    if (entry) inMemoryCache.delete(key);
    return null;
  }
  return entry.value as CompanyIntelligenceInsights;
}

export async function setCachedInsights(
  companyId: string,
  value: CompanyIntelligenceInsights
): Promise<void> {
  const key = buildInsightsKey(companyId);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      await client.setex(key, TTL_SEC, JSON.stringify(value));
      return;
    } catch {
      // fall through
    }
  }
  inMemoryCache.set(key, {
    value,
    expires_at: Date.now() + TTL_SEC * 1000,
  });
}

export async function getCachedClusters(
  companyId: string
): Promise<CompanyIntelligenceInsights['trend_clusters'] | null> {
  const key = buildClustersKey(companyId);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CompanyIntelligenceInsights['trend_clusters'];
    } catch {
      // fall through
    }
  }
  const entry = inMemoryCache.get(key);
  if (!entry || entry.expires_at <= Date.now()) {
    if (entry) inMemoryCache.delete(key);
    return null;
  }
  return entry.value as CompanyIntelligenceInsights['trend_clusters'];
}

export async function setCachedClusters(
  companyId: string,
  value: CompanyIntelligenceInsights['trend_clusters']
): Promise<void> {
  const key = buildClustersKey(companyId);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      await client.setex(key, TTL_SEC, JSON.stringify(value));
      return;
    } catch {
      // fall through
    }
  }
  inMemoryCache.set(key, {
    value,
    expires_at: Date.now() + TTL_SEC * 1000,
  });
}

export async function invalidateCompanyCache(companyId: string): Promise<void> {
  const insightsKey = buildInsightsKey(companyId);
  const clustersKey = buildClustersKey(companyId);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      await client.del(insightsKey, clustersKey);
    } catch {
      // ignore
    }
  }
  inMemoryCache.delete(insightsKey);
  inMemoryCache.delete(clustersKey);
}
