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
      console.log('✅ Got cached auth token');
      return data.session.access_token;
    }
    
    // No cached session and can't refresh (e.g., super-admin with cookie auth)
    console.log('⚠️ No cached session - likely super-admin or cookie-based auth');
    return null;
  } catch (err) {
    console.error('❌ getAuthToken error:', err);
    return null;
  }
}
