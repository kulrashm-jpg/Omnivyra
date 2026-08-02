/**
 * getAuthToken — Supabase session token resolver.
 *
 * Returns the current Supabase access token for API calls.
 * Returns null when unauthenticated (e.g., super-admins with cookie auth).
 *
 * OPT-004 — module-level memoization (browser only):
 * Previously every call awaited `getSession()`, which serializes behind the
 * tab-local processLock (localStorage read + JSON.parse per call). Under burst
 * page loads the contention made `getSession()` transiently return null
 * ("lock stolen"), which triggered apiFetch's one-shot `refreshSession()`
 * network round-trip. The memo below returns the cached token synchronously
 * while it has > 60 s of life left, dedupes concurrent misses into a single
 * `getSession()`, and is invalidated/updated by GoTrue auth events
 * (SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT — sign-out is broadcast across
 * tabs, so multi-tab logout clears it everywhere).
 *
 * The cache is STRICTLY browser-only: on the server this module's state would
 * be shared across requests in the same Node process, so the SSR path never
 * reads nor writes the memo — it resolves straight through `getSession()`
 * exactly as before.
 */

import { getSupabaseBrowser } from '../lib/supabaseBrowser';

/** Do not serve a cached token with less than this much life left. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

type CachedToken = { accessToken: string; expiresAt: number };
type SessionLike = { access_token?: string | null; expires_at?: number | null } | null | undefined;

let cachedToken: CachedToken | null = null;
let inFlight: Promise<string | null> | null = null;
let authSubscriptionStarted = false;

function cacheFromSession(session: SessionLike): void {
  // expires_at is epoch SECONDS; only cache when both fields are present so a
  // marginless session can never be served past its real lifetime.
  if (session?.access_token && session.expires_at) {
    cachedToken = { accessToken: session.access_token, expiresAt: session.expires_at * 1000 };
  }
}

/**
 * Exactly one lazy subscription on the existing browser singleton.
 * Fail-safe: if setup throws, token resolution falls back to the uncached
 * path (flag is reset so a later call may retry).
 */
function ensureAuthSubscription(): void {
  if (authSubscriptionStarted || typeof window === 'undefined') return;
  authSubscriptionStarted = true;
  try {
    getSupabaseBrowser().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        cachedToken = null;
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        cacheFromSession(session);
      }
    });
  } catch {
    authSubscriptionStarted = false;
  }
}

async function resolveTokenFromSession(populateCache: boolean): Promise<string | null> {
  try {
    const sb = getSupabaseBrowser();
    const { data } = await sb.auth.getSession();
    if (data.session?.access_token) {
      if (populateCache) cacheFromSession(data.session);
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

export async function getAuthToken(): Promise<string | null> {
  // SSR: legacy behavior, no memo, no subscription (module state on the
  // server is shared across requests — caching there would be a leak).
  if (typeof window === 'undefined') {
    return resolveTokenFromSession(false);
  }

  ensureAuthSubscription();

  if (cachedToken && cachedToken.expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
    return cachedToken.accessToken;
  }

  // Cache miss: dedupe concurrent callers into ONE getSession().
  if (!inFlight) {
    inFlight = resolveTokenFromSession(true).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
