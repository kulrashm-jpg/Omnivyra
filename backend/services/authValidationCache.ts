/**
 * PERF-001 — short-TTL cache for Supabase token validation.
 *
 * WHY
 * ───
 * Every auth-protected endpoint calls `supabase.auth.getUser(token)` (a network
 * round-trip to Supabase GoTrue, ~5s timeout). A single user interaction fans
 * across several endpoints (auth callback: sync-supabase-user → verify-email →
 * post-login-route; workspace open: resolve → get-weekly-plans → daily-plans),
 * each re-validating the SAME bearer token independently and serially. That
 * repeated, identical network validation is the dominant activation latency.
 *
 * This cache memoizes a SUCCESSFUL validation result keyed by the exact token
 * string for a short, configurable TTL, so repeated validations of the same
 * token during one activation chain collapse to a single network call.
 *
 * SECURITY (unchanged behavior)
 * ─────────────────────────────
 *   - Only SUCCESSFUL validations are cached. A failed/rejected token is never
 *     cached and is always re-validated live.
 *   - Entry lifetime is capped to the JWT `exp` claim, so an expired token is
 *     never served from cache (token expiration behaves correctly).
 *   - The cache wraps ONLY the signature/expiry check. The application's real
 *     account-lifecycle enforcement (users.is_deleted, users.status,
 *     users.session_revoked_after vs JWT iat) runs on the freshly-read DB row on
 *     EVERY request regardless of a cache hit — so account deletion, suspension,
 *     and session revocation still take effect immediately. The only effect of a
 *     hit is skipping the redundant GoTrue round-trip within the TTL window.
 *   - Fail-safe: any cache/metric error degrades to a live validation.
 *   - Disable entirely with AUTH_VALIDATION_CACHE_ENABLED=0.
 *
 * Bounded (max entries) so a flood of distinct tokens can never grow unbounded.
 */
import { recordRawCounter, recordRawHistogram } from '../observability';

export interface CachedAuthIdentity {
  supabaseUid: string;
  email: string | null;
  emailVerified: boolean;
}

interface Entry {
  identity: CachedAuthIdentity;
  /** ms epoch when this entry must no longer be served. */
  expiresAt: number;
}

function numEnv(name: string, dflt: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : dflt;
}
function boolEnv(name: string, dflt: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function config() {
  return {
    enabled: boolEnv('AUTH_VALIDATION_CACHE_ENABLED', true),
    ttlMs: numEnv('AUTH_VALIDATION_CACHE_TTL_MS', 30_000), // 30s default
    maxEntries: numEnv('AUTH_VALIDATION_CACHE_MAX', 5_000),
  };
}

// Insertion-ordered map → cheap FIFO eviction (delete the oldest key).
const store = new Map<string, Entry>();

/** Decode the JWT `exp` (seconds since epoch) without trusting the signature —
 *  used only to cap cache staleness, never for auth decisions. */
function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(json) as { exp?: number };
    if (typeof claims.exp === 'number' && Number.isFinite(claims.exp)) {
      return claims.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

function counter(result: 'hit' | 'miss' | 'skip'): void {
  try { recordRawCounter('auth.validate.cache', 1, { result }); } catch { /* fail-safe */ }
}

/** Record the wall-clock cost of a (live) validation, tagged hit/miss. */
export function recordValidationLatency(ms: number, cached: boolean): void {
  try { recordRawHistogram('auth.validate.ms', ms, { cached: cached ? 'true' : 'false' }); } catch { /* fail-safe */ }
}

/**
 * Return a cached, still-valid identity for this token, or null on miss.
 * A miss (including disabled/expired) means the caller must validate live.
 */
export function getCachedValidation(token: string): CachedAuthIdentity | null {
  const cfg = config();
  if (!cfg.enabled || !token) return null;
  const entry = store.get(token);
  if (!entry) { counter('miss'); return null; }
  if (entry.expiresAt <= Date.now()) {
    store.delete(token);
    counter('miss');
    return null;
  }
  counter('hit');
  return entry.identity;
}

/** Cache a SUCCESSFUL validation. No-op when disabled or already expired. */
export function setCachedValidation(token: string, identity: CachedAuthIdentity): void {
  const cfg = config();
  if (!cfg.enabled || !token) return;
  const now = Date.now();
  let expiresAt = now + cfg.ttlMs;
  const jwtExp = decodeJwtExpMs(token);
  if (jwtExp !== null) {
    if (jwtExp <= now) { counter('skip'); return; } // already expired — never cache
    expiresAt = Math.min(expiresAt, jwtExp);
  }
  // FIFO eviction to stay bounded.
  if (store.size >= cfg.maxEntries && !store.has(token)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.delete(token); // re-insert to move to newest position
  store.set(token, { identity, expiresAt });
}

/** Test/ops hook — clear all cached validations (e.g. after a global signout). */
export function clearAuthValidationCache(): void {
  store.clear();
}

/** Test hook — current entry count. */
export function authValidationCacheSize(): number {
  return store.size;
}
