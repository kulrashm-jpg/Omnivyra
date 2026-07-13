/**
 * knowledgeContextCache.ts — assembled-context cache (CKC-001 §6).
 *
 * REUSES the existing shared standalone Redis client (queue/standaloneRedisClient)
 * with an in-memory fallback — the same infrastructure redisExternalApiCache uses.
 * It introduces NO new cache subsystem. Assembled contexts are cached under a
 * per-company prefix so CKRE orchestration can invalidate them wholesale when
 * knowledge changes.
 */

import type IORedis from 'ioredis';
import {
  getInstrumentedStandaloneRedisClient,
  isSharedStandaloneRedisAvailable,
} from '../../queue/standaloneRedisClient';
import { logger } from '../logger';
import type { KnowledgeContext, KnowledgeContextRequest } from './knowledgeContextContracts';
import { selectorKey } from './knowledgeVersionSelector';

const PREFIX = 'virality:ckc:ctx';
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_IN_MEMORY = 500;

interface MemEntry { value: KnowledgeContext; expiresAt: number; }
const memCache = new Map<string, MemEntry>();

let client: IORedis | null = null;
function redis(): IORedis | null {
  if (client) return client;
  try { client = getInstrumentedStandaloneRedisClient('knowledge_context_cache'); return client; }
  catch { return null; }
}
function redisOk(): boolean { return isSharedStandaloneRedisAvailable() && redis() !== null; }

/** Stable non-crypto hash (djb2) → hex. Deterministic. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Deterministic cache key from the salient request fields. Company-prefixed for invalidation. */
export function contextCacheKey(req: KnowledgeContextRequest): string {
  const salient = {
    c: req.consumer,
    d: req.domains ? [...req.domains].sort() : null,
    f: req.fields ? Object.fromEntries(Object.entries(req.fields).map(([k, v]) => [k, [...(v ?? [])].sort()]).sort((a, b) => a[0] < b[0] ? -1 : 1)) : null,
    mc: req.minConfidence ?? null,
    ma: req.maxAgeMs ?? null,
    l: req.language ?? null,
    v: selectorKey(req.version),
    m: req.full ? 'full' : (req.mode ?? null),
  };
  return `${PREFIX}:${req.companyId}:${hash(JSON.stringify(salient))}`;
}

/** Read a cached context. Never throws. */
export async function getCachedContext(req: KnowledgeContextRequest): Promise<KnowledgeContext | null> {
  const key = contextCacheKey(req);
  if (redisOk()) {
    try {
      const raw = await redis()!.get(key);
      if (raw) return JSON.parse(raw) as KnowledgeContext;
      return null;
    } catch { /* fall through to memory */ }
  }
  const entry = memCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { memCache.delete(key); return null; }
  return entry.value;
}

/** Store an assembled context. Best-effort; never throws. */
export async function setCachedContext(req: KnowledgeContextRequest, value: KnowledgeContext, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  const key = contextCacheKey(req);
  if (redisOk()) {
    try { await redis()!.set(key, JSON.stringify(value), 'PX', ttlMs); return; }
    catch { /* fall through to memory */ }
  }
  if (memCache.size >= MAX_IN_MEMORY) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Invalidate every cached context for a company (called by CKRE orchestration on
 * knowledge change). Never throws. Returns the number of keys removed (best-effort).
 */
export async function invalidateContextCache(companyId: string): Promise<number> {
  if (!companyId) return 0;
  const pattern = `${PREFIX}:${companyId}:`;
  let removed = 0;
  // In-memory tier.
  for (const k of [...memCache.keys()]) { if (k.startsWith(pattern)) { memCache.delete(k); removed++; } }
  // Redis tier (scan to avoid blocking KEYS on large keyspaces).
  if (redisOk()) {
    try {
      const c = redis()!;
      let cursor = '0';
      do {
        const [next, keys] = await c.scan(cursor, 'MATCH', `${pattern}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) { await c.del(...keys); removed += keys.length; }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn('knowledge_context_cache_invalidate_failed', { companyId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return removed;
}

/** Test/shutdown helper — clears the in-memory tier. */
export function clearContextMemoryCache(): void { memCache.clear(); }
