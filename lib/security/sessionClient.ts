/**
 * Frontend session client.
 *
 * Thin wrappers around /api/auth/session, /api/auth/capabilities,
 * /api/auth/logout, /api/auth/refresh. Frontends MUST NOT cache
 * authorization state locally — every authority decision is server-side.
 *
 * NO local capability derivation. NO local step-up trust. NO frontend
 * auth authority. The client merely REFLECTS what the server reports.
 */

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
  const r = await fetch('/api/auth/session', { method: 'GET', credentials: 'same-origin' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`/api/auth/session failed: ${r.status}`);
  return await r.json() as FrontendSessionSnapshot;
}

export async function fetchCapabilities(): Promise<FrontendCapabilitiesSnapshot | null> {
  const r = await fetch('/api/auth/capabilities', { method: 'GET', credentials: 'same-origin' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`/api/auth/capabilities failed: ${r.status}`);
  return await r.json() as FrontendCapabilitiesSnapshot;
}

/**
 * Server-side logout. Revokes the auth_session, cascades step-up revoke,
 * and clears the cookie.
 *
 * The caller should also call `supabase.auth.signOut()` to clear the
 * Supabase access token; the two are complementary.
 */
export async function logoutCurrentSession(): Promise<{ revokedAuthSessionId: string | null }> {
  const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) throw new Error(`/api/auth/logout failed: ${r.status}`);
  const body = await r.json() as { revokedAuthSessionId: string | null };
  return body;
}

/**
 * Touch the session to confirm liveness. Returns null on 401 (revoked /
 * expired) so the caller can re-trigger sign-in.
 */
export async function refreshCurrentSession(): Promise<{ sessionId: string; expiresAt: string } | null> {
  const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`/api/auth/refresh failed: ${r.status}`);
  return await r.json() as { sessionId: string; expiresAt: string };
}
