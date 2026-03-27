/**
 * getAuthToken — Supabase session token resolver.
 *
 * Returns the current Supabase access token for API calls.
 * Returns null when unauthenticated.
 */

import { getSupabaseBrowser } from '../lib/supabaseBrowser';

export async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await getSupabaseBrowser().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
