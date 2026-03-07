/**
 * Strategy Profile Cache
 * TTL 6 hours, LRU max 500 entries.
 * Prevents expensive recomputation when multiple campaigns run simultaneously.
 */

import { getStrategyProfile } from './campaignStrategyLearner';
import type { StrategyProfile } from './campaignStrategyLearner';

export type CachedStrategyProfile = {
  profile: StrategyProfile;
  fetchedAt: number;
};

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SIZE = 500;

const cache = new Map<string, CachedStrategyProfile>();
const accessOrder: string[] = [];

let cacheHits = 0;
let cacheMisses = 0;

function evictLRU(): void {
  while (cache.size >= MAX_SIZE && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    if (oldest) cache.delete(oldest);
  }
}

function touch(key: string): void {
  const idx = accessOrder.indexOf(key);
  if (idx >= 0) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

export function getStrategyProfileFromCache(companyId: string): import('./campaignStrategyLearner').StrategyProfile | null {
  const key = companyId.trim();
  if (!key) return null;

  const entry = cache.get(key);
  if (!entry) {
    cacheMisses++;
    return null;
  }

  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(key);
    const i = accessOrder.indexOf(key);
    if (i >= 0) accessOrder.splice(i, 1);
    cacheMisses++;
    return null;
  }

  cacheHits++;
  touch(key);
  return entry.profile;
}

export function setStrategyProfileInCache(companyId: string, profile: StrategyProfile): void {
  const key = companyId.trim();
  if (!key) return;

  evictLRU();
  cache.set(key, { profile, fetchedAt: Date.now() });
  touch(key);
}

/**
 * Invalidate cached strategy profile for a company.
 * Call when learning signals are updated so future planning uses fresh data.
 * TTL still applies for entries not explicitly invalidated.
 */
export function invalidateStrategyProfileCache(companyId: string): void {
  const key = companyId.trim();
  if (!key) return;

  cache.delete(key);
  const idx = accessOrder.indexOf(key);
  if (idx >= 0) accessOrder.splice(idx, 1);
}

/**
 * Get strategy profile, from cache if valid, otherwise fetch and cache.
 * Returns { profile, fromCache } for observability.
 */
export async function getCachedStrategyProfile(
  companyId: string,
  lookbackDays?: number
): Promise<{ profile: StrategyProfile; fromCache: boolean }> {
  const key = String(companyId ?? '').trim();
  if (!key) {
    cacheMisses++;
    const profile = await getStrategyProfile(companyId, lookbackDays ?? 180);
    return { profile, fromCache: false };
  }

  const cached = getStrategyProfileFromCache(companyId);
  if (cached) {
    return { profile: cached, fromCache: true };
  }

  const profile = await getStrategyProfile(companyId, lookbackDays ?? 180);
  setStrategyProfileInCache(companyId, profile);
  return { profile, fromCache: false };
}

export function getStrategyProfileCacheMetrics(): {
  strategy_profile_cache_hits: number;
  strategy_profile_cache_misses: number;
} {
  return {
    strategy_profile_cache_hits: cacheHits,
    strategy_profile_cache_misses: cacheMisses,
  };
}
