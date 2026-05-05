// AUTH EXEMPT: OAuth callback handles external provider redirect
import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { logger } from '../../../../../backend/services/logger';

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
  if (error) {
    const message = typeof error_description === 'string' ? error_description : error;
    logger.error('oauth.callback.failure', { platform: 'reddit', flow: 'community-ai', reason: 'oauth_provider_error', provider_error: String(error), provider_error_description: error_description ? String(error_description) : null });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(String(message || 'OAuth failed'))}`
    );
  }

  if (!code || typeof code !== 'string') {
    logger.error('oauth.callback.failure', { platform: 'reddit', flow: 'community-ai', reason: 'no_code' });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing authorization code')}`
    );
  }

  if (!state || typeof state !== 'string') {
    logger.error('oauth.callback.failure', { platform: 'reddit', flow: 'community-ai', reason: 'no_state' });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing OAuth state')}`
    );
  }

  let statePayload: { tenant_id?: string; organization_id?: string; redirect?: string };
  try {
    statePayload = decodeState(state);
  } catch {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Invalid OAuth state')}`
    );
  }

  const tenantId = statePayload.tenant_id || '';
  const organizationId = statePayload.organization_id || '';
  const redirectTo = statePayload.redirect || '/community-ai/connectors';

  if (!tenantId || !organizationId || tenantId !== organizationId) {
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

    // G5.5: Audit log
    console.info('[connector_audit]', JSON.stringify({ user_id: access!.userId, company_id: organizationId, platform: 'reddit', action: 'connect' }));
    logger.info('oauth.callback.success', { platform: 'reddit', flow: 'community-ai', user_id: access!.userId, organization_id: organizationId });

    return res.redirect(`${redirectTo}?connected=reddit&status=success`);
  } catch (err: any) {
    logger.error('oauth.callback.failure', { platform: 'reddit', flow: 'community-ai', reason: 'exception', error_message: err?.message ?? 'unknown' });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Connection failed. Please try again.')}`
    );
  }
}

