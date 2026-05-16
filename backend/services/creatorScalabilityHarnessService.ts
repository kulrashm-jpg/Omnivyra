/**
 * Creator Scalability + Disaster Recovery Harness
 *
 * Bounded primitives the operational layer composes:
 *   - bounded paginate (page size + max pages, hard cap)
 *   - throttled storage listing (rate-aware traversal)
 *   - queue-pressure backoff (defer work when queue depth high)
 *   - operational metric cache (60s TTL, in-memory)
 *   - idempotent recovery helpers (replay-safe wrappers)
 *
 * Keep this file pure: no DB writes, no telemetry calls beyond the bare
 * minimum. Anything that mutates state belongs in a domain service that
 * uses these utilities. This separation lets the harness be re-used by
 * other surfaces (analytics ingestion, etc.) without dragging in the
 * creator-specific dependencies.
 */

import { getQueue } from '../queue/bullmqClient';
import { logger } from './logger';

// ──────────────────────────────────────────────────────────────────────
// Bounded paginate
// ──────────────────────────────────────────────────────────────────────

export type PaginateOptions = {
  pageSize: number;
  maxPages: number;
  hardCap?: number;
  throttleMs?: number;
};

export async function boundedPaginate<TRow, TAcc>(
  fetcher: (offset: number, pageSize: number) => Promise<TRow[]>,
  reducer: (acc: TAcc, row: TRow) => TAcc | Promise<TAcc>,
  initial: TAcc,
  options: PaginateOptions,
): Promise<{ acc: TAcc; pages: number; rows: number; truncated: boolean }> {
  const pageSize = Math.max(1, Math.min(options.pageSize, 5000));
  const maxPages = Math.max(1, Math.min(options.maxPages, 200));
  const hardCap = options.hardCap ?? maxPages * pageSize;
  let acc = initial;
  let pages = 0;
  let rows = 0;
  let truncated = false;

  for (let p = 0; p < maxPages; p++) {
    if (rows >= hardCap) { truncated = true; break; }
    let batch: TRow[];
    try {
      batch = await fetcher(p * pageSize, pageSize);
    } catch (err) {
      logger.warn('creatorScalabilityHarness.fetcher_failed', {
        surface: 'creatorScalabilityHarness',
        page: p,
        error: (err as Error)?.message ?? String(err),
      });
      break;
    }
    if (!batch || batch.length === 0) break;
    pages++;
    for (const row of batch) {
      acc = await Promise.resolve(reducer(acc, row));
      rows++;
      if (rows >= hardCap) { truncated = true; break; }
    }
    if (batch.length < pageSize) break;
    if (options.throttleMs && options.throttleMs > 0) {
      await sleep(options.throttleMs);
    }
  }

  return { acc, pages, rows, truncated };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

// ──────────────────────────────────────────────────────────────────────
// Queue-pressure backoff
// ──────────────────────────────────────────────────────────────────────

const HIGH_PRESSURE_THRESHOLD = 500;   // waiting jobs above this = "high"
const VERY_HIGH_THRESHOLD = 2000;      // above this = "very high"

export async function getQueuePressure(): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  pressure: 'normal' | 'high' | 'very_high';
}> {
  try {
    const queue = getQueue();
    const [waiting, active, delayed] = await Promise.all([
      queue.getWaitingCount?.() ?? Promise.resolve(0),
      queue.getActiveCount?.() ?? Promise.resolve(0),
      queue.getDelayedCount?.() ?? Promise.resolve(0),
    ]);
    let pressure: 'normal' | 'high' | 'very_high' = 'normal';
    if (waiting >= VERY_HIGH_THRESHOLD) pressure = 'very_high';
    else if (waiting >= HIGH_PRESSURE_THRESHOLD) pressure = 'high';
    return { waiting, active, delayed, pressure };
  } catch {
    return { waiting: 0, active: 0, delayed: 0, pressure: 'normal' };
  }
}

/** Returns a delay multiplier the caller should apply when queue pressure is high. */
export function backoffMultiplierFor(pressure: 'normal' | 'high' | 'very_high'): number {
  if (pressure === 'very_high') return 4;
  if (pressure === 'high') return 2;
  return 1;
}

// ──────────────────────────────────────────────────────────────────────
// In-memory operational metric cache
// ──────────────────────────────────────────────────────────────────────

const _cache = new Map<string, { value: unknown; expiresAt: number }>();
const DEFAULT_TTL_MS = 60_000;

export function cacheGet<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  _cache.set(key, { value, expiresAt: Date.now() + (ttlMs ?? DEFAULT_TTL_MS) });
}

export function cacheClear(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

/** Wrap an async loader with simple TTL caching. */
export async function withCache<T>(key: string, ttlMs: number | undefined, loader: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

// ──────────────────────────────────────────────────────────────────────
// Idempotent recovery wrappers
// ──────────────────────────────────────────────────────────────────────

/**
 * Run an action only if `key` hasn't been recorded in the past `ttlMs`.
 * Used by replay-safe workflows where an event might be delivered twice
 * (e.g. a retried webhook or a duplicate queue tick).
 *
 * Lightweight in-process dedup — does NOT survive process restart. For
 * cross-process dedup, the caller should layer a DB / Redis token check
 * in addition to this helper.
 */
const _idempotencyCache = new Map<string, number>();

export async function runIdempotent<T>(key: string, ttlMs: number, action: () => Promise<T>): Promise<{ executed: boolean; value?: T }> {
  const now = Date.now();
  const existing = _idempotencyCache.get(key);
  if (existing && existing > now) {
    return { executed: false };
  }
  _idempotencyCache.set(key, now + ttlMs);
  // Best-effort eviction on size bound
  if (_idempotencyCache.size > 5000) {
    const cutoff = now;
    for (const [k, exp] of Array.from(_idempotencyCache.entries())) {
      if (exp < cutoff) _idempotencyCache.delete(k);
    }
  }
  const value = await action();
  return { executed: true, value };
}

/** TEST ONLY. */
export function __resetCreatorScalabilityHarnessForTests(): void {
  _cache.clear();
  _idempotencyCache.clear();
}
