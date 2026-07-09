/**
 * HARDEN-001 — Database instrumentation.
 *
 * A transparent, FAIL-SAFE timing wrapper around Supabase/PostgREST query
 * builders. It measures query duration + rows returned + slow queries WITHOUT
 * changing any query, filter, ordering, or result. If anything about the proxy
 * misbehaves it silently returns the raw builder, so DB behavior is unchanged.
 *
 * Wired into the central ownedDbTable() accessor. Direct `supabase.from(...)`
 * callers can opt in via observeTable() or the timedQuery() helper.
 */
import { recordDb } from './metrics';
import { observabilityConfig, domainEnabled } from './config';

type AnyBuilder = Record<string, unknown> & { then?: unknown };

const VERB_OPS = new Set(['select', 'insert', 'update', 'delete', 'upsert']);

function rowCount(result: unknown): number | undefined {
  try {
    const r = result as { data?: unknown; count?: number | null } | null;
    if (!r) return undefined;
    if (typeof r.count === 'number') return r.count;
    if (Array.isArray(r.data)) return r.data.length;
    if (r.data && typeof r.data === 'object') return 1;
    return 0;
  } catch {
    return undefined;
  }
}

/** Wrap a builder in a proxy that times the terminal `.then`. */
function wrap(builder: AnyBuilder, table: string, state: { op: string; timed: boolean }): AnyBuilder {
  try {
    return new Proxy(builder, {
      get(target, prop, receiver) {
        // Terminal await: time from here to resolution, record once.
        if (prop === 'then' && typeof (target as AnyBuilder).then === 'function') {
          if (state.timed) return Reflect.get(target, prop, receiver);
          state.timed = true;
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            const t0 = performance.now();
            const record = (result: unknown, error: boolean) => {
              try {
                recordDb({ table, op: state.op, durationMs: performance.now() - t0, rows: rowCount(result), error });
              } catch { /* fail-safe */ }
            };
            return (target as { then: (f: unknown, r?: unknown) => unknown }).then(
              (result: unknown) => {
                // PostgREST resolves with { data, error } even on query errors.
                const hasErr = !!(result && typeof result === 'object' && (result as { error?: unknown }).error);
                record(result, hasErr);
                return onFulfilled ? onFulfilled(result) : result;
              },
              (err: unknown) => {
                record(undefined, true);
                if (onRejected) return onRejected(err);
                throw err;
              },
            );
          };
        }

        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            if (typeof prop === 'string' && VERB_OPS.has(prop)) state.op = prop;
            const out = (value as (...a: unknown[]) => unknown).apply(target, args);
            // Chainable builders return an object/thenable — keep proxying.
            if (out && typeof out === 'object') return wrap(out as AnyBuilder, table, state);
            return out;
          };
        }
        return value;
      },
    });
  } catch {
    return builder;
  }
}

/**
 * Wrap a `supabase.from(table)` builder with timing (sampled + fail-safe).
 * TYPE-TRANSPARENT: the return type is exactly the input builder's type, so
 * callers (e.g. ownedDbTable) keep the full PostgREST builder surface unchanged.
 */
export function observeTable<T>(table: string, builder: T): T {
  try {
    if (!domainEnabled('db')) return builder;
    if (observabilityConfig.dbSampleRate < 1 && Math.random() > observabilityConfig.dbSampleRate) return builder;
    return wrap(builder as unknown as AnyBuilder, table, { op: 'select', timed: false }) as unknown as T;
  } catch {
    return builder;
  }
}

/** Time an already-built query/promise under an explicit label. Fail-safe. */
export async function timedQuery<T>(table: string, op: string, promise: Promise<T>): Promise<T> {
  if (!domainEnabled('db')) return promise;
  const t0 = performance.now();
  try {
    const result = await promise;
    try {
      const hasErr = !!(result && typeof result === 'object' && (result as { error?: unknown }).error);
      recordDb({ table, op, durationMs: performance.now() - t0, rows: rowCount(result), error: hasErr });
    } catch { /* fail-safe */ }
    return result;
  } catch (err) {
    try { recordDb({ table, op, durationMs: performance.now() - t0, error: true }); } catch { /* fail-safe */ }
    throw err;
  }
}
