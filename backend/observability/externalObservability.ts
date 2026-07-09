/**
 * HARDEN-001A — external outbound HTTP instrumentation.
 *
 * Two reusable, FAIL-SAFE ways to observe outbound calls without changing them:
 *   - observedFetch(): a drop-in fetch() wrapper (latency, status, error, timeout,
 *     response size).
 *   - observeExternalCall(host, fn): wrap any promise-returning HTTP call (axios,
 *     SDKs) to record latency + success/failure/timeout.
 *
 * Wired into the centralized outbound paths. Per-adapter raw axios calls can opt
 * in via observeExternalCall without duplicating timing logic.
 */
import { recordExternal } from './metrics';
import { domainEnabled } from './config';

function hostOf(url: string): string {
  try { return new URL(url).host || 'unknown'; } catch { return 'unknown'; }
}

function isTimeout(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; name?: string; message?: string };
  return e.code === 'ECONNABORTED' || e.name === 'AbortError' || /timeout/i.test(e.message ?? '');
}

/** Wrap any outbound HTTP promise (axios/SDK). Records latency + outcome. */
export async function observeExternalCall<T>(hostOrUrl: string, fn: () => Promise<T>): Promise<T> {
  if (!domainEnabled('externalApi')) return fn();
  const host = /^https?:\/\//i.test(hostOrUrl) ? hostOf(hostOrUrl) : hostOrUrl;
  const t0 = performance.now();
  try {
    const out = await fn();
    try {
      const status = (out as { status?: number })?.status;
      recordExternal({ host, durationMs: performance.now() - t0, status, error: typeof status === 'number' && status >= 500 });
    } catch { /* fail-safe */ }
    return out;
  } catch (err) {
    try { recordExternal({ host, durationMs: performance.now() - t0, error: true, timeout: isTimeout(err) }); } catch { /* fail-safe */ }
    throw err;
  }
}

/** Drop-in fetch() wrapper — identical semantics, plus observation. */
export async function observedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!domainEnabled('externalApi')) return fetch(input as RequestInfo, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = hostOf(url);
  const t0 = performance.now();
  try {
    const res = await fetch(input as RequestInfo, init);
    try { recordExternal({ host, durationMs: performance.now() - t0, status: res.status, error: res.status >= 500 }); } catch { /* fail-safe */ }
    return res;
  } catch (err) {
    try { recordExternal({ host, durationMs: performance.now() - t0, error: true, timeout: isTimeout(err) }); } catch { /* fail-safe */ }
    throw err;
  }
}
