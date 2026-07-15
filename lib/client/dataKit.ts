/**
 * F-13 — Frontend Data & Loading Kit (Foundation Batch D).
 *
 * Minimal shared client data layer — NO new dependency (the audit's SWR/
 * react-query recommendation is fulfilled with a hand-rolled kit promoting
 * the repo's own singleFlight pattern to the browser). Three primitives:
 *
 *   - sharedFetchJson(url): module-level in-flight dedupe + short TTL memory
 *     cache. Two components mounting the same endpoint issue ONE request
 *     (audit B-27's duplicate-fetch pattern). Stamps x-request-id so W0-3
 *     trace correlation extends to the browser.
 *   - useSharedFetch(url): React hook over sharedFetchJson with loading/
 *     error state and focus revalidation.
 *   - useVisibilityPolling(fn, intervalMs): polling that PAUSES while the
 *     tab is hidden and fires immediately on return (audit B-53/B-77 —
 *     background tabs stop hammering the API).
 *
 * Batch D adopts exactly one approved page-surface (NotificationBell). The
 * kit is incremental by design — components migrate one at a time.
 * Kill switch: NEXT_PUBLIC_CLIENT_DATA_KIT=0 restores raw per-call fetches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TTL_MS = 15_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function kitEnabled(): boolean {
  try {
    return !/^(0|false|off|no)$/i.test(String(process.env.NEXT_PUBLIC_CLIENT_DATA_KIT ?? '1'));
  } catch {
    return true;
  }
}

function requestId(): string {
  try {
    return (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch {
    return `${Date.now()}`;
  }
}

/** Deduped, briefly-cached JSON GET. Failures are never cached. */
export async function sharedFetchJson<T = unknown>(
  url: string,
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const doFetch = async (): Promise<T> => {
    const res = await fetch(url, { headers: { 'x-request-id': requestId() } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json() as Promise<T>;
  };
  if (!kitEnabled()) return doFetch();

  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (!opts.force) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const pending = inFlight.get(url);
    if (pending) return pending as Promise<T>;
  }
  const promise = doFetch()
    .then((value) => {
      cache.set(url, { value, expiresAt: Date.now() + ttlMs });
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      return value;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
}

/** Drop a cached entry (after mutations). */
export function invalidateSharedFetch(url: string): void {
  cache.delete(url);
}

/** Hook: shared fetch + loading/error state + focus revalidation. */
export function useSharedFetch<T = unknown>(
  url: string | null,
  opts: { ttlMs?: number; revalidateOnFocus?: boolean } = {},
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const mounted = useRef(true);

  const load = useCallback((force = false) => {
    if (!url) return;
    setLoading(true);
    sharedFetchJson<T>(url, { ttlMs: opts.ttlMs, force })
      .then((value) => { if (mounted.current) { setData(value); setError(null); } })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err : new Error(String(err))); })
      .finally(() => { if (mounted.current) setLoading(false); });
  }, [url, opts.ttlMs]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!url || opts.revalidateOnFocus === false) return;
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [url, load, opts.revalidateOnFocus]);

  return { data, error, loading, refresh: () => load(true) };
}

/**
 * Visibility-aware polling: skips ticks while the tab is hidden, fires once
 * immediately when it becomes visible again. Interval 0 disables.
 */
export function useVisibilityPolling(fn: () => void, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!intervalMs) return;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') fnRef.current();
    };
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') fnRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [intervalMs]);
}
