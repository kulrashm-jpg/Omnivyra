/**
 * Browser-side Supabase client — singleton.
 * Uses the anon key; respects RLS. Frontend / client components only.
 *
 * Import this (not the service-role client in backend/db/supabaseClient.ts)
 * wherever you need Supabase Auth or realtime in the browser.
 */

import { createBrowserClient } from '@supabase/ssr';
import { processLock, type SupabaseClient } from '@supabase/supabase-js';

// Attach to globalThis so the singleton survives Next.js HMR / Turbopack
// re-evaluation of this module in multiple chunks. Without this, each chunk
// gets its own module copy → multiple GoTrueClient instances → warning.
const GLOBAL_KEY = '__supabase_browser_client__';

declare global {
   
  var __supabase_browser_client__: SupabaseClient | undefined;
}

// Why processLock instead of the default navigator.locks: under Next.js 16
// HMR + multi-tab, the default Web Locks impl uses {steal: true} for token
// refresh coordination, and one tab's refresh aborts another's pending request
// with `AbortError: Lock broken by another request with the 'steal' option`.
// processLock is an in-memory tab-local lock — refreshes don't cross tabs,
// and the server is idempotent on refresh so two tabs racing is harmless.
export function getSupabaseBrowser(): SupabaseClient {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          lock: processLock,
          // Magic-link and password-reset both round-trip a single-use PKCE
          // code through /auth/callback and /auth/set-password, which call
          // exchangeCodeForSession() manually (behind their own re-entrancy
          // guards). The @supabase/ssr default detectSessionInUrl:true makes
          // GoTrue ALSO auto-exchange that ?code= on client init — the two
          // exchanges race, the loser hits "code already used", and the user
          // is bounced to /login?error=verification_invalid_or_expired.
          // Disable auto-detect so the manual, guarded exchange is the single
          // authoritative path. flowType is pinned to pkce (current ssr
          // default) so the manual exchangeCodeForSession path stays correct
          // even if the library default changes.
          flowType: 'pkce',
          detectSessionInUrl: false,
        },
      },
    );
  }
  return globalThis[GLOBAL_KEY]!;
}
