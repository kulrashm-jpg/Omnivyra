/**
 * Authenticated client-side fetch.
 * Adds Supabase Bearer token so API routes can verify identity.
 * Safe to call from any browser context — returns plain fetch on SSR/no-session.
 *
 * Network-failure behavior: if `fetch()` throws (TypeError: Failed to fetch
 * — typical when the dev server is mid-HMR-recompile, the route bundle is
 * stale, the network is offline, or a CORS preflight fails), this wrapper
 * returns a SYNTHETIC non-ok Response with status 503 instead of letting
 * the error propagate. Callers all check `r.ok` and handle non-2xx
 * uniformly; this keeps them on the happy code path and stops the Next.js
 * dev overlay from rendering a red "Failed to fetch" runtime error every
 * time the dev server blips. Real auth/permission failures are 401/403
 * from the server itself and are unaffected.
 */
import { getAuthToken } from '../utils/getAuthToken';

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined;
  try {
    const t = await getAuthToken();
    if (t) token = t;
  } catch {
    // Unauthenticated — proceed without Authorization header
  }
  try {
    return await fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    // Synthesize a non-ok Response so callers' `if (r.ok)` branches handle
    // network failures the same way they handle 5xx responses. Body shape
    // matches the JSON-error pattern most API routes use so callers that
    // parse `data.error` see something coherent.
    const message = err instanceof Error ? err.message : String(err);
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[apiFetch] network error → synthetic 503:', input, message);
    }
    return new Response(
      JSON.stringify({ error: 'Network unreachable', detail: message }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
