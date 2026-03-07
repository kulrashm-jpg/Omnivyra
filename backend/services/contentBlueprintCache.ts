/**
 * LRU slot-level cache for content blueprints.
 * Key: companyId + normalized_topic + content_type (+ optional audience for backward compat).
 * Max 200 items, TTL 10 minutes, LRU eviction.
 * Memory guard: shrink by 20% when heap threshold exceeded.
 */

export type ContentBlueprint = {
  hook: string;
  key_points: string[];
  cta: string;
};

type CacheEntry = {
  blueprint: ContentBlueprint;
  timestamp: number;
  accessOrder: number;
  normalizedTopic: string;
};

const MAX_ITEMS = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const HEAP_SHRINK_THRESHOLD_BYTES = 400 * 1024 * 1024; // 400 MB
const SHRINK_RATIO = 0.2;
let accessCounter = 0;

const cache = new Map<string, CacheEntry>();
const accessOrderMap = new Map<number, string>();

let metricsHits = 0;
let metricsMisses = 0;

/**
 * Normalize topic for deduplication.
 * "AI Strategy for B2B Companies" → "ai_strategy_b2b"
 */
export function normalizeTopic(topic: string): string {
  const s = String(topic ?? '').trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .join('_')
    .replace(/^_|_$/g, '') || 'untitled';
}

function tokenizeTopic(normalizedTopic: string): Set<string> {
  return new Set(
    (normalizedTopic ?? '')
      .split(/[_\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2)
  );
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find a cached blueprint with similar normalized topic.
 * Returns cached blueprint if similarity >= threshold (default 0.85).
 */
export function findSimilarBlueprint(
  companyId: string,
  normalizedTopic: string,
  contentType: string,
  threshold = 0.85
): ContentBlueprint | null {
  const norm = (s: string) => String(s ?? '').trim().toLowerCase().slice(0, 200);
  const targetTokens = tokenizeTopic(normalizedTopic);
  if (targetTokens.size === 0) return null;

  const prefix = `blueprint:${norm(companyId)}:`;
  let best: { blueprint: ContentBlueprint; sim: number } | null = null;

  for (const [key, entry] of cache) {
    if (!key.startsWith(prefix)) continue;
    if (!key.includes(`:${norm(contentType)}:`)) continue;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) continue;

    const cacheTokens = tokenizeTopic(entry.normalizedTopic);
    const sim = jaccardSimilarity(targetTokens, cacheTokens);
    if (sim >= threshold && (!best || sim > best.sim)) {
      best = { blueprint: entry.blueprint, sim };
    }
  }

  return best ? best.blueprint : null;
}

function buildCacheKey(
  companyId: string,
  theme: string,
  contentType: string,
  audience: string
): string {
  const norm = (s: string) => String(s ?? '').trim().toLowerCase().slice(0, 200);
  const nt = normalizeTopic(theme) || norm(theme);
  return `blueprint:${norm(companyId)}:${nt}:${norm(contentType)}:${norm(audience)}`;
}

/** Build deduplication key: companyId + normalized_topic + content_type (for lookup). */
function buildDedupKey(companyId: string, theme: string, contentType: string): string {
  const norm = (s: string) => String(s ?? '').trim().toLowerCase().slice(0, 200);
  const nt = normalizeTopic(theme) || norm(theme);
  return `blueprint:${norm(companyId)}:${nt}:${norm(contentType)}`;
}

function getHeapUsage(): number {
  try {
    const mem = process.memoryUsage?.();
    return mem?.heapUsed ?? (mem as any)?.used ?? 0;
  } catch {
    return 0;
  }
}

function shrinkCache(): void {
  const toEvict = Math.max(1, Math.floor(cache.size * SHRINK_RATIO));
  const byOrder = Array.from(cache.entries())
    .filter(([, e]) => Date.now() - e.timestamp <= CACHE_TTL_MS)
    .sort(([, a], [, b]) => a.accessOrder - b.accessOrder);
  for (let i = 0; i < Math.min(toEvict, byOrder.length); i++) {
    const [key, entry] = byOrder[i]!;
    cache.delete(key);
    accessOrderMap.delete(entry.accessOrder);
  }
  if (process.env.NODE_ENV === 'development') {
    console.debug('[content-blueprint-cache] memory guard: shrunk by', toEvict);
  }
}

function evictLRU(): void {
  const heapUsed = getHeapUsage();
  if (heapUsed > HEAP_SHRINK_THRESHOLD_BYTES) {
    shrinkCache();
  }
  if (cache.size < MAX_ITEMS) return;
  let oldestKey: string | null = null;
  let oldestOrder = Infinity;
  for (const [key, entry] of cache) {
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
      accessOrderMap.delete(entry.accessOrder);
      return;
    }
    if (entry.accessOrder < oldestOrder) {
      oldestOrder = entry.accessOrder;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    cache.delete(oldestKey);
    accessOrderMap.delete(oldestOrder);
  }
}

function recordAccess(key: string, entry: CacheEntry): void {
  accessOrderMap.delete(entry.accessOrder);
  accessCounter += 1;
  entry.accessOrder = accessCounter;
  entry.timestamp = Date.now();
  accessOrderMap.set(accessCounter, key);
}

export function getCachedBlueprint(
  companyId: string,
  theme: string,
  contentType: string,
  audience: string
): ContentBlueprint | null {
  try {
    const key = buildCacheKey(companyId, theme, contentType, audience);
    const dedupKey = buildDedupKey(companyId, theme, contentType);
    const nt = normalizeTopic(theme);

    let foundKey = key;
    let entry = cache.get(key);
    if (!entry) {
      for (const [k, e] of cache) {
        if (k.startsWith(dedupKey + ':') || k === dedupKey) {
          entry = e;
          foundKey = k;
          break;
        }
      }
    }
    if (!entry) {
      const similar = findSimilarBlueprint(companyId, nt || theme, contentType, 0.85);
      if (similar) {
        metricsHits += 1;
        return similar;
      }
      metricsMisses += 1;
      return null;
    }
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(foundKey);
      metricsMisses += 1;
      return null;
    }
    recordAccess(foundKey, entry);
    metricsHits += 1;
    if (process.env.NODE_ENV === 'development') {
      console.debug('[content-blueprint-cache] hit', key.slice(0, 80));
    }
    return entry.blueprint;
  } catch {
    metricsMisses += 1;
    return null;
  }
}

export function setCachedBlueprint(
  companyId: string,
  theme: string,
  contentType: string,
  audience: string,
  blueprint: ContentBlueprint
): void {
  try {
    evictLRU();
    const key = buildCacheKey(companyId, theme, contentType, audience);
    const nt = normalizeTopic(theme);
    accessCounter += 1;
    const entry: CacheEntry = {
      blueprint,
      timestamp: Date.now(),
      accessOrder: accessCounter,
      normalizedTopic: nt || String(theme ?? '').trim().toLowerCase(),
    };
    cache.set(key, entry);
    accessOrderMap.set(accessCounter, key);
  } catch {
    // fail-safe
  }
}

export function getBlueprintCacheMetrics(): {
  blueprint_cache_hits: number;
  blueprint_cache_misses: number;
  cache_hit_ratio: number;
} {
  const total = metricsHits + metricsMisses;
  const cache_hit_ratio = total > 0 ? metricsHits / total : 0;
  return {
    blueprint_cache_hits: metricsHits,
    blueprint_cache_misses: metricsMisses,
    cache_hit_ratio,
  };
}
