import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { persistGrantedScopesByPlatformUser, normaliseScopes } from '../../../../../backend/auth/oauthScopePersistence';
import { logOAuthEvent, safeHost } from '../../../../../backend/auth/oauthTelemetry';

const decodeState = (state: string) => {
  const padded = state.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(padded, 'base64');
  return JSON.parse(buffer.toString('utf8')) as {
    tenant_id?: string;
    organization_id?: string;
    redirect?: string;
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const callbackHost = safeHost(getCommunityAiConnectorCallbackUrl('reddit', req));
  const requestOrigin = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null;

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'reddit',
    callback_host: callbackHost,
    state_flow: 'community-ai',
    request_origin: requestOrigin,
  });

  if (error) {
    const message = typeof error_description === 'string' ? error_description : error;
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'reddit',
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
      provider: 'reddit',
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
      provider: 'reddit',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: 'state query param missing',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing OAuth state')}`
    );
  }

  let statePayload: { tenant_id?: string; organization_id?: string; redirect?: string };
  try {
    statePayload = decodeState(state);
  } catch {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'reddit',
      callback_host: callbackHost,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: 'JSON.parse of base64 state failed',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Invalid OAuth state')}`
    );
  }

  const tenantId = statePayload.tenant_id || '';
  const organizationId = statePayload.organization_id || '';
  const redirectTo = statePayload.redirect || '/community-ai/connectors';

  if (!tenantId || !organizationId || tenantId !== organizationId) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'reddit',
      callback_host: callbackHost,
      company_id: organizationId || null,
      state_flow: 'community-ai',
      failure_point: 'invalid_oauth_state',
      failure_detail: 'tenant_id !== organization_id or missing',
    });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Invalid tenant scope')}`
    );
  }

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  const credentials = await getOAuthCredentialsForPlatform('reddit');
  if (!credentials?.client_id || !credentials?.client_secret) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Reddit OAuth not configured')}`
    );
  }

  const { client_id: clientId, client_secret: clientSecret } = credentials;
  const redirectUri = getCommunityAiConnectorCallbackUrl('reddit', req);

  try {
    const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'community-ai/1.0',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'reddit',
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
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await saveToken(tenantId, organizationId, 'reddit', {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
      connected_by_user_id: access!.userId,
    });

    await dualWriteSocialAccount({
      userId: access!.userId,
      companyId: organizationId,
      platform: 'reddit',
      platformUserId: null,
      accountName: null,
      token: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || undefined,
        expires_at: expiresAt || undefined,
      },
    });

    // Phase 0 — persist actually-granted scopes. Reddit returns `scope` as a
    // space-separated string on the token response.
    const grantedRedditScopes = normaliseScopes(tokenData.scope, 'space');
    if (grantedRedditScopes.length > 0) {
      await persistGrantedScopesByPlatformUser({
        userId: access!.userId,
        companyId: organizationId,
        platform: 'reddit',
        platformUserId: null,
        grantedScopes: grantedRedditScopes,
      });
    }

    // G5.5: Audit log
    console.info('[connector_audit]', JSON.stringify({ user_id: access!.userId, company_id: organizationId, platform: 'reddit', action: 'connect' }));

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'reddit',
      callback_host: callbackHost,
      company_id: organizationId,
      user_id: access!.userId,
      state_flow: 'community-ai',
    });
    return res.redirect(`${redirectTo}?connected=reddit&status=success`);
  } catch (err: any) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'reddit',
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
