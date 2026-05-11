import { clearBrowserAuthState } from './authStorage';

/**
 * clearSupabaseSession — one-time cleanup for users with stale Supabase sessions.
 *
 * Call this once on app init (e.g., in _app.tsx) to remove leftover Supabase
 * auth keys from localStorage that would cause the old getSession() calls
 * to find a Supabase session and redirect to dashboard even after full logout.
 */
export function clearSupabaseSession(): void {
  clearBrowserAuthState({ preservePkce: false });
}
