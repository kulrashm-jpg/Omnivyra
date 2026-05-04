/**
 * Browser-side authenticated fetch wrapper. Attaches the Supabase Bearer
 * token to every request via `Authorization: Bearer <token>`, plus
 * `credentials: 'include'` so first-party session cookies still ride along.
 *
 * Used app-wide for any API call that requires the caller's identity:
 * super-admin panels, campaign/recommendation/planner UI, hooks, etc.
 *
 * Usage (client components / hooks only — never from API routes):
 *
 *   import { apiFetch } from '@/lib/apiFetch';
 *   const res = await apiFetch('/api/some-route');
 */

import { getSupabaseBrowser } from './supabaseBrowser';

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await getSupabaseBrowser().auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (err) {
    // Suppress WebSocket teardown / lock-contention noise that fires during
    // page navigation. Caller proceeds without a token (fetch will 401 if the
    // route requires auth).
    const msg = String((err as Error)?.message ?? err);
    const isIgnorable =
      msg.includes('CLOSING') ||
      msg.includes('CLOSED') ||
      msg.includes('was released because another request stole it') ||
      msg.includes('NavigatorLockAcquireTimeoutError');
    if (!isIgnorable && process.env.NODE_ENV !== 'production') {
      console.error('[apiFetch.getAccessToken]', err);
    }
    return null;
  }
}

export async function apiFetch(
  url: RequestInfo,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();

  const mergedHeaders: Record<string, string> = {};
  const initHeaders = options.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { mergedHeaders[k] = v; });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) mergedHeaders[k] = v;
    } else if (typeof initHeaders === 'object') {
      Object.assign(mergedHeaders, initHeaders);
    }
  }
  if (token) {
    mergedHeaders.Authorization = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: mergedHeaders,
  });
}
