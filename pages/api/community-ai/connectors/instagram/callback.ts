import type { NextApiRequest, NextApiResponse } from 'next';
import { saveToken } from '../../../../../backend/services/platformTokenService';
import { requireManageConnectors } from '../utils';

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

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Instagram OAuth not configured')}`
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  const redirectUri = `${baseUrl}/api/community-ai/connectors/instagram/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  try {
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`,
      { method: 'GET' }
    );
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return res.redirect(
        `/community-ai/connectors?error=${encodeURIComponent(
          `Instagram token exchange failed: ${errorText}`
        )}`
      );
    }

    const tokenData = await tokenResponse.json();
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await saveToken(tenantId, organizationId, 'instagram', {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
    });

    return res.redirect(`${redirectTo}?connected=instagram&status=success`);
  } catch (err: any) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(err?.message || 'OAuth failed')}`
    );
  }
}
