// AUTH EXEMPT: OAuth callback handles external provider redirect
import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { logger } from '../../../../../backend/services/logger';
// IG/Threads social_accounts rows are now provisioned exclusively by the
// /api/auth/facebook OAuth flow via the meta_oauth_apply RPC. The community-ai
// connector flow only populates community_ai_platform_tokens (engagement layer).

/**
 * GET /api/community-ai/connectors/meta/callback
 *
 * Meta OAuth callback â€” saves the same access token for facebook, instagram, and whatsapp.
 * One connection covers all three Meta platforms.
 */

const decodeState = (state: string) => {
  const padded = state.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
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
    logger.error('oauth.callback.failure', { platform: 'meta', flow: 'community-ai', reason: 'oauth_provider_error', provider_error: String(error), provider_error_description: error_description ? String(error_description) : null });
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(String(message || 'Meta OAuth failed'))}`
    );
  }

  if (!code || typeof code !== 'string') {
    logger.error('oauth.callback.failure', { platform: 'meta', flow: 'community-ai', reason: 'no_code' });
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Missing authorization code')}`);
  }

  if (!state || typeof state !== 'string') {
    logger.error('oauth.callback.failure', { platform: 'meta', flow: 'community-ai', reason: 'no_state' });
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Missing OAuth state')}`);
  }

  let statePayload: { tenant_id?: string; organization_id?: string; redirect?: string };
  try {
    statePayload = decodeState(state);
  } catch {
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Invalid OAuth state')}`);
  }

  const tenantId = statePayload.tenant_id || '';
  const organizationId = statePayload.organization_id || '';
  const redirectTo = statePayload.redirect || '/community-ai/connectors';

  if (!tenantId || !organizationId || tenantId !== organizationId) {
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Invalid tenant scope')}`);
  }

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  const credentials = await getOAuthCredentialsForPlatform('meta');
  if (!credentials?.client_id || !credentials?.client_secret) {
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Meta OAuth not configured')}`);
  }

  const redirectUri = getCommunityAiConnectorCallbackUrl('meta', req);

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token?${new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: redirectUri,
        code,
      })}`,
      { method: 'GET' }
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('[meta/callback] token exchange failed:', tokenResponse.status, errText);
      return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Meta connection failed. Please try again.')}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Meta did not return an access token.')}`);
    }

    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // Verify token and get Meta identity
    let metaUserId: string | null = null;
    let metaName: string | null = null;
    const profileRes = await fetch(
      `https://graph.facebook.com/v22.0/me?fields=id,name&access_token=${tokenData.access_token}`
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      metaUserId = profile.id || null;
      metaName = profile.name || null;
    } else {
      console.warn('[meta/callback] profile fetch failed:', profileRes.status);
    }

    const tokenPayload = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
      connected_by_user_id: access.userId,
    };

    // Save to engagement layer (community_ai_platform_tokens)
    await Promise.all([
      saveToken(tenantId, organizationId, 'facebook', tokenPayload),
      saveToken(tenantId, organizationId, 'instagram', tokenPayload),
      saveToken(tenantId, organizationId, 'whatsapp', tokenPayload),
    ]);

    // Dual-write Facebook to publishing layer (social_accounts).
    // Instagram is intentionally NOT dual-written here â€” its row needs the IG
    // Business account ID as platform_user_id (not the FB user ID). The full
    // multi-row IG/Threads provisioning runs via meta_oauth_apply during the
    // /api/auth/facebook OAuth flow.
    const dualToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt || undefined,
      scope: typeof tokenData.scope === 'string' ? tokenData.scope : undefined,
    };
    const grantedScopesList = String(tokenData.scope || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await dualWriteSocialAccount({
      userId: access.userId,
      companyId: organizationId,
      platform: 'facebook',
      platformUserId: metaUserId,
      accountName: metaName,
      token: dualToken,
      permissions: grantedScopesList,
    });

    // IG/Threads social_accounts derivation is no longer performed here.
    // Users connect publishing accounts via the dedicated /api/auth/facebook
    // flow which calls meta_oauth_apply transactionally. This community-ai
    // connector handles only the engagement-layer token store.

    console.info('[connector_audit]', JSON.stringify({
      user_id: access.userId,
      company_id: organizationId,
      platform: 'meta',
      action: 'connect',
      meta_user_id: metaUserId,
      meta_name: metaName,
    }));
    logger.info('oauth.callback.success', { platform: 'meta', flow: 'community-ai', user_id: access.userId, organization_id: organizationId, meta_user_id: metaUserId });

    return res.redirect(`${redirectTo}?connected=meta&status=success`);
  } catch (err: any) {
    console.error('[meta/callback] error:', err?.message);
    logger.error('oauth.callback.failure', { platform: 'meta', flow: 'community-ai', reason: 'exception', error_message: err?.message ?? 'unknown' });
    return res.redirect(`/community-ai/connectors?error=${encodeURIComponent('Meta connection failed. Please try again.')}`);
  }
}

