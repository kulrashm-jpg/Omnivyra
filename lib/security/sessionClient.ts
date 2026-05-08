/**
 * Frontend session client.
 *
 * Thin wrappers around /api/auth/session, /api/auth/capabilities,
 * /api/auth/logout, /api/auth/refresh. Frontends MUST NOT cache
 * authorization state locally — every authority decision is server-side.
 *
 * NO local capability derivation. NO local step-up trust. NO frontend
 * auth authority. The client merely REFLECTS what the server reports.
 *
 * Phase: Global Fetch Hardening — every fetch goes through `safeFetchJson`
 * so HTML auth-redirect pages, framework 5xx pages, network errors, and
 * parse failures surface as structured runtime errors instead of cryptic
 * "Unexpected token '<'" parse explosions. The 401 → null UX semantics for
 * "not signed in" are preserved.
 */

import { safeFetchJson } from '@/lib/utils/safeFetchJson';

// ── Types (mirrors server response shapes; subset for client convenience) ──

export interface FrontendSessionSnapshot {
  authenticated: boolean;
  via: 'supabase' | 'legacy_cookie_bridge' | null;
  user: {
    id: string;
    supabaseUid: string;
    email: string;
    emailVerified: boolean;
  } | null;
  session: {
    id: string | null;
    ageSeconds: number;
    staleSeconds: number;
  };
  activeOrgId: string | null;
  organizations: ReadonlyArray<{
    organizationId: string;
    role: string;
    status: string;
  }>;
  mfa: {
    enrolled: boolean;
    factors: ReadonlyArray<'webauthn' | 'totp'>;
    lastVerifiedAt: string | null;
    phishingResistant: boolean;
  };
  stepUp: {
    active: boolean;
    expiresAt: string | null;
    factor: 'webauthn' | 'totp' | null;
  };
  device: { trusted: boolean };
  legacyCookieSuperAdmin: boolean;
}

export interface FrontendCapabilitiesSnapshot {
  capabilities: ReadonlyArray<string>;
  byOrganization: Record<string, ReadonlyArray<string>>;
  legacyCookieSuperAdmin: boolean;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function fetchSessionSnapshot(): Promise<FrontendSessionSnapshot | null> {
  const result = await safeFetchJson<FrontendSessionSnapshot>(
    '/api/auth/session',
    { method: 'GET', credentials: 'same-origin' },
  );
  if (result.ok === true) return result.data;
  // 401 → "not signed in" → null. Preserves prior UX semantics.
  if (result.status === 401) return null;
  throw new Error(`/api/auth/session failed (${result.status}, ${result.reason}): ${result.message}`);
}

export async function fetchCapabilities(): Promise<FrontendCapabilitiesSnapshot | null> {
  const result = await safeFetchJson<FrontendCapabilitiesSnapshot>(
    '/api/auth/capabilities',
    { method: 'GET', credentials: 'same-origin' },
  );
  if (result.ok === true) return result.data;
  if (result.status === 401) return null;
  throw new Error(`/api/auth/capabilities failed (${result.status}, ${result.reason}): ${result.message}`);
}

/**
 * Server-side logout. Revokes the auth_session, cascades step-up revoke,
 * and clears the cookie.
 *
 * The caller should also call `supabase.auth.signOut()` to clear the
 * Supabase access token; the two are complementary.
 */
export async function logoutCurrentSession(): Promise<{ revokedAuthSessionId: string | null }> {
  const result = await safeFetchJson<{ revokedAuthSessionId: string | null }>(
    '/api/auth/logout',
    { method: 'POST', credentials: 'same-origin' },
  );
  if (result.ok === true) return result.data;
  throw new Error(`/api/auth/logout failed (${result.status}, ${result.reason}): ${result.message}`);
}

/**
 * Touch the session to confirm liveness. Returns null on 401 (revoked /
 * expired) so the caller can re-trigger sign-in.
 */
export async function refreshCurrentSession(): Promise<{ sessionId: string; expiresAt: string } | null> {
  const result = await safeFetchJson<{ sessionId: string; expiresAt: string }>(
    '/api/auth/refresh',
    { method: 'POST', credentials: 'same-origin' },
  );
  if (result.ok === true) return result.data;
  if (result.status === 401) return null;
  throw new Error(`/api/auth/refresh failed (${result.status}, ${result.reason}): ${result.message}`);
}
