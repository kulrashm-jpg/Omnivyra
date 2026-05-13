/**
 * singleFlightRefresh — guarantees that at most one auth-relevant refresh
 * operation is in flight globally at any time.
 *
 * Why this exists
 * ───────────────
 * Multiple components (CompanyContext, AppHeader, AuthErrorBanner retry
 * button, MFA challenge UI, …) can each trigger a profile/session
 * refresh independently. Pre-Phase-2.B, concurrent refreshes would race:
 *
 *   - Both fetch `/api/company-profile?mode=list`.
 *   - Both observe transient failures and call signOut().
 *   - The second signOut() runs on a Supabase client that the first
 *     just invalidated — error logs accumulate, UI flickers.
 *
 * This module exposes a single global key-space. A caller asks
 * `singleFlight('key', () => doWork())`. If no work is in flight for
 * that key, it runs immediately. If work IS in flight, the caller
 * awaits the SAME promise and gets the SAME result — no duplicate work
 * is started.
 *
 * The default scope is browser-wide (module-singleton). For tests we
 * expose {@link resetSingleFlight}.
 */

type Pending<T> = {
  promise: Promise<T>;
  startedAt: number;
};

const pending = new Map<string, Pending<unknown>>();
let coalescedHits = 0;

function warnSingleFlightResetWithPendingSlots(keys: string[]): void {
  const payload = {
    event: 'single_flight_reset_with_pending_slots',
    count: keys.length,
    keys,
  };

  if (typeof window === 'undefined') {
    console.warn(JSON.stringify({
      level: 'warn',
      ts: new Date().toISOString(),
      ...payload,
    }));
    return;
  }

  if (process.env.NODE_ENV === 'development') {
    console.warn('[single_flight_reset_with_pending_slots]', payload);
  }
}

/**
 * Run `work` under the single-flight guarantee for `key`. Concurrent
 * calls with the same key wait on the first call's promise and resolve
 * with its result (success or failure).
 */
export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = pending.get(key) as Pending<T> | undefined;
  if (existing) {
    coalescedHits += 1;
    return existing.promise;
  }

  let promise: Promise<T>;
  try {
    promise = Promise.resolve().then(work);
  } catch (err) {
    promise = Promise.reject(err);
  }

  const entry: Pending<T> = { promise, startedAt: Date.now() };
  pending.set(key, entry as Pending<unknown>);

  // Always clear the slot when the inflight promise settles, regardless
  // of outcome. The chained promise from `.finally()` rejects with the
  // same reason; we MUST swallow it locally to avoid an unhandled
  // rejection (the slot's promise is returned to the caller, who is
  // responsible for handling rejection on THEIR copy).
  promise.finally(() => {
    if (pending.get(key) === (entry as Pending<unknown>)) pending.delete(key);
  }).catch(() => { /* caller handles rejection on the returned promise */ });

  return promise;
}

/** True if any work is currently coalesced under `key`. */
export function isSingleFlightInFlight(key: string): boolean {
  return pending.has(key);
}

export function singleFlightDiagnostics(): {
  inFlight: Array<{ key: string; ageMs: number }>;
  coalescedHits: number;
} {
  const now = Date.now();
  return {
    inFlight: [...pending.entries()].map(([key, entry]) => ({
      key,
      ageMs: now - entry.startedAt,
    })),
    coalescedHits,
  };
}

/** Test-only. */
export function resetSingleFlight(): void {
  // Surface any leaks (a slot still held when tests reset) so we notice
  // long-lived in-flight promises rather than silently dropping them.
  if (pending.size > 0) {
    warnSingleFlightResetWithPendingSlots([...pending.keys()]);
  }
  pending.clear();
  coalescedHits = 0;
}
