/**
 * Lightweight in-process TTL cache.
 *
 * Used for *read-heavy diagnostic endpoints only* — never for write paths,
 * never for security-sensitive data. Keys must be tenant-scoped (callers
 * are expected to prefix with companyId). Defaults: 60s TTL, 500-entry cap
 * (LRU eviction by oldest insertion order, not strict LRU touch tracking —
 * we want zero behavioral surprises, not optimum hit-rate).
 *
 * Why in-process and not Redis: this is a polish optimization for repeat
 * dashboard refreshes within the same request lifetime, not a hot-path
 * shared cache. Stateless deploys lose the cache on cold starts (intended);
 * data is always re-derivable from the source of truth.
 */
type Entry<T> = { value: T; expiresAt: number };

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 500;

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  if (store.size >= MAX_ENTRIES) {
    // Drop the oldest insertion (Map preserves insertion order).
    const firstKey = store.keys().next().value;
    if (typeof firstKey === 'string') store.delete(firstKey);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function cached<T>(key: string, ttlMs: number, build: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await build();
  cacheSet(key, value, ttlMs);
  return value;
}

/** Invalidate by exact key or by prefix (e.g. `bust('blog-analytics:companyId:')`). */
export function bust(keyOrPrefix: string): number {
  let n = 0;
  if (store.has(keyOrPrefix)) { store.delete(keyOrPrefix); n += 1; }
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(keyOrPrefix)) { store.delete(k); n += 1; }
  }
  return n;
}

/** Diagnostics — used by /api/admin observability if needed; never user-facing. */
export function cacheStats() {
  return { size: store.size, capacity: MAX_ENTRIES, defaultTtlMs: DEFAULT_TTL_MS };
}
