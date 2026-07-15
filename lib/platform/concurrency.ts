/**
 * F-08 — Bounded Concurrency Kit (Foundation Batch C).
 *
 * The canonical concurrency primitives, PROMOTED from proven in-repo code:
 *   - `mapWithConcurrency` is the HARDEN-004 implementation moved verbatim
 *     from backend/scheduler/schedulerBatching.ts (which now re-exports it —
 *     one implementation, zero call-site changes).
 *   - Named pools generalize the `withHeavyJobSlot` semaphore pattern from
 *     bullmqClient (FIFO, bounded, held only for the passed function).
 *
 * BATCH C CONTRACT: infrastructure only. No workload is migrated and no
 * concurrency is increased here — Wave 3 raises caps THROUGH this kit
 * (env-driven, rampable) instead of editing hardcoded constants.
 *
 * Pool limits resolve per-acquire: env override (`<ENV>` from the pool def)
 * → default. Live-tunable without redeploy where env can change (worker
 * restarts on Railway read fresh env; a later admin-config source can slot in
 * behind resolveLimit without changing callers).
 */
import { recordRawCounter, recordRawHistogram } from '../../backend/observability';
import { registry } from '../../backend/observability/registry';

export interface ConcurrentResult<R> {
  ok: boolean;
  value?: R;
  error?: Error;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results come back in
 * INPUT ORDER (deterministic aggregation regardless of completion order), and
 * each item's failure is captured in its slot rather than rejecting the whole
 * batch — identical semantics to a sequential `for..of` with per-item
 * try/catch, just faster. (Verbatim HARDEN-004 semantics.)
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<ConcurrentResult<R>[]> {
  const results: ConcurrentResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function runner(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        const value = await fn(items[index], index);
        results[index] = { ok: true, value };
      } catch (err) {
        results[index] = { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runner()));
  return results;
}

// ── Named pools ───────────────────────────────────────────────────────────────

export interface PoolDef {
  /** Stable pool name — also the metrics label. */
  name: string;
  /** Cap when the env override is unset/invalid. */
  defaultLimit: number;
  /** Env var carrying the live override; defaults to CONCURRENCY_<NAME>. */
  envVar?: string;
  /** Hard bounds on the env override (guards against typos like 1000). */
  minLimit?: number;
  maxLimit?: number;
}

export interface ConcurrencyPool {
  readonly name: string;
  /** Effective limit right now (env-resolved). */
  limit(): number;
  /** Acquire a slot, run `fn`, always release. FIFO fairness. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** mapWithConcurrency bound to this pool's live limit. */
  map<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<ConcurrentResult<R>[]>;
  /** Diagnostics snapshot. */
  stats(): { inFlight: number; queued: number; limit: number };
}

const pools = new Map<string, ConcurrencyPool>();

export function definePool(def: PoolDef): ConcurrencyPool {
  const existing = pools.get(def.name);
  if (existing) return existing;

  const envVar = def.envVar ?? `CONCURRENCY_${def.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const min = def.minLimit ?? 1;
  const max = def.maxLimit ?? 64;

  const resolveLimit = (): number => {
    const raw = Number(process.env[envVar]);
    if (Number.isInteger(raw) && raw >= min && raw <= max) return raw;
    return def.defaultLimit;
  };

  let inFlight = 0;
  const waiters: Array<() => void> = [];

  const release = (): void => {
    inFlight--;
    const wake = waiters.shift();
    if (wake) wake();
    try { registry.gauge('concurrency.pool.in_flight', inFlight, { pool: def.name }); } catch { /* fail-safe */ }
  };

  const acquire = async (): Promise<void> => {
    const startedAt = Date.now();
    // CERT-FIX (§14.4): true FIFO. A woken waiter that still finds the pool
    // full (a fresh acquire raced it, or the limit shrank) re-parks at the
    // HEAD of the queue instead of the tail, so it keeps its position and
    // cannot be starved by later arrivals.
    let wokenBefore = false;
    while (inFlight >= resolveLimit()) {
      await new Promise<void>((resolve) => {
        if (wokenBefore) waiters.unshift(resolve);
        else waiters.push(resolve);
      });
      wokenBefore = true;
    }
    inFlight++;
    try {
      registry.gauge('concurrency.pool.in_flight', inFlight, { pool: def.name });
      registry.gauge('concurrency.pool.queued', waiters.length, { pool: def.name });
      const waitedMs = Date.now() - startedAt;
      if (waitedMs > 0) recordRawHistogram('concurrency.pool.wait_ms', waitedMs, { pool: def.name });
      recordRawCounter('concurrency.pool.acquired', 1, { pool: def.name });
    } catch { /* fail-safe */ }
  };

  const pool: ConcurrencyPool = {
    name: def.name,
    limit: resolveLimit,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    map<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>) {
      return mapWithConcurrency(items, resolveLimit(), fn);
    },
    stats() {
      return { inFlight, queued: waiters.length, limit: resolveLimit() };
    },
  };
  pools.set(def.name, pool);
  return pool;
}

export function listPools(): Array<{ name: string; stats: ReturnType<ConcurrencyPool['stats']> }> {
  return Array.from(pools.values()).map((p) => ({ name: p.name, stats: p.stats() }));
}
