/**
 * DbOnlyClient — a Supabase client type with the .auth namespace removed.
 *
 * Any code that calls supabase.auth.* through this type will fail at
 * TypeScript compile time with:
 *
 *   Property 'auth' does not exist on type 'DbOnlyClient'
 *
 * This is the single authoritative type for all server-side database access.
 * Supabase Admin SDK (backend/db/supabaseClient.ts) is the ONLY permitted auth path.
 *
 * Usage:
 *   import type { DbOnlyClient } from '@/lib/db/types';
 *   import { supabase } from '@/backend/db/supabaseClient';
 *   const db = supabase as unknown as DbOnlyClient;
 *
 * Or cast at call site:
 *   const db: DbOnlyClient = createClient(...) as unknown as DbOnlyClient;
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Strip the entire 'auth' property so TypeScript refuses to compile any
// call to .auth on a DbOnlyClient value.
export type DbOnlyClient = Omit<SupabaseClient<any>, 'auth'> & {
  readonly auth: never;
};

/**
 * Cast a SupabaseClient to DbOnlyClient.
 * Use this once at creation time so all downstream consumers receive the
 * restricted type automatically.
 *
 * @example
 *   export const db = asDbOnly(createClient(url, key, { auth: { persistSession: false } }));
 */
export function asDbOnly(client: SupabaseClient<any>): DbOnlyClient {
  return client as unknown as DbOnlyClient;
}
