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
    code_verifier?: string;
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

  let statePayload: {
    tenant_id?: string;
    organization_id?: string;
    redirect?: string;
    code_verifier?: string;
  };
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
  const codeVerifier = statePayload.code_verifier || '';

  if (!tenantId || !organizationId || tenantId !== organizationId) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Invalid tenant scope')}`
    );
  }

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent('Twitter OAuth not configured')}`
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  const redirectUri = `${baseUrl}/api/community-ai/connectors/twitter/callback`;

  try {
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return res.redirect(
        `/community-ai/connectors?error=${encodeURIComponent(
          `Twitter token exchange failed: ${errorText}`
        )}`
      );
    }

    const tokenData = await tokenResponse.json();
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await saveToken(tenantId, organizationId, 'twitter', {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
    });

    return res.redirect(`${redirectTo}?connected=twitter&status=success`);
  } catch (err: any) {
    return res.redirect(
      `/community-ai/connectors?error=${encodeURIComponent(err?.message || 'OAuth failed')}`
    );
  }
}
