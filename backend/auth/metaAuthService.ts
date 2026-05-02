/**
 * MetaAuthService
 *
 * Unified token management for all Meta platforms:
 * Facebook, Instagram, WhatsApp
 *
 * Handles:
 *  - Short-lived → long-lived token exchange
 *  - Token refresh (per-platform logic)
 *  - System User token path (no refresh, no OAuth)
 *  - Auth context resolution (client_id/secret without env coupling)
 *  - getValidAccessToken() with automatic 5-day pre-expiry refresh
 */

import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getToken, setToken } from './tokenStore';

// Meta deprecates Graph API versions ~24 months after release. Bump together
// with all other Meta endpoints in the codebase — mismatched versions across
// OAuth dialog/token-exchange/publish silently break the consent flow.
export const META_GRAPH_VERSION = 'v22.0';
const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MetaPlatform = 'facebook' | 'instagram' | 'whatsapp' | 'threads';

export interface SocialAccountAuthContext {
  id:                string;
  platform:          MetaPlatform;
  is_system_user:    boolean;
  access_token:      string;        // decrypted
  token_expires_at:  string | null;
  client_id:         string | null; // resolved from auth_client_id_ref or env
  client_secret:     string | null; // resolved from auth_client_secret_ref or env
}

export interface TokenExchangeResult {
  access_token: string;
  token_type:   string;
  expires_in:   number;
}

// ── Auth context resolution ───────────────────────────────────────────────────

/**
 * Resolve client_id and client_secret from stored ref or env fallback.
 * auth_client_id_ref can be: an env var name (e.g. "META_APP_ID")
 * or a direct encrypted value (detected by format).
 */
function resolveClientRef(ref: string | null, envFallback: string | string[]): string | null {
  const fallbacks = Array.isArray(envFallback) ? envFallback : [envFallback];
  if (!ref) return fallbacks.map((key) => process.env[key]).find(Boolean) ?? null;
  // If ref looks like an env var name (uppercase, underscores only) → resolve it
  if (/^[A-Z][A-Z0-9_]+$/.test(ref)) return process.env[ref] ?? null;
  // Otherwise treat as direct value (encrypted or plaintext)
  return ref;
}

/**
 * Returns full auth context for a social account.
 * Use this instead of ad-hoc platform/token lookups.
 */
export async function getSocialAccountAuthContext(
  socialAccountId: string,
): Promise<SocialAccountAuthContext> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, platform, is_system_user, token_expires_at, auth_client_id_ref, auth_client_secret_ref')
    .eq('id', socialAccountId)
    .single();

  if (error || !data) throw new Error(`Social account not found: ${socialAccountId}`);

  const token = await getToken(socialAccountId);
  if (!token?.access_token) throw new Error(`No token stored for account: ${socialAccountId}`);

  const platform = data.platform as MetaPlatform;

  // Resolve client credentials from stored refs or env fallbacks
  const envClientId     = platform === 'whatsapp' ? ['WHATSAPP_APP_ID', 'META_APP_ID', 'META_CLIENT_ID'] : ['META_APP_ID', 'META_CLIENT_ID'];
  const envClientSecret = platform === 'whatsapp' ? ['WHATSAPP_APP_SECRET', 'META_APP_SECRET', 'META_CLIENT_SECRET'] : ['META_APP_SECRET', 'META_CLIENT_SECRET'];

  const client_id     = resolveClientRef(data.auth_client_id_ref,     envClientId);
  const client_secret = resolveClientRef(data.auth_client_secret_ref, envClientSecret);

  // Refinement 1: validate resolved credentials are present
  // (only required for non-system-user accounts that will need refresh)
  if (!data.is_system_user && (!client_id || !client_secret)) {
    throw new Error(
      `Invalid OAuth client reference for account ${socialAccountId} (platform: ${platform}). ` +
      `Ensure auth_client_id_ref and auth_client_secret_ref are set, or set Meta OAuth env vars.`
    );
  }

  return {
    id:               data.id,
    platform,
    is_system_user:   data.is_system_user ?? false,
    access_token:     token.access_token,
    token_expires_at: data.token_expires_at ?? null,
    client_id,
    client_secret,
  };
}

// ── Token exchange ────────────────────────────────────────────────────────────

/**
 * Exchange a short-lived token for a long-lived (~60 day) token.
 * Call immediately after OAuth callback for FB/IG/WA.
 */
export async function exchangeShortToLongLivedToken(
  shortLivedToken: string,
  clientId:        string,
  clientSecret:    string,
): Promise<TokenExchangeResult> {
  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         clientId,
    client_secret:     clientSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${META_GRAPH}/oauth/access_token?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta token exchange failed (${res.status}): ${err?.error?.message ?? res.statusText}`);
  }
  return res.json();
}

// ── Token refresh ─────────────────────────────────────────────────────────────

/**
 * Refresh a long-lived token before it expires.
 *
 * - System User tokens: never expire, return current token unchanged.
 * - Instagram: uses ig_refresh_token endpoint (no client_secret needed).
 * - Facebook/WhatsApp: re-exchange via fb_exchange_token.
 */
export async function refreshLongLivedToken(
  platform:        MetaPlatform,
  currentToken:    string,
  isSystemUser:    boolean,
  clientId?:       string | null,
  clientSecret?:   string | null,
): Promise<TokenExchangeResult> {
  // Fix A: System User tokens never expire — skip refresh entirely
  if (isSystemUser) {
    return { access_token: currentToken, token_type: 'Bearer', expires_in: 0 };
  }

  if (platform === 'instagram') {
    // Instagram uses its own refresh endpoint — no client_secret needed
    const params = new URLSearchParams({
      grant_type:   'ig_refresh_token',
      access_token: currentToken,
    });
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Instagram token refresh failed (${res.status}): ${err?.error?.message ?? res.statusText}`);
    }
    return res.json();
  }

  if (platform === 'threads') {
    // Threads uses same pattern as Instagram — no client_secret needed
    const params = new URLSearchParams({
      grant_type:   'th_refresh_token',
      access_token: currentToken,
    });
    const res = await fetch(`https://graph.threads.net/refresh_access_token?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Threads token refresh failed (${res.status}): ${err?.error?.message ?? res.statusText}`);
    }
    return res.json();
  }

  // Facebook / WhatsApp — re-exchange via fb_exchange_token
  if (!clientId || !clientSecret) {
    throw new Error(`clientId and clientSecret required for ${platform} token refresh`);
  }
  return exchangeShortToLongLivedToken(currentToken, clientId, clientSecret);
}

// ── Primary entry point ───────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/**
 * Get a valid access token for a Meta social account.
 * Automatically refreshes if within 5-day expiry window.
 *
 * Usage in adapters:
 *   const token = await getValidAccessToken(account.id);
 */
export async function getValidAccessToken(socialAccountId: string): Promise<string> {
  const ctx = await getSocialAccountAuthContext(socialAccountId);

  // System User tokens never expire
  if (ctx.is_system_user) return ctx.access_token;

  // Check if refresh is needed
  const expiresAt   = ctx.token_expires_at ? new Date(ctx.token_expires_at) : null;
  const needsRefresh = !expiresAt || (expiresAt.getTime() - Date.now()) < REFRESH_BUFFER_MS;

  if (!needsRefresh) return ctx.access_token;

  // Refresh
  const refreshed = await refreshLongLivedToken(
    ctx.platform,
    ctx.access_token,
    ctx.is_system_user,
    ctx.client_id,
    ctx.client_secret,
  );

  const newExpiresAt = refreshed.expires_in > 0
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : null;

  await setToken(socialAccountId, {
    access_token: refreshed.access_token,
    expires_at:   newExpiresAt ?? undefined,
    token_type:   refreshed.token_type,
  });

  return refreshed.access_token;
}

// ── OAuth flow guard ──────────────────────────────────────────────────────────

/**
 * Refinement 2: Prevent OAuth flow being initiated for System User accounts.
 * Call at the start of any OAuth callback handler.
 */
export function assertNotSystemUser(
  isSystemUser: boolean,
  context = 'OAuth flow',
): void {
  if (isSystemUser) {
    throw new Error(
      `${context} is not allowed for System User accounts. ` +
      `System User tokens are provisioned via Meta Business Manager, not OAuth.`
    );
  }
}
