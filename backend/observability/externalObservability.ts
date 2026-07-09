/**
 * HARDEN-001A — external outbound HTTP instrumentation.
 *
 * A reusable, FAIL-SAFE way to observe outbound calls without changing them:
 *   - observeExternalCall(host, fn): wrap any promise-returning HTTP call (axios,
 *     SDKs) to record latency + success/failure/timeout.
 *
 * Per-adapter raw axios/SDK calls can opt in via observeExternalCall without
 * duplicating timing logic. (The former observedFetch() wrapper was removed in
 * PROD-001: all outbound fetch now goes through lib/security/safeFetch, which
 * performs the same instrumentation AND the HARDEN-005 SSRF controls — a raw
 * fetch wrapper here would be an SSRF-bypass footgun.)
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
