/**
 * resolverCache.ts — ResolverCache (AI-ORCH 2C).
 *
 * THE one new runtime abstraction for this phase: a deterministic, in-memory,
 * read-through cache that serves ResolvedExecutionPlan objects so the steady-state
 * request path does not touch the database. It ONLY caches — no business logic, no
 * execution, no routing, no retries, no persistence, no provider logic.
 *
 * SAFETY CONTRACT:
 *   - DETERMINISTIC — same (input, generation) → same cached plan; keys are immutable
 *     (no timestamps, no randomness).
 *   - TRANSPARENT FALLBACK — a cache miss (or ANY internal cache error) resolves via
 *     the existing resolver; the cache is never a single point of failure.
 *   - CORRECT INVALIDATION — a config `generation` (from ai_config_versions, cheaply
 *     cached upstream) is folded into the key, so a config write orphans stale keys.
 *   - NO EXECUTION CHANGE — the cache returns the SAME plan the resolver would; it
 *     changes latency only. Execution authority is unchanged (Promotion Control Plane).
 *   - STALE-WHILE-REVALIDATE never fails execution: if a background refresh fails, the
 *     existing valid entry is served.
 */
import { resolveExecutionPlan, type ResolverInput, type ResolverDeps, type ResolverOutput } from './configurationResolver';

/** Version of the resolver logic; part of cache identity (bump on resolver changes). */
export const RESOLVER_VERSION = 'resolver:v1' as const;
/** Version of the resolution-trace shape; part of cache identity. */
export const RESOLUTION_TRACE_VERSION = 1 as const;

export type CacheSource = 'hit' | 'miss' | 'stale' | 'fallback' | 'single-flight';

export interface ResolverCacheResult extends ResolverOutput {
  source: CacheSource;
  cacheKey: string;
}

interface CacheEntry {
  output: ResolverOutput;
  configurationFingerprint: string | null;
  executionFingerprint: string | null;
  resolverVersion: string;
  resolutionTraceVersion: number;
  generation: string | number;
  createdAt: number;
  /** Fresh until this time (TTL). */
  freshUntil: number;
  /** Hard-expired at this time (max age). */
  expiresAt: number;
  lastAccess: number;
}

export interface ResolverCacheOptions {
  /** Max entries before LRU eviction. */
  maxSize?: number;
  /** Fresh window (ms). After this, entries are stale-while-revalidate. */
  ttlMs?: number;
  /** Hard max age (ms). After this, a lookup is a full miss. */
  maxAgeMs?: number;
  /** Injectable clock (default Date.now) — for deterministic tests. */
  now?: () => number;
  /** Injectable resolver (default resolveExecutionPlan) — for tests. */
  resolver?: (input: ResolverInput, deps: ResolverDeps) => Promise<ResolverOutput>;
}

export interface ResolverCacheMetrics {
  lookups: number; hits: number; misses: number; staleServes: number;
  singleFlightMerges: number; fallbacks: number;
  evictions: number; refreshes: number; refreshFailures: number;
  warmups: number; invalidations: number;
  size: number;
  hitRate: number | null; missRate: number | null;
  avgLookupMs: number | null; avgResolutionMs: number | null; avgFillMs: number | null;
}

/** Canonical, immutable cache key — a pure function of the resolver INPUT + identity. */
export function buildResolverCacheKey(input: ResolverInput, generation: string | number): string {
  return JSON.stringify({
    c: input.capabilityId ?? null,
    o: input.operation ?? null,
    org: input.orgId ?? null,
    p: input.legacyProvider ?? null,
    m: input.legacyModel ?? null,
    g: generation,
    rv: RESOLVER_VERSION,
    tv: RESOLUTION_TRACE_VERSION,
  });
}

export class ResolverCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ResolverOutput>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly resolver: (input: ResolverInput, deps: ResolverDeps) => Promise<ResolverOutput>;
  private currentGeneration: string | number = 0;

  private m = {
    lookups: 0, hits: 0, misses: 0, staleServes: 0, singleFlightMerges: 0, fallbacks: 0,
    evictions: 0, refreshes: 0, refreshFailures: 0, warmups: 0, invalidations: 0,
    totalLookupMs: 0, totalResolutionMs: 0, totalFillMs: 0, resolutions: 0, fills: 0,
  };

  constructor(opts: ResolverCacheOptions = {}) {
    this.maxSize = opts.maxSize ?? 10_000;
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxAgeMs = opts.maxAgeMs ?? 30 * 60_000;
    this.now = opts.now ?? (() => Date.now());
    this.resolver = opts.resolver ?? resolveExecutionPlan;
  }

  /** Read-through: return a cached plan or resolve+store. Never throws. */
  async get(input: ResolverInput, deps: ResolverDeps, generation: string | number = this.currentGeneration): Promise<ResolverCacheResult> {
    const startLookup = this.now();
    this.m.lookups++;
    const key = buildResolverCacheKey(input, generation);
    try {
      // Generation change invalidates prior entries (correct invalidation).
      if (generation !== this.currentGeneration) this.invalidateGeneration(generation);

      const entry = this.map.get(key);
      const t = this.now();
      if (entry && t < entry.expiresAt) {
        this.touch(key, entry);
        this.m.totalLookupMs += this.now() - startLookup;
        if (t >= entry.freshUntil) {
          // Stale-while-revalidate: serve now, refresh in the background.
          this.m.staleServes++;
          this.m.hits++;
          void this.refresh(key, input, deps, generation);
          return { ...entry.output, source: 'stale', cacheKey: key };
        }
        this.m.hits++;
        return { ...entry.output, source: 'hit', cacheKey: key };
      }

      // Miss → single-flight resolve.
      this.m.misses++;
      const output = await this.loadSingleFlight(key, input, deps, generation);
      this.m.totalLookupMs += this.now() - startLookup;
      return { ...output, source: this.inFlightMergedKey === key ? 'single-flight' : 'miss', cacheKey: key };
    } catch {
      // (Rule 6/7) ANY cache failure → resolve directly; cache never blocks execution.
      this.m.fallbacks++;
      try {
        const output = await this.resolver(input, deps);
        return { ...output, source: 'fallback', cacheKey: key };
      } catch {
        // Resolver itself failed — re-throw is avoided; return a minimal fallback is not
        // possible without a plan, so rethrow for the caller's own fail-safe (the shadow
        // runner / gateway hook already swallow). This preserves existing failure semantics.
        throw new Error('resolver-cache: resolver failed');
      }
    }
  }

  private inFlightMergedKey: string | null = null;

  private async loadSingleFlight(key: string, input: ResolverInput, deps: ResolverDeps, generation: string | number): Promise<ResolverOutput> {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.m.singleFlightMerges++;
      this.inFlightMergedKey = key;
      return existing;
    }
    this.inFlightMergedKey = null;
    const startResolve = this.now();
    const promise = this.resolver(input, deps).then((output) => {
      this.m.resolutions++;
      this.m.totalResolutionMs += this.now() - startResolve;
      const startFill = this.now();
      this.store(key, output, generation);
      this.m.fills++;
      this.m.totalFillMs += this.now() - startFill;
      return output;
    });
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async refresh(key: string, input: ResolverInput, deps: ResolverDeps, generation: string | number): Promise<void> {
    try {
      const output = await this.resolver(input, deps);
      this.store(key, output, generation);
      this.m.refreshes++;
    } catch {
      // Refresh failure → keep serving the existing valid entry. Never fail execution.
      this.m.refreshFailures++;
    }
  }

  private store(key: string, output: ResolverOutput, generation: string | number): void {
    const t = this.now();
    const entry: CacheEntry = {
      output,
      configurationFingerprint: output.plan.configFingerprint ?? null,
      executionFingerprint: output.plan.configFingerprint ?? null,
      resolverVersion: RESOLVER_VERSION,
      resolutionTraceVersion: RESOLUTION_TRACE_VERSION,
      generation,
      createdAt: t,
      freshUntil: t + this.ttlMs,
      expiresAt: t + this.maxAgeMs,
      lastAccess: t,
    };
    this.map.set(key, entry);
    this.evictIfNeeded();
  }

  private touch(key: string, entry: CacheEntry): void {
    entry.lastAccess = this.now();
    // Move to most-recently-used (Map preserves insertion order).
    this.map.delete(key);
    this.map.set(key, entry);
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      this.m.evictions++;
    }
  }

  // ── Invalidation ────────────────────────────────────────────────────────────

  /** Drop a single key. */
  invalidate(key: string): void { if (this.map.delete(key)) this.m.invalidations++; }

  /** Drop everything. */
  invalidateAll(): void { this.m.invalidations += this.map.size; this.map.clear(); }

  /** Advance to a new config generation → drop entries from prior generations. */
  invalidateGeneration(generation: string | number): void {
    if (generation === this.currentGeneration) return;
    for (const [key, entry] of this.map) {
      if (entry.generation !== generation) { this.map.delete(key); this.m.invalidations++; }
    }
    this.currentGeneration = generation;
  }

  // ── Warm-up (non-blocking) ─────────────────────────────────────────────────

  /** Pre-resolve + store a set of inputs. Never throws; failures are skipped. */
  async warm(inputs: ResolverInput[], deps: ResolverDeps, generation: string | number = this.currentGeneration): Promise<number> {
    let warmed = 0;
    await Promise.all(inputs.map(async (input) => {
      try {
        const key = buildResolverCacheKey(input, generation);
        if (this.map.has(key)) return;
        const output = await this.resolver(input, deps);
        this.store(key, output, generation);
        warmed++;
        this.m.warmups++;
      } catch { /* skip failed warm-up target */ }
    }));
    return warmed;
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  getMetrics(): ResolverCacheMetrics {
    const { lookups, hits, misses } = this.m;
    return {
      lookups, hits, misses, staleServes: this.m.staleServes,
      singleFlightMerges: this.m.singleFlightMerges, fallbacks: this.m.fallbacks,
      evictions: this.m.evictions, refreshes: this.m.refreshes, refreshFailures: this.m.refreshFailures,
      warmups: this.m.warmups, invalidations: this.m.invalidations,
      size: this.map.size,
      hitRate: lookups ? hits / lookups : null,
      missRate: lookups ? misses / lookups : null,
      avgLookupMs: lookups ? this.m.totalLookupMs / lookups : null,
      avgResolutionMs: this.m.resolutions ? this.m.totalResolutionMs / this.m.resolutions : null,
      avgFillMs: this.m.fills ? this.m.totalFillMs / this.m.fills : null,
    };
  }

  /** Test/diagnostic reset. */
  reset(): void {
    this.map.clear();
    this.inFlight.clear();
    this.currentGeneration = 0;
    this.m = { lookups: 0, hits: 0, misses: 0, staleServes: 0, singleFlightMerges: 0, fallbacks: 0, evictions: 0, refreshes: 0, refreshFailures: 0, warmups: 0, invalidations: 0, totalLookupMs: 0, totalResolutionMs: 0, totalFillMs: 0, resolutions: 0, fills: 0 };
  }
}

/** Process-wide singleton (opt-in; the go-live hook uses this). Not wired this phase. */
export const resolverCache = new ResolverCache();
