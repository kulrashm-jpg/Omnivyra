/**
 * Global AI Context Deduplication Cache
 *
 * Stores company profile, strategy learning profile, platform eligibility,
 * and platform capacity rules to avoid repeating large prompt contexts across campaigns.
 * Key: companyId + context_type. TTL = 30 minutes.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

type CacheEntry<T> = {
  value: T;
  timestamp: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export type ContextType = 'company_profile' | 'strategy_learning_profile' | 'platform_eligibility' | 'platform_capacity_rules';

function buildKey(companyId: string, contextType: ContextType): string {
  return `${String(companyId ?? '').trim()}::${contextType}`;
}

export function getCachedContext<T>(companyId: string, contextType: ContextType): T | null {
  const key = buildKey(companyId, contextType);
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() - entry.timestamp > TTL_MS) {
    if (entry) cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedContext<T>(companyId: string, contextType: ContextType, value: T): void {
  const key = buildKey(companyId, contextType);
  cache.set(key, { value, timestamp: Date.now() });
}
