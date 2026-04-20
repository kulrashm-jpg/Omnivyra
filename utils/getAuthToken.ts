/**
 * getAuthToken — Supabase session token resolver.
 *
 * Returns the current Supabase access token for API calls.
 * Returns null when unauthenticated (e.g., super-admins with cookie auth).
 */

import { getSupabaseBrowser } from '../lib/supabaseBrowser';

export async function getAuthToken(): Promise<string | null> {
  try {
    const sb = getSupabaseBrowser();
    const { data } = await sb.auth.getSession();
    if (data.session?.access_token) {
      return data.session.access_token;
    }
    return null;
  } catch (err) {
    // Suppress WebSocket closed errors that fire during page navigation —
    // the client tears down its realtime connection on unmount and any
    // in-flight auth calls hit an already-closed socket. Not actionable.
    // Also suppress Supabase auth lock contention: when multiple components
    // call getSession() simultaneously, one steals the lock from another.
    // The caller that lost the lock returns null; the winner completes normally.
    const msg = String((err as Error)?.message ?? err);
    const isIgnorable =
      msg.includes('CLOSING') ||
      msg.includes('CLOSED') ||
      msg.includes('was released because another request stole it') ||
      msg.includes('NavigatorLockAcquireTimeoutError');
    if (!isIgnorable) {
      console.error('❌ getAuthToken error:', err);
    }
    return null;
  }
}
