/**
 * Redis-backed External API Cache and Rate Limiter
 * Phase 1: Replaces externalApiCacheService and rateLimitState.
 * Falls back to in-memory when Redis is unavailable.
 */

import IORedis from 'ioredis';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';

const PREFIX = 'virality:ext_api';
const CACHE_TTL_SEC = 720;
const RATE_LIMIT_WINDOW_SEC = 60;

type CacheEntry<T> = {
  value: T;
  expires_at: number;
  created_at: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  per_api_hits: Record<string, number>;
  per_api_misses: Record<string, number>;
};

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  per_api_hits: {},
  per_api_misses: {},
};

let redisClient: IORedis | null = null;
let redisAvailable = false;
const inMemoryCache = new Map<string, CacheEntry<any>>();
const inMemoryRateLimit = new Map<string, number[]>();
let lastRateLimitedSources: string[] = [];

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
      redisAvailable = false;
    });
    raw.on('connect', () => {
      redisAvailable = true;
    });
    raw.connect().then(() => {
      redisAvailable = true;
    }).catch(() => {
      redisAvailable = false;
      console.warn('[redisExternalApiCache] Redis unavailable, falling back to in-memory');
    });
    redisClient = createInstrumentedClient(raw, 'external_api_cache') as IORedis;
    return redisClient;
  } catch {
    console.warn('[redisExternalApiCache] Redis unavailable, falling back to in-memory');
    return null;
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

export const buildCacheKey = (input: {
  apiId: string;
  geo?: string;
  category?: string;
  userId?: string | null;
}) => {
  const userKey = input.userId || 'global';
  return `${PREFIX}:cache:${input.apiId}::${input.geo || 'any'}::${input.category || 'any'}::${userKey}`;
};

export async function getCachedResponse<T>(
  key: string,
  apiId: string
): Promise<T | null> {
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      const raw = await client.get(key);
      if (!raw) {
        stats.misses += 1;
        stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
        return null;
      }
      const parsed = JSON.parse(raw) as T;
      stats.hits += 1;
      stats.per_api_hits[apiId] = (stats.per_api_hits[apiId] || 0) + 1;
      return parsed;
    } catch {
      stats.misses += 1;
      stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
      return null;
    }
  }

  const entry = inMemoryCache.get(key);
  if (!entry) {
    stats.misses += 1;
    stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
    return null;
  }
  if (entry.expires_at <= Date.now()) {
    inMemoryCache.delete(key);
    stats.misses += 1;
    stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
    return null;
  }
  stats.hits += 1;
  stats.per_api_hits[apiId] = (stats.per_api_hits[apiId] || 0) + 1;
  return entry.value as T;
}

export async function setCachedResponse<T>(
  key: string,
  value: T,
  ttlMs: number
): Promise<void> {
  const ttlSec = Math.ceil(ttlMs / 1000);
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      await client.setex(key, ttlSec, JSON.stringify(value));
      return;
    } catch {
      // fall through to in-memory
    }
  }

  inMemoryCache.set(key, {
    value,
    expires_at: Date.now() + ttlMs,
    created_at: Date.now(),
  });
}

export const getCacheStats = () => ({
  hits: stats.hits,
  misses: stats.misses,
  per_api_hits: { ...stats.per_api_hits },
  per_api_misses: { ...stats.per_api_misses },
});

export const resetCacheStats = () => {
  stats.hits = 0;
  stats.misses = 0;
  stats.per_api_hits = {};
  stats.per_api_misses = {};
};

function rateLimitRedisKey(rateLimitKeyStr: string): string {
  return `${PREFIX}:ratelimit:${rateLimitKeyStr}`;
}

export async function isRateLimited(
  rateLimitKeyStr: string,
  limitPerMin: number
): Promise<boolean> {
  const key = rateLimitRedisKey(rateLimitKeyStr);

  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_SEC * 1000;
      await client.zremrangebyscore(key, 0, windowStart);
      const count = await client.zcard(key);
      if (count >= limitPerMin) {
        return true;
      }
      await client.zadd(key, now, `${now}`);
      await client.expire(key, RATE_LIMIT_WINDOW_SEC + 10);
      return false;
    } catch {
      // fall through to in-memory
    }
  }

  const now = Date.now();
  const windowMs = 60 * 1000;
  const entries = inMemoryRateLimit.get(rateLimitKeyStr) || [];
  const recent = entries.filter((t) => now - t < windowMs);
  if (recent.length >= limitPerMin) {
    inMemoryRateLimit.set(rateLimitKeyStr, recent);
    return true;
  }
  recent.push(now);
  inMemoryRateLimit.set(rateLimitKeyStr, recent);
  return false;
}

export function addRateLimitedSource(sourceName: string): void {
  if (!lastRateLimitedSources.includes(sourceName)) {
    lastRateLimitedSources.push(sourceName);
  }
}

export function getLastRateLimitedSources(): string[] {
  return [...lastRateLimitedSources];
}

export function clearLastRateLimitedSources(): void {
  lastRateLimitedSources = [];
}

export async function resetExternalApiRuntime(): Promise<void> {
  inMemoryCache.clear();
  inMemoryRateLimit.clear();
  clearLastRateLimitedSources();
  resetCacheStats();
  const ok = await isRedisOk();
  if (ok) {
    try {
      const client = getRedisClient()!;
      const keys = await client.keys(`${PREFIX}:*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch {
      // ignore
    }
  }
}
