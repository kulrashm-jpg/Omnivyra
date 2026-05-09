/**
 * Phase 3 — Vercel-aware keep-alive helper for background work that must
 * outlive the HTTP response.
 *
 * On Vercel, `waitUntil` (when `@vercel/functions` is installed) extends the
 * lambda's lifetime so the supplied Promise can complete after the response
 * is flushed. When the helper is unavailable (local dev, non-Vercel hosts,
 * or the package isn't installed), we fall back to awaiting the Promise so
 * the caller still observes completion — at the cost of a longer response.
 *
 * This matches the project constraint of "smallest stable production-safe
 * correction": no queue, no new infrastructure — one helper, one switch.
 *
 * The `recover-stale-reports` cron is the safety net for the rare case where
 * neither path completes (e.g. lambda hard kill).
 */

let _waitUntilImpl: ((p: Promise<unknown>) => void) | null | undefined;

async function resolveWaitUntil(): Promise<((p: Promise<unknown>) => void) | null> {
  if (_waitUntilImpl !== undefined) return _waitUntilImpl;

  // Only attempt the dynamic import on Vercel, otherwise we'd pay the resolve
  // cost on every request locally for nothing.
  if (!process.env.VERCEL) {
    _waitUntilImpl = null;
    return null;
  }

  try {
    // Use an indirect specifier so the TS compiler does not require the
    // package to be present at type-resolution time. The module is optional
    // — when absent we degrade to awaiting `work` directly.
    const specifier = '@vercel/functions';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dynamicImport = (Function('s', 'return import(s)') as (s: string) => Promise<any>);
    const mod: any = await dynamicImport(specifier).catch(() => null);
    const fn = mod && typeof mod.waitUntil === 'function' ? mod.waitUntil : null;
    _waitUntilImpl = fn;
    return fn;
  } catch {
    _waitUntilImpl = null;
    return null;
  }
}

/**
 * Run `work` so it survives HTTP response flush. Returns when it is safe for
 * the API handler to respond — which is either:
 *   - immediately, if the platform's `waitUntil` accepted the work, or
 *   - after `work` settles, if no platform helper is available.
 *
 * `work` MUST never reject. If it can throw, wrap it in a try/catch and
 * convert errors to a persisted state before passing it here.
 */
export async function keepAliveAfterResponse(work: Promise<void>): Promise<void> {
  const waitUntil = await resolveWaitUntil();
  if (waitUntil) {
    waitUntil(work);
    return;
  }
  await work;
}
