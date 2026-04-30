import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { dualWriteSocialAccount } from '../../../../../backend/auth/tokenStore';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';

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
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(String(message || 'OAuth failed'))}`
    );
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing authorization code')}`
    );
  }

  if (!state || typeof state !== 'string') {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Missing OAuth state')}`
    );
  }

  let statePayload: { tenant_id?: string; organization_id?: string; redirect?: string };
  try {
    statePayload = decodeState(state);
  } catch (err: any) {
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
      return res.redirect(
        `/community-ai/connectors?error=${encodeURIComponent('Connection failed. Please try again.')}`
      );
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
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

    return res.redirect(
      `${redirectTo}?connected=linkedin&status=success`
    );
  } catch (err: any) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Connection failed. Please try again.')}`
    );
  }
}
