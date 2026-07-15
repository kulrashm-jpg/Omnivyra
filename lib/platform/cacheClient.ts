/**
 * F-12 — Cache SDK, full rollout surface (Foundation Batch D).
 *
 * Storage-backed companion to cacheCore (F-05): one client per registered
 * namespace with get / set / getOrLoad / invalidate over the canonical
 * standalone Redis (F-06), composing every F-05 guarantee:
 *   - tenant isolation by KEY CONSTRUCTION (requireTenant namespaces refuse
 *     untenanted keys → callers fall through to the uncached path),
 *   - versioned keys (bump = global invalidation), gzip over the threshold,
 *   - kill switches (global + per-namespace) checked per call,
 *   - hit/miss/invalidation metrics via the HARDEN-001 recorders,
 *   - request-scoped single-flight through memoRequest so one request never
 *     loads the same key twice (coalescing is per-request; cross-request
 *     concurrency is absorbed by the Redis tier after the first set).
 *
 * FAIL-OPEN EVERYWHERE: Redis absent/slow/unreachable → loader runs directly
 * (a cache can degrade performance, never correctness). No SWR-stale serving
 * in this batch — entries are fresh-or-miss (simplest correct semantics; the
 * TTL registry is where freshness policy lives).
 */
import {
  type CacheNamespace,
  buildCacheKey,
  isCacheNamespaceEnabled,
  noteCacheHit,
  noteCacheMiss,
  announceCacheInvalidation,
  compressIfLarge,
  decompressIfNeeded,
} from './cacheCore';
import { memoRequest } from '../../backend/services/requestScopedMemo';

export interface CacheClient {
  readonly ns: CacheNamespace;
  get<T>(input: { tenantId?: string | null; parts: Array<string | number | boolean> }): Promise<T | null>;
  set<T>(input: { tenantId?: string | null; parts: Array<string | number | boolean>; value: T; ttlSeconds?: number }): Promise<boolean>;
  /** get → miss? run loader → set (fire-and-forget) → return. Request-memoized. */
  getOrLoad<T>(input: {
    tenantId?: string | null;
    parts: Array<string | number | boolean>;
    ttlSeconds?: number;
    load: () => Promise<T>;
  }): Promise<T>;
  invalidate(input: { tenantId?: string | null; parts: Array<string | number | boolean>; reason?: string }): Promise<void>;
}

async function redis() {
  const { getStandaloneRedis } = await import('../redis/canonicalClient');
  return getStandaloneRedis('platform_cache');
}

export function createCache(ns: CacheNamespace): CacheClient {
  const key = (input: { tenantId?: string | null; parts: Array<string | number | boolean> }): string | null => {
    if (!isCacheNamespaceEnabled(ns)) return null;
    return buildCacheKey(ns, input);
  };

  const client: CacheClient = {
    ns,
    async get<T>(input: { tenantId?: string | null; parts: Array<string | number | boolean> }): Promise<T | null> {
      const k = key(input);
      if (!k) return null;
      try {
        const raw = await (await redis()).get(k);
        if (raw === null) { noteCacheMiss(ns); return null; }
        noteCacheHit(ns);
        return JSON.parse(await decompressIfNeeded(raw)) as T;
      } catch {
        noteCacheMiss(ns);
        return null;
      }
    },

    async set<T>(input: { tenantId?: string | null; parts: Array<string | number | boolean>; value: T; ttlSeconds?: number }): Promise<boolean> {
      const k = key(input);
      if (!k) return false;
      try {
        const body = await compressIfLarge(JSON.stringify(input.value));
        await (await redis()).set(k, body, 'EX', Math.max(1, input.ttlSeconds ?? ns.defaultTtlSeconds));
        return true;
      } catch {
        return false;
      }
    },

    async getOrLoad<T>(input: {
      tenantId?: string | null;
      parts: Array<string | number | boolean>;
      ttlSeconds?: number;
      load: () => Promise<T>;
    }): Promise<T> {
      const k = key(input);
      if (!k) return input.load(); // no key (kill/tenant-refusal) → uncached
      // memoRequest: same-REQUEST re-reads of a key share one promise.
      // (Certification-corrected: coalescing is request-scoped, not
      // process-wide — concurrent loads from DIFFERENT requests each run the
      // loader on a cold key; the Redis set makes later ones hits.)
      return memoRequest(`cache:${k}`, async () => {
        const hit = await client.get<T>(input);
        if (hit !== null) return hit;
        const value = await input.load();
        if (value !== undefined && value !== null) {
          void client.set({ ...input, value }).catch(() => {});
        }
        return value;
      });
    },

    async invalidate(input: { tenantId?: string | null; parts: Array<string | number | boolean>; reason?: string }): Promise<void> {
      // Invalidation ignores kill switches — deleting must always work.
      const k = buildCacheKey(ns, input);
      if (!k) return;
      try {
        await (await redis()).del(k);
        announceCacheInvalidation(ns, input.reason ?? 'explicit', 1);
      } catch { /* fail-open */ }
    },
  };
  return client;
}
