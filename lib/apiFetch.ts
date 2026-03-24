/**
 * Authenticated client-side fetch.
 * Adds Firebase Bearer token so API routes can verify identity.
 * Safe to call from any browser context — returns plain fetch on SSR/no-session.
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
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
