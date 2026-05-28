import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
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

  let statePayload: { tenant_id?: string; organization_id?: string; redirect?: string };
  try {
    statePayload = decodeState(state);
  } catch (err: any) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'linkedin',
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
      provider: 'linkedin',
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
    return res.redirect(
      `${redirectTo}?connected=linkedin&status=success`
    );
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
