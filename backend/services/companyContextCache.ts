/**
 * Global AI Context Deduplication Cache
 *
 * Stores company profile, strategy learning profile, platform eligibility,
 * and platform capacity rules to avoid repeating large prompt contexts across campaigns.
 * Key: companyId + context_type. TTL = 30 minutes.
 *
 * Hardened: max 2000 entries (4 context types × ~500 companies) with LRU eviction.
 */

const TTL_MS     = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 2_000;

type CacheEntry<T> = {
  value: T;
  timestamp: number;
};

// Insertion-order map acts as LRU: delete + re-insert on access moves to tail.
const cache = new Map<string, CacheEntry<unknown>>();

export type ContextType = 'company_profile' | 'strategy_learning_profile' | 'platform_eligibility' | 'platform_capacity_rules';

function buildKey(companyId: string, contextType: ContextType): string {
  return `${String(companyId ?? '').trim()}::${contextType}`;
}

function evictLRU(): void {
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

export function getCachedContext<T>(companyId: string, contextType: ContextType): T | null {
  const key = buildKey(companyId, contextType);
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Move to tail (most recently used)
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function setCachedContext<T>(companyId: string, contextType: ContextType, value: T): void {
  const key = buildKey(companyId, contextType);
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_ENTRIES) {
    evictLRU();
  }
  cache.set(key, { value, timestamp: Date.now() });
}
