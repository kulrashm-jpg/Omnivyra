/**
 * WS-4 Phase-2 — enrichment cache and ledger.
 *
 * "Cache everything. Never enrich twice." These are metered APIs; a repeated
 * call is money, not just latency. The cache key is
 * `(provider, capability, identity)` because the same company enriched for
 * `technology` and for `funding` are two different purchases from the same
 * vendor, and collapsing them would serve one capability's answer for the
 * other.
 *
 * ─── THE STORE IS A PORT, AND THE DEFAULT IS HONEST ────────────────────────
 * The default store is in-process. On serverless that means it survives a warm
 * invocation and no longer — so it prevents the repeated-call-within-a-request
 * and warm-instance cases, and NOT the cold-start case. That is a real limit,
 * stated here rather than discovered from a bill. Durable caching needs a table
 * and therefore a migration, which is a deliberate decision for an operator to
 * take, not a side effect of this workstream.
 *
 * ─── THE LEDGER IS THE AUDIT, NOT THE CACHE ────────────────────────────────
 * The cache answers "do we need to call". The ledger answers "what did we
 * spend, with whom, and when" — a different question that survives a cache
 * eviction. They are separate on purpose.
 */

import type { EnrichmentCapability, ProviderResult } from './contract';

export interface CacheEntry {
  result: ProviderResult;
  /** When this was stored — injected, never read from a clock here. */
  storedAt: string;
  expiresAt: string;
}

export interface EnrichmentCacheStore {
  get(key: string): CacheEntry | null;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

/** One recorded enrichment call. Append-only by convention. */
export interface LedgerEntry {
  companyId: string;
  provider: string;
  capability: EnrichmentCapability;
  state: ProviderResult['state'];
  reason: string | null;
  costUnits: number;
  at: string;
  servedFromCache: boolean;
}

/**
 * Cache key. Identity is the domain when known, and the company id otherwise —
 * vendors key on domain, so two tenants researching the same prospect should
 * share a cached answer rather than buy it twice.
 */
export function cacheKey(provider: string, capability: EnrichmentCapability, identity: string): string {
  return `${provider}::${capability}::${identity.trim().toLowerCase()}`;
}

/** Default in-process store. See the header for exactly what this does not survive. */
export function createMemoryStore(): EnrichmentCacheStore {
  const map = new Map<string, CacheEntry>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, e) => { map.set(k, e); },
    delete: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    size: () => map.size,
  };
}

const defaultStore = createMemoryStore();
const ledger: LedgerEntry[] = [];

export interface CachedFetchOptions {
  store?: EnrichmentCacheStore;
  /** Per-provider freshness. Firmographics move slowly; hiring does not. */
  ttlSeconds: number;
  /** Injected instant. */
  now: string;
}

/**
 * Run `fetcher` unless a live cache entry already answers.
 *
 * An `unavailable` result IS cached, deliberately, but callers should give it a
 * short TTL: a vendor that has no coverage for a company will still have none
 * five minutes later, and re-asking is a purchase. Caching it forever would be
 * wrong for the opposite reason — coverage does improve.
 */
export async function cachedFetch(
  companyId: string,
  provider: string,
  capability: EnrichmentCapability,
  identity: string,
  fetcher: () => Promise<ProviderResult>,
  options: CachedFetchOptions,
): Promise<{ result: ProviderResult; servedFromCache: boolean }> {
  const store = options.store ?? defaultStore;
  const key = cacheKey(provider, capability, identity);
  const nowMs = Date.parse(options.now);

  const hit = store.get(key);
  if (hit && Number.isFinite(nowMs) && Date.parse(hit.expiresAt) > nowMs) {
    record({
      companyId, provider, capability,
      state: hit.result.state,
      reason: hit.result.reasonUnavailable,
      costUnits: 0,
      at: options.now,
      servedFromCache: true,
    });
    return { result: hit.result, servedFromCache: true };
  }

  const result = await fetcher();
  const expiresAt = Number.isFinite(nowMs)
    ? new Date(nowMs + options.ttlSeconds * 1000).toISOString()
    : options.now;

  store.set(key, { result, storedAt: options.now, expiresAt });
  record({
    companyId, provider, capability,
    state: result.state,
    reason: result.reasonUnavailable,
    costUnits: result.costUnits,
    at: options.now,
    servedFromCache: false,
  });
  return { result, servedFromCache: false };
}

function record(entry: LedgerEntry): void {
  ledger.push(entry);
  // Bounded: the ledger is an operational aid, not the system of record. An
  // unbounded array in a long-lived worker is a leak.
  if (ledger.length > 5_000) ledger.splice(0, ledger.length - 5_000);
}

/** Read the ledger, newest last. Optionally scoped to one company. */
export function readLedger(companyId?: string): LedgerEntry[] {
  return companyId ? ledger.filter((e) => e.companyId === companyId) : [...ledger];
}

/** Spend summary per provider — what an operator checks before widening rollout. */
export function costSummary(): Array<{ provider: string; calls: number; cached: number; costUnits: number }> {
  const by = new Map<string, { provider: string; calls: number; cached: number; costUnits: number }>();
  for (const e of ledger) {
    const row = by.get(e.provider) ?? { provider: e.provider, calls: 0, cached: 0, costUnits: 0 };
    if (e.servedFromCache) row.cached += 1; else row.calls += 1;
    row.costUnits += e.costUnits;
    by.set(e.provider, row);
  }
  return [...by.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

export function __resetLedgerForTests(): void {
  ledger.length = 0;
  defaultStore.clear();
}
