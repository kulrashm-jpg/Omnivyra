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
    const msg = String((err as Error)?.message ?? err);
    if (!msg.includes('CLOSING') && !msg.includes('CLOSED')) {
      console.error('❌ getAuthToken error:', err);
    }
    return null;
  }
}
