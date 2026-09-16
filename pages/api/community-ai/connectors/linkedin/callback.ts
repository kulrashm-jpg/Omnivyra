import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl, readConnectorOAuthState, withQuery } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { logOAuthEvent, safeHost } from '../../../../../backend/auth/oauthTelemetry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const callbackHost = safeHost(getCommunityAiConnectorCallbackUrl('linkedin'));
  const requestOrigin = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null;

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'linkedin',
    callback_host: callbackHost,
    state_flow: 'community-ai',
    request_origin: requestOrigin,
  });

  if (error) {
    const message = typeof error_description === 'string' ? error_description : error;
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'provider_error',
      failure_detail: String(error),
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(String(message || 'OAuth failed'))}`
    );
  }

  if (!code || typeof code !== 'string') {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'missing_code',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing authorization code')}`
    );
  }

  if (!state || typeof state !== 'string') {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: 'state query param missing',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing OAuth state')}`
    );
  }

  // SEC91-B5: the state must be a valid HMAC-signed community-ai connector state
  // (backend/auth/oauthState: company + tenant + starting user, 10-min TTL). The old
  // unsigned base64 JSON — which anyone could write, naming any organization and any
  // redirect — is no longer accepted.
  const connectorState = readConnectorOAuthState(state);
  if (!connectorState.ok) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: connectorState.detail,
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Invalid OAuth state')}`
    );
  }

  const tenantId = connectorState.tenantId;
  const organizationId = connectorState.organizationId;
  // Validated same-origin path (SEC91-B4) — never an attacker-chosen URL.
  const redirectTo = connectorState.returnTo;

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  // The signed state proves where the flow started, not who is finishing it: the
  // session user must be the user who started it (login/account-linking CSRF).
  if (access.userId !== connectorState.stateUserId) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      company_id: organizationId,
      user_id: access.userId,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: 'state user does not match session user',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('This connection was started by a different user — please try again')}`
    );
  }

  const credentials = await getOAuthCredentialsForPlatform('linkedin');
  if (!credentials?.client_id || !credentials?.client_secret) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('LinkedIn OAuth not configured')}`
    );
  }

  const redirectUri = getCommunityAiConnectorCallbackUrl('linkedin');

  try {
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'linkedin',
        callback_host: callbackHost,
        company_id: organizationId,
        user_id: access!.userId,
        state_flow: 'community-ai',
        failure_point: 'token_exchange_failed',
        failure_detail: `HTTP ${tokenResponse.status}`,
      });
      return res.redirect(
        `/community-ai/connectors?error=${encodeURIComponent('Connection failed. Please try again.')}`
      );
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'linkedin',
        callback_host: callbackHost,
        company_id: organizationId,
        user_id: access!.userId,
        state_flow: 'community-ai',
        failure_point: 'token_exchange_failed',
        failure_detail: 'token response missing access_token',
      });
      return res.redirect(
        `/community-ai/connectors?error=${encodeURIComponent('LinkedIn did not return an access token. Check your OAuth app scopes.')}`
      );
    }

    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // Verify token and get LinkedIn identity via OIDC userinfo endpoint
    let linkedinSub: string | null = null;
    let linkedinName: string | null = null;
    const userinfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userinfoRes.ok) {
      const userinfo = await userinfoRes.json();
      linkedinSub = userinfo.sub || null;
      linkedinName = userinfo.name || userinfo.given_name || null;
    } else {
      console.warn('[linkedin/connector/callback] userinfo fetch failed:', userinfoRes.status);
    }

    // saveToken now writes ONLY metadata (connected_by_user_id, scopes, etc.)
    // — see backend/services/platformTokenService.ts. The actual access /
    // refresh tokens land in social_accounts via dualWriteSocialAccount, which
    // is the single source of truth post-consolidation.
    await saveToken(tenantId, organizationId, 'linkedin', {
      connected_by_user_id: access!.userId,
    });

    await dualWriteSocialAccount({
      userId: access!.userId,
      companyId: organizationId,
      platform: 'linkedin',
      platformUserId: linkedinSub,
      accountName: linkedinName,
      token: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || undefined,
        expires_at: expiresAt || undefined,
        token_type: tokenData.token_type || 'Bearer',
      },
    });

    // G5.5: Audit log
    console.info('[connector_audit]', JSON.stringify({ user_id: access!.userId, company_id: organizationId, platform: 'linkedin', action: 'connect', linkedin_sub: linkedinSub, linkedin_name: linkedinName }));

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'linkedin',
      callback_host: callbackHost,
      company_id: organizationId,
      user_id: access!.userId,
      state_flow: 'community-ai',
    });
    return res.redirect(withQuery(redirectTo, { connected: 'linkedin', status: 'success' }));
  } catch (err: any) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
      callback_host: callbackHost,
      company_id: organizationId,
      user_id: access!.userId,
      state_flow: 'community-ai',
      failure_point: 'callback_exception',
      failure_detail: String(err?.message ?? err).slice(0, 200),
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Connection failed. Please try again.')}`
    );
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/linkedin/callback' });
