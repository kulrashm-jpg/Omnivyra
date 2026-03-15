/**
 * Connector Token Refresh Service (G5.4)
 *
 * Background refresh of community_ai_platform_tokens before expiry.
 * Runs as scheduled job from cron. Uses platform-specific OAuth refresh flows.
 *
 * Env vars (per platform, same as Community AI connectors):
 * - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 * - FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET (or FACEBOOK_APP_ID, FACEBOOK_APP_SECRET)
 * - INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET (uses Facebook Graph)
 * - TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
 * - REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET
 */

import axios from 'axios';
import { supabase } from '../db/supabaseClient';
import { getToken, saveToken } from './platformTokenService';

const BUFFER_HOURS = 24; // Refresh if expiring within 24 hours
const PLATFORMS_WITH_REFRESH = ['linkedin', 'facebook', 'instagram', 'twitter', 'reddit', 'x'];

type TokenRow = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  const bufferMs = BUFFER_HOURS * 60 * 60 * 1000;
  return expires - Date.now() < bufferMs;
}

async function refreshLinkedIn(
  tenantId: string,
  orgId: string,
  currentToken: { access_token: string; refresh_token?: string | null }
): Promise<{ access_token: string; refresh_token?: string | null; expires_at: string } | null> {
  if (!currentToken.refresh_token) return null;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await axios.post(
    'https://www.linkedin.com/oauth/v2/accessToken',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentToken.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  if (!res.data?.access_token) return null;
  const expiresIn = res.data.expires_in || 5184000;
  return {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || currentToken.refresh_token,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

async function refreshTwitter(
  tenantId: string,
  orgId: string,
  currentToken: { access_token: string; refresh_token?: string | null }
): Promise<{ access_token: string; refresh_token?: string | null; expires_at: string } | null> {
  if (!currentToken.refresh_token) return null;
  const clientId = process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await axios.post(
    'https://api.twitter.com/2/oauth2/token',
    new URLSearchParams({
      refresh_token: currentToken.refresh_token,
      grant_type: 'refresh_token',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
    }
  );
  if (!res.data?.access_token) return null;
  const expiresIn = res.data.expires_in || 7200;
  return {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || currentToken.refresh_token,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

async function refreshFacebook(
  tenantId: string,
  orgId: string,
  currentToken: { access_token: string; refresh_token?: string | null }
): Promise<{ access_token: string; refresh_token?: string | null; expires_at: string } | null> {
  const appId = process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_CLIENT_SECRET || process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;

  try {
    const res = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken.access_token,
      },
    });
    if (!res.data?.access_token) {
      if (currentToken.refresh_token) {
        const r2 = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: currentToken.refresh_token,
          },
        });
        if (!r2.data?.access_token) return null;
        const exp = r2.data.expires_in || 5184000;
        return {
          access_token: r2.data.access_token,
          refresh_token: currentToken.refresh_token,
          expires_at: new Date(Date.now() + exp * 1000).toISOString(),
        };
      }
      return null;
    }
    const expiresIn = res.data.expires_in || 5184000;
    return {
      access_token: res.data.access_token,
      refresh_token: currentToken.refresh_token ?? null,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

async function refreshReddit(
  tenantId: string,
  orgId: string,
  currentToken: { access_token: string; refresh_token?: string | null }
): Promise<{ access_token: string; refresh_token?: string | null; expires_at: string } | null> {
  if (!currentToken.refresh_token) return null;
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await axios.post(
    'https://www.reddit.com/api/v1/access_token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentToken.refresh_token,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
        'User-Agent': 'community-ai/1.0',
      },
    }
  );
  if (!res.data?.access_token) return null;
  const expiresIn = res.data.expires_in || 3600;
  return {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || currentToken.refresh_token,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

async function refreshForPlatform(
  platform: string,
  tenantId: string,
  orgId: string,
  currentToken: { access_token: string; refresh_token?: string | null }
): Promise<{ access_token: string; refresh_token?: string | null; expires_at: string } | null> {
  const p = platform.toLowerCase().replace(/^x$/, 'twitter');
  switch (p) {
    case 'linkedin':
      return refreshLinkedIn(tenantId, orgId, currentToken);
    case 'twitter':
      return refreshTwitter(tenantId, orgId, currentToken);
    case 'facebook':
      return refreshFacebook(tenantId, orgId, currentToken);
    case 'instagram':
      return refreshFacebook(tenantId, orgId, currentToken); // Instagram uses Facebook Graph
    case 'reddit':
      return refreshReddit(tenantId, orgId, currentToken);
    default:
      return null;
  }
}

export type ConnectorTokenRefreshResult = {
  checked: number;
  refreshed: number;
  skipped: number;
  errors: number;
  details: { platform: string; org_id: string; status: 'refreshed' | 'skipped' | 'error' }[];
};

/**
 * Run connector token refresh for tokens expiring within BUFFER_HOURS.
 * Call from cron job (e.g. every 6 hours).
 */
export async function runConnectorTokenRefresh(): Promise<ConnectorTokenRefreshResult> {
  const result: ConnectorTokenRefreshResult = {
    checked: 0,
    refreshed: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  const { data: rows, error } = await supabase
    .from('community_ai_platform_tokens')
    .select('id, tenant_id, organization_id, platform, access_token, refresh_token, expires_at')
    .not('access_token', 'is', null)
    .in('platform', PLATFORMS_WITH_REFRESH);

  if (error) {
    console.error('[connectorTokenRefresh] Failed to fetch tokens:', error.message);
    return result;
  }

  const tokenRows = (rows ?? []) as TokenRow[];
  result.checked = tokenRows.length;

  for (const row of tokenRows) {
    const platform = (row.platform || '').toLowerCase();
    const tenantId = row.tenant_id;
    const orgId = row.organization_id;

    if (!isExpiringSoon(row.expires_at)) {
      result.skipped++;
      result.details.push({ platform, org_id: orgId, status: 'skipped' });
      continue;
    }

    try {
      const tokenObj = await getToken(tenantId, orgId, platform);
      if (!tokenObj?.access_token) {
        result.errors++;
        result.details.push({ platform, org_id: orgId, status: 'error' });
        continue;
      }

      const refreshed = await refreshForPlatform(
        platform,
        tenantId,
        orgId,
        {
          access_token: tokenObj.access_token,
          refresh_token: tokenObj.refresh_token ?? undefined,
        }
      );

      if (!refreshed) {
        result.errors++;
        result.details.push({ platform, org_id: orgId, status: 'error' });
        continue;
      }

      await saveToken(tenantId, orgId, platform, {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? null,
        expires_at: refreshed.expires_at,
      });
      result.refreshed++;
      result.details.push({ platform, org_id: orgId, status: 'refreshed' });
      console.info(
        `[connectorTokenRefresh] refreshed ${platform} for org ${orgId}`
      );
    } catch (err: any) {
      result.errors++;
      result.details.push({ platform, org_id: orgId, status: 'error' });
      console.warn(`[connectorTokenRefresh] ${platform} org=${orgId}:`, err?.message);
    }
  }

  return result;
}
