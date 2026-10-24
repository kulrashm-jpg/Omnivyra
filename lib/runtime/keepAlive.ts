/**
 * Phase 3 — Vercel-aware keep-alive helper for background work that must
 * outlive the HTTP response.
 *
 * On Vercel, the platform's per-request `waitUntil` extends the lambda's
 * lifetime so the supplied Promise can complete after the response is flushed.
 * When it is unavailable (local dev, non-Vercel hosts), we fall back to
 * awaiting the Promise so the caller still observes completion — at the cost of
 * a longer response.
 *
 * WHY THE CONTEXT IS READ DIRECTLY. This previously loaded `@vercel/functions`
 * through `Function('s', 'return import(s)')`. That string-built import is
 * invisible to the bundler and to Vercel's file tracing, so the package was not
 * shipped with the function, the import failed silently, and every call fell
 * back to awaiting. Production 2026-10-24: POST /api/reports/generate received
 * at 13:44:51Z replied 202 at 13:46:19Z — 88 s held open for the whole
 * generation — and the browser connection was reset first ("Network
 * unreachable") although the report completed. `@vercel/functions`' own
 * `waitUntil` is only `globalThis[Symbol.for('@vercel/request-context')]
 * .get().waitUntil(p)`, and it silently no-ops when the context is absent;
 * reading the context here keeps the same mechanism without the import, and
 * falls back honestly instead.
 *
 * The `recover-stale-reports` cron is the safety net for the rare case where
 * neither path completes (e.g. lambda hard kill).
 */

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

type RequestContext = { waitUntil?: (p: Promise<unknown>) => void };
type ContextHolder = { get?: () => RequestContext | undefined };

/** The platform's waitUntil for THIS request, or null. Read per call: the context is per request. */
export function platformWaitUntil(): ((p: Promise<unknown>) => void) | null {
  if (!process.env.VERCEL) return null;
  const holder = (globalThis as unknown as Record<symbol, ContextHolder | undefined>)[REQUEST_CONTEXT];
  const ctx = holder?.get?.();
  return typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
}

export type KeepAliveMode = 'wait_until' | 'awaited';

/**
 * Run `work` so it survives HTTP response flush. Returns when it is safe for
 * the API handler to respond — which is either:
 *   - immediately, if the platform's `waitUntil` accepted the work, or
 *   - after `work` settles, if no platform helper is available.
 *
 * Resolves to the mode used, so a caller can log it and the path is observable
 * in production instead of being inferred from response latency.
 *
 * `work` MUST never reject. If it can throw, wrap it in a try/catch and
 * convert errors to a persisted state before passing it here.
 */
export async function keepAliveAfterResponse(work: Promise<void>): Promise<KeepAliveMode> {
  const waitUntil = platformWaitUntil();
  if (waitUntil) {
    waitUntil(work);
    return 'wait_until';
  }
  await work;
  return 'awaited';
}
