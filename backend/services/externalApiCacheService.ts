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

const cache = new Map<string, CacheEntry<any>>();
const stats: CacheStats = {
  hits: 0,
  misses: 0,
  per_api_hits: {},
  per_api_misses: {},
};

const now = () => Date.now();

export const buildCacheKey = (input: {
  apiId: string;
  geo?: string;
  category?: string;
  userId?: string | null;
}) => {
  const userKey = input.userId || 'global';
  return `${input.apiId}::${input.geo || 'any'}::${input.category || 'any'}::${userKey}`;
};

export const getCachedResponse = <T>(key: string, apiId: string): T | null => {
  const entry = cache.get(key);
  if (!entry) {
    stats.misses += 1;
    stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
    return null;
  }
  if (entry.expires_at <= now()) {
    cache.delete(key);
    stats.misses += 1;
    stats.per_api_misses[apiId] = (stats.per_api_misses[apiId] || 0) + 1;
    return null;
  }
  stats.hits += 1;
  stats.per_api_hits[apiId] = (stats.per_api_hits[apiId] || 0) + 1;
  return entry.value as T;
};

export const setCachedResponse = <T>(key: string, value: T, ttlMs: number) => {
  cache.set(key, {
    value,
    expires_at: now() + ttlMs,
    created_at: now(),
  });
};

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
