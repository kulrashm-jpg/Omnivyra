/**
 * clearSupabaseSession — one-time cleanup for users with stale Supabase sessions.
 *
 * Call this once on app init (e.g., in _app.tsx) to remove leftover Supabase
 * auth keys from localStorage that would cause the old getSession() calls
 * to find a Supabase session and redirect to dashboard even after full logout.
 */
export function clearSupabaseSession(): void {
  if (typeof window === 'undefined') return;
  try {
    // Remove all Supabase auth keys from localStorage
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') || key.startsWith('supabase.auth.')) {
        localStorage.removeItem(key);
      }
    });
    // Remove Supabase session cookie if any
    document.cookie = 'sb-access-token=; Max-Age=0; path=/';
    document.cookie = 'sb-refresh-token=; Max-Age=0; path=/';
  } catch {
    // localStorage not available (SSR or incognito restriction)
  }
}
