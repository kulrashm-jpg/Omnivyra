/**
 * Authenticated client-side fetch — adds Supabase Bearer token so
 * proxy.ts middleware lets the request through on all /api/* routes.
 * Safe to call from any browser context (returns plain fetch on SSR/no-session).
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined;
  try {
    const { supabase } = await import('../utils/supabaseClient');
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? undefined;
  } catch {
    // Supabase unavailable (SSR, test) — fall through without token
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
