/**
 * F-05 — Cache SDK, foundation core (Foundation Batch B).
 *
 * The canonical building blocks every cache in the platform composes from.
 * This ships the FOUNDATION ONLY — key construction, namespace registry,
 * TTLs, kill switches, metrics/compression/invalidation hooks. It migrates
 * no existing cache and enables no new caching; Wave 4 adopts it cache by
 * cache. The first consumer is W1-1 (tenant-scoping the AI semantic index).
 *
 * DESIGN RULES (encode the B-04 incident structurally):
 *   1. Tenant scoping is part of the KEY, not a convention callers remember.
 *      A namespace registered with `requireTenant: true` REFUSES to build a
 *      key without a tenant (returns null → caller must skip caching). Shared
 *      caching is only possible by explicitly registering a namespace with
 *      `requireTenant: false`.
 *   2. Every namespace has a kill switch (global CACHE_KILL_ALL + per-
 *      namespace CACHE_KILL_<NAMESPACE>) checked at call time.
 *   3. Key shape is stable and versioned: bumping `version` orphans all old
 *      entries (they expire via TTL) — the sanctioned invalidate-everything
 *      mechanism, promoted from aiResponseCache's cacheVersion pattern.
 *
 * Key shape: `<prefix>:v<version>:t.<tenant>:<part>:<part>…`
 *   - tenant segment is `t.<sanitized-id>` or `t.global` (only when the
 *     namespace explicitly allows untenanted use)
 *   - long/unsafe parts are sha256-hashed to keep keys bounded and colon-free
 *
 * Promoted patterns: tenant-scoped keys (knowledgeContextCache), versioned
 * keys + gzip threshold (aiResponseCache), env kill conventions (rollout kit).
 */
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { recordCache, recordCacheInvalidation, recordRawCounter } from '../../backend/observability';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ── Namespace registry (TTL registry foundation) ─────────────────────────────

export interface CacheNamespaceDef {
  /** Key prefix, e.g. 'omnivyra:ai_sem'. Also the registry identity. */
  prefix: string;
  description: string;
  /** Bump to orphan every existing entry (old keys expire via TTL). */
  version: number;
  /** Default TTL for entries; per-call overrides allowed. */
  defaultTtlSeconds: number;
  /**
   * true → keys CANNOT be built without a tenant id (isolation guarantee).
   * false → namespace is explicitly shared; keys use the 'global' segment
   * when no tenant is supplied.
   */
  requireTenant: boolean;
}

export interface CacheNamespace extends CacheNamespaceDef {
  /** SCREAMING_SNAKE name used in the per-namespace kill env var. */
  killEnvSuffix: string;
}

const namespaces = new Map<string, CacheNamespace>();

export function registerCacheNamespace(def: CacheNamespaceDef): CacheNamespace {
  const killEnvSuffix = def.prefix.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ns: CacheNamespace = { ...def, killEnvSuffix };
  namespaces.set(def.prefix, ns);
  return ns;
}

export function getCacheNamespace(prefix: string): CacheNamespace | undefined {
  return namespaces.get(prefix);
}

export function listCacheNamespaces(): CacheNamespace[] {
  return Array.from(namespaces.values());
}

// ── Kill switches ─────────────────────────────────────────────────────────────

function truthyEnv(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/**
 * Whether the namespace is currently allowed to serve/store. Checked at call
 * time so operators can disable a misbehaving cache live. Fail-safe: any
 * error reads as DISABLED (callers fall through to the uncached path).
 */
export function isCacheNamespaceEnabled(ns: CacheNamespace): boolean {
  try {
    if (truthyEnv('CACHE_KILL_ALL')) return false;
    if (truthyEnv(`CACHE_KILL_${ns.killEnvSuffix}`)) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Key construction ──────────────────────────────────────────────────────────

/** Sanitize one key part: safe charset, bounded length (hash overflow). */
function sanitizePart(part: string | number | boolean): string {
  const s = String(part);
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (cleaned.length <= 64 && cleaned === s) return cleaned;
  // Anything long or lossy-sanitized gets a stable hash suffix so two
  // different raw values can never collide after sanitization.
  const hash = createHash('sha256').update(s).digest('hex').slice(0, 16);
  return `${cleaned.slice(0, 40)}.${hash}`;
}

export const GLOBAL_TENANT_SEGMENT = 'global';

export interface BuildKeyInput {
  /** Tenant identity (company/org id). Required when ns.requireTenant. */
  tenantId?: string | null;
  /** Ordered discriminator parts (operation name, hash, etc.). */
  parts: Array<string | number | boolean>;
}

/**
 * Build a canonical cache key, or return null when the namespace requires a
 * tenant and none is available — the caller MUST treat null as "do not cache".
 */
export function buildCacheKey(ns: CacheNamespace, input: BuildKeyInput): string | null {
  try {
    const tenant = input.tenantId && String(input.tenantId).trim()
      ? sanitizePart(String(input.tenantId).trim())
      : null;
    if (!tenant && ns.requireTenant) {
      try {
        recordRawCounter('cache.key_refused_no_tenant', 1, { namespace: ns.prefix });
      } catch { /* fail-safe */ }
      return null;
    }
    const segments = [
      ns.prefix,
      `v${ns.version}`,
      `t.${tenant ?? GLOBAL_TENANT_SEGMENT}`,
      ...input.parts.map(sanitizePart),
    ];
    return segments.join(':');
  } catch {
    return null;
  }
}

/**
 * True iff `key` belongs to `ns` AND to the given tenant — the read-side
 * isolation assertion (defense in depth for indexes that store keys).
 */
export function keyBelongsToTenant(
  ns: CacheNamespace,
  key: string,
  tenantId: string | null | undefined,
): boolean {
  try {
    const tenant = tenantId && String(tenantId).trim()
      ? sanitizePart(String(tenantId).trim())
      : GLOBAL_TENANT_SEGMENT;
    return key.startsWith(`${ns.prefix}:v${ns.version}:t.${tenant}:`);
  } catch {
    return false;
  }
}

// ── Metrics hooks (thin wrappers over HARDEN-001 recorders) ───────────────────

export function noteCacheHit(ns: CacheNamespace): void {
  try { recordCache({ cache: ns.prefix, hit: true }); } catch { /* fail-safe */ }
}
export function noteCacheMiss(ns: CacheNamespace): void {
  try { recordCache({ cache: ns.prefix, hit: false }); } catch { /* fail-safe */ }
}
export function noteCacheInvalidation(ns: CacheNamespace, count = 1): void {
  try { recordCacheInvalidation(ns.prefix, count); } catch { /* fail-safe */ }
}
/**
 * PERMANENT isolation assertion (Gate B): incremented iff a cache read would
 * have crossed tenants. Any nonzero reading is a rollback trigger for the
 * owning cache. Wired by consumers at their read sites.
 */
export function noteCacheIsolationViolation(ns: CacheNamespace): void {
  try { recordRawCounter('cache.isolation_violation', 1, { namespace: ns.prefix }); } catch { /* fail-safe */ }
}

// ── Compression hooks (promoted from aiResponseCache RISK-2) ─────────────────

export const CACHE_COMPRESS_THRESHOLD_BYTES = 1024;
const COMPRESS_PREFIX = '\x1fgzip:';

export async function compressIfLarge(value: string): Promise<string> {
  if (value.length < CACHE_COMPRESS_THRESHOLD_BYTES) return value;
  try {
    const compressed = await gzipAsync(Buffer.from(value, 'utf8'));
    return COMPRESS_PREFIX + compressed.toString('base64');
  } catch {
    return value;
  }
}

export async function decompressIfNeeded(value: string): Promise<string> {
  if (!value.startsWith(COMPRESS_PREFIX)) return value;
  try {
    const buf = await gunzipAsync(Buffer.from(value.slice(COMPRESS_PREFIX.length), 'base64'));
    return buf.toString('utf8');
  } catch {
    return value;
  }
}

// ── Invalidation hooks ────────────────────────────────────────────────────────

type InvalidationListener = (info: { namespace: string; reason: string }) => void;
const invalidationListeners: InvalidationListener[] = [];

/** Register an observer for namespace invalidations (indexes, hot tiers…). */
export function onCacheInvalidation(listener: InvalidationListener): void {
  invalidationListeners.push(listener);
}

/** Announce an invalidation to listeners + metrics (storage deletion is the caller's job). */
export function announceCacheInvalidation(ns: CacheNamespace, reason: string, count = 1): void {
  noteCacheInvalidation(ns, count);
  for (const listener of invalidationListeners) {
    try { listener({ namespace: ns.prefix, reason }); } catch { /* fail-safe */ }
  }
}
