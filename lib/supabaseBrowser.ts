/**
 * Browser-side Supabase client — singleton.
 * Uses the anon key; respects RLS. Frontend / client components only.
 *
 * Import this (not the service-role client in backend/db/supabaseClient.ts)
 * wherever you need Supabase Auth or realtime in the browser.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Attach to globalThis so the singleton survives Next.js HMR / Turbopack
// re-evaluation of this module in multiple chunks. Without this, each chunk
// gets its own module copy → multiple GoTrueClient instances → warning.
const GLOBAL_KEY = '__supabase_browser_client__';

declare global {
  // eslint-disable-next-line no-var
  var __supabase_browser_client__: SupabaseClient | undefined;
}

export function getSupabaseBrowser(): SupabaseClient {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return globalThis[GLOBAL_KEY]!;
}
