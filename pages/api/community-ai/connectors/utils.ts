import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserRole } from '../../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { encodeOAuthState, decodeOAuthState } from '../../../../backend/auth/oauthState';
import { safeRelativeRedirectPath } from '../../../../backend/auth/safeRedirect';
import { getOAuthRedirectBase } from '../../../../backend/auth/oauthRedirectBase';

/**
 * Returns the OAuth callback URL for a Community AI connector.
 * Used by auth.ts and callback.ts for all platforms (facebook, twitter, reddit, instagram, linkedin).
 *
 * Production (SEC91-W2B-2): always the configured canonical app URL — request
 * `Host` / `X-Forwarded-Host` never choose the redirect_uri.
 *
 * Development / test with a request: the request origin (127.0.0.1 spelled
 * `localhost`), so local dev gets a localhost callback even when
 * NEXT_PUBLIC_APP_URL is set to the production domain in .env.local.
 */
export function getCommunityAiConnectorCallbackUrl(platform: string, req?: import('next').NextApiRequest): string {
  let baseUrl: string;

  if (req) {
    baseUrl = getOAuthRedirectBase(req, { loopback: 'localhost' });
  } else {
    // No request context (background / service caller). Canonical URL via
    // the validated config — was previously a localhost fallback that could
    // leak unreachable callback URLs into stored provider configs when
    // NEXT_PUBLIC_APP_URL was unset on the runtime.
    const { getCanonicalAppUrl } = require('../../../../backend/config/getCanonicalAppUrl') as { getCanonicalAppUrl: () => string };
    baseUrl = getCanonicalAppUrl();
  }

  return `${baseUrl}/api/community-ai/connectors/${platform}/callback`;
}

export const requireManageConnectors = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: string } | null> => {
  // SEC91-W2B-1: ONE identity path. The canonical resolver (getSupabaseUserFromRequest →
  // resolveAuthenticatedUser) reads the Bearer header AND the Supabase auth cookie that a
  // browser navigation carries (sb-<ref>-auth-token, chunked @supabase/ssr envelopes
  // included) and applies the account-state checks: soft-deleted, suspended,
  // session-revoked (users.session_revoked_after) and not-yet-accepted invited accounts
  // fail closed. Its verdict is final. The previous @supabase/ssr fallback re-resolved the
  // cookie with auth.getUser() plus a bare users.supabase_uid lookup whenever the resolver
  // said no, which re-admitted exactly the accounts the resolver had rejected.
  const { user, error } = await getSupabaseUserFromRequest(req);
  const resolvedUser: { id: string } | null = (!error && user?.id) ? { id: user.id } : null;

  if (!resolvedUser?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { role, error: roleError } = await getUserRole(resolvedUser.id, companyId);
  if (roleError || !role) {
    const err = roleError === 'COMPANY_ACCESS_DENIED' ? 'COMPANY_ACCESS_DENIED' : 'FORBIDDEN_ROLE';
    res.status(403).json({ error: err });
    return null;
  }
  // Community-AI connectors are NOT Virality External APIs.
  // Connector OAuth does NOT imply access to the Virality API catalog.
  // Capabilities are isolated by domain.
  if (!hasCommunityAiCapability(role, 'MANAGE_CONNECTORS')) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: resolvedUser.id, role };
};

// ── SEC91-B5: signed connector OAuth state ────────────────────────────────────
//
// The meta/reddit connector flows used to carry tenant, organization and the
// post-connect redirect in a plain base64-JSON `state` (no HMAC, no user binding,
// no expiry) that the callbacks trusted. They now use the same HMAC-signed state
// as every other OAuth flow (backend/auth/oauthState): company + tenant + the
// SESSION user who started the flow + flow marker + optional provider, a 10-minute
// TTL, and a returnTo that is validated to a same-origin path at mint AND read time.

export const CONNECTOR_DEFAULT_RETURN = '/community-ai/connectors';

export function mintConnectorOAuthState(input: {
  organizationId: string;
  userId: string;
  redirect?: unknown;
  provider?: string;
}): string {
  return encodeOAuthState({
    companyId: input.organizationId,
    tenantId: input.organizationId,
    userId: input.userId,
    flow: 'community-ai',
    provider: input.provider,
    // Unsafe values are dropped by encodeOAuthState; the default keeps the old behaviour.
    returnTo: safeRelativeRedirectPath(input.redirect, CONNECTOR_DEFAULT_RETURN),
  });
}

/**
 * A single shape rather than a discriminated union: the repository compiles with
 * `strict: false`, under which narrowing on a boolean literal does not apply.
 */
export type ConnectorOAuthState = {
  ok: boolean;
  organizationId: string;
  tenantId: string;
  stateUserId: string;
  /** Always a validated same-origin path. */
  returnTo: string;
  provider: string | null;
  /** Shape-only reason when !ok (safe to log; never contains state content). */
  detail: string;
};

export function readConnectorOAuthState(state: unknown): ConnectorOAuthState {
  const fail = (detail: string): ConnectorOAuthState => ({
    ok: false, organizationId: '', tenantId: '', stateUserId: '', returnTo: CONNECTOR_DEFAULT_RETURN, provider: null, detail,
  });
  if (typeof state !== 'string' || !state) return fail('state query param missing');
  const decoded = decodeOAuthState(state);
  if (decoded.valid !== true) return fail(`state rejected (${decoded.reason ?? 'invalid'})`);
  if (decoded.flow !== 'community-ai') return fail('state is not a community-ai connector state');
  const organizationId = decoded.companyId || '';
  const tenantId = decoded.tenantId || '';
  if (!organizationId || !tenantId || organizationId !== tenantId) return fail('tenant_id !== organization_id or missing');
  if (!decoded.userId) return fail('state carries no user binding');
  return {
    ok: true,
    organizationId,
    tenantId,
    stateUserId: decoded.userId,
    returnTo: safeRelativeRedirectPath(decoded.returnTo, CONNECTOR_DEFAULT_RETURN) as string,
    provider: decoded.provider ?? null,
    detail: '',
  };
}

/** Append query parameters to a validated same-origin path. */
export function withQuery(path: string, params: Record<string, string>): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${new URLSearchParams(params).toString()}`;
}
