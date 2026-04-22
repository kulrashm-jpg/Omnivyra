/**
 * Lightweight per-process cache for intelligence responses. Keyed by
 * (organization_id, platform, action_type, target_id); TTL 45 seconds
 * by default (bounded inside [30, 60] per the phase requirement).
 *
 * Scope: in-memory only. Workers / web processes each hold their own
 * cache. A miss is inexpensive — the service does a handful of
 * bounded SELECTs — so cross-process consistency is not worth a
 * shared layer yet.
 */

type Entry<T> = { value: T; at: number };

const DEFAULT_TTL_MS = 45 * 1000;
const MAX_ENTRIES    = 2000;

const store: Map<string, Entry<unknown>> = new Map();

function buildKey(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').toString().toLowerCase()).join('|');
}

function evictOldest(): void {
  if (store.size <= MAX_ENTRIES) return;
  const first = store.keys().next().value as string | undefined;
  if (first) store.delete(first);
}

export function cacheGet<T>(parts: Array<string | null | undefined>): T | null {
  const key = buildKey(parts);
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DEFAULT_TTL_MS) {
    store.delete(key);
    return null;
  }
  // LRU-ish: move to end so older entries are evicted first.
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(parts: Array<string | null | undefined>, value: T): void {
  const key = buildKey(parts);
  store.set(key, { value: value as unknown, at: Date.now() });
  evictOldest();
}

export function cacheInvalidate(parts: Array<string | null | undefined>): void {
  store.delete(buildKey(parts));
}

export function cacheStats(): { size: number; ttl_ms: number } {
  return { size: store.size, ttl_ms: DEFAULT_TTL_MS };
}
