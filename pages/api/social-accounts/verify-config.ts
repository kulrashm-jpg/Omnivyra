/**
 * GET /api/social-accounts/verify-config?platform=linkedin
 *
 * Verifies a platform's OAuth configuration by:
 * 1. Checking credentials exist.
 * 2. Finding a connected account to test.
 * 3. Running a live token check when the platform supports it.
 *
 * Super admin session (cookie) picks up any active account across all users.
 * Regular users test their own account only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { resolveUserContext } from '@/backend/services/userContextService';
import { getOAuthCredentialsForPlatform } from '@/backend/auth/oauthCredentialResolver';
import { refreshTwitterTokenIfNeeded } from '@/backend/auth/tokenRefresh';
import { getToken } from '@/backend/auth/tokenStore';
import { getPlatformAdapter } from '@/backend/services/platformAdapters';
import { bearerAuthorization } from '@/lib/httpAuthHeaders';

type TokenTestResult = {
  ok: boolean | null;
  detail: string;
  live_check_supported: boolean;
};

function supportsLiveTokenCheck(platform: string): boolean {
  return ['linkedin', 'x', 'youtube', 'instagram', 'facebook', 'reddit'].includes(platform);
}

function getPlatformAliases(platform: string): string[] {
  if (platform === 'x' || platform === 'twitter') return ['x', 'twitter'];
  return [platform];
}

async function testToken(platform: string, accessToken: string): Promise<TokenTestResult> {
  try {
    switch (platform) {
      case 'linkedin': {
        const response = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: bearerAuthorization(accessToken) },
        });
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return {
            ok: true,
            detail: `Token valid - ${body.name || body.email || 'connected'}`,
            live_check_supported: true,
          };
        }
        return {
          ok: false,
          detail: `LinkedIn returned ${response.status} - token invalid or expired`,
          live_check_supported: true,
        };
      }
      case 'twitter':
      case 'x': {
        const response = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: bearerAuthorization(accessToken) },
        });
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return {
            ok: true,
            detail: `Token valid - @${body.data?.username || 'connected'}`,
            live_check_supported: true,
          };
        }
        if (response.status === 401) {
          return {
            ok: false,
            detail: 'Token invalid or revoked',
            live_check_supported: true,
          };
        }
        return {
          ok: false,
          detail: 'Temporary error',
          live_check_supported: true,
        };
      }
      case 'youtube': {
        const response = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
          { headers: { Authorization: bearerAuthorization(accessToken) } }
        );
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          const name = body.items?.[0]?.snippet?.title;
          return {
            ok: true,
            detail: `Token valid${name ? ` - ${name}` : ''}`,
            live_check_supported: true,
          };
        }
        return {
          ok: false,
          detail: `YouTube returned ${response.status} - token invalid or expired`,
          live_check_supported: true,
        };
      }
      case 'instagram':
      case 'facebook': {
        const response = await fetch(`https://graph.facebook.com/v22.0/me?fields=id,name&access_token=${accessToken}`);
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return {
            ok: true,
            detail: `Token valid - ${body.name || 'connected'}`,
            live_check_supported: true,
          };
        }
        return {
          ok: false,
          detail: `Meta returned ${response.status} - token invalid or expired`,
          live_check_supported: true,
        };
      }
      case 'reddit': {
        const response = await fetch('https://oauth.reddit.com/api/v1/me', {
          headers: {
            Authorization: bearerAuthorization(accessToken),
            'User-Agent': 'Virality/1.0',
          },
        });
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          return {
            ok: true,
            detail: `Token valid - u/${body.name || 'connected'}`,
            live_check_supported: true,
          };
        }
        return {
          ok: false,
          detail: `Reddit returned ${response.status} - token invalid or expired`,
          live_check_supported: true,
        };
      }
      default:
        break;
    }
  } catch (error: any) {
    return {
      ok: false,
      detail: platform === 'x' || platform === 'twitter'
        ? 'Temporary error'
        : `Network error: ${error?.message || 'Unknown error'}`,
      live_check_supported: supportsLiveTokenCheck(platform),
    };
  }

  const adapter = getPlatformAdapter(platform);
  if (adapter?.testConnection) {
    try {
      const result = await adapter.testConnection({ access_token: accessToken });
      return {
        ok: result.success,
        detail: result.success
          ? (result.message || 'Connection test passed')
          : (result.error || 'Connection test failed'),
        live_check_supported: true,
      };
    } catch (error: any) {
      return {
        ok: false,
        detail: error?.message || 'Connection test failed',
        live_check_supported: true,
      };
    }
  }

  return {
    ok: null,
    detail: 'Live token check is not implemented for this platform yet',
    live_check_supported: false,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase().trim() : '';
  if (!platform) {
    return res.status(400).json({ error: 'platform required' });
  }

  const checked_at = new Date().toISOString();
  const credentialPlatform = platform === 'threads' ? 'instagram' : platform;
  const creds = await getOAuthCredentialsForPlatform(credentialPlatform).catch(() => null);
  const credentials_ok = !!(creds?.client_id && creds?.client_secret);
  const credentials_source = creds?.source ?? null;

  let token_ok: boolean | null = null;
  let token_detail: string | null = null;
  let account_name: string | null = null;
  let live_check_supported = supportsLiveTokenCheck(platform);

  // Token live-check is scoped to the CALLER'S OWN COMPANY (the canonical
  // tenant boundary). company_id — NOT user_id — is the owning-tenant field
  // for social_accounts (publishProcessor: "social_accounts.company_id IS the
  // canonical owning tenant"). A connection is connected by ONE Company Admin
  // (user_id) but BELONGS to the company; a Super Admin shares the company yet
  // is rarely the connector, so a user_id filter found nothing for them while
  // hiding valid company connections. Scoping by the caller's active
  // companyIds:
  //   • Super Admin sees their own company's connections (X/YT/FB/IG) and a
  //     valid live-check, without owning the row themselves.
  //   • Company Admin sees the same rows as before (they ARE the connector),
  //     so no behaviour change.
  //   • Another tenant's account (different company_id — e.g. a LinkedIn row
  //     in Company B) is never selected, never named, never token-tested.
  // This is strict same-tenant scoping: there is NO cross-tenant fallback and
  // NO "borrow any active account" path.
  const userContext = await resolveUserContext(req).catch(() => null);
  const companyIds = userContext?.companyIds ?? [];
  const platformAliases = getPlatformAliases(platform);

  let accountId: string | null = null;

  if (companyIds.length > 0) {
    // Order by updated_at desc so a fresh reconnect (which bumps updated_at)
    // wins over any legacy duplicate row — e.g. an old platform='twitter' row
    // alongside the new platform='x' row. Without this, the unordered query
    // could pick the stale row and test its expired token, making the badge
    // read "Token invalid" indefinitely after a successful reconnect. This is
    // an intra-company tiebreak only — the .in('company_id', …) filter keeps
    // selection strictly within the caller's own tenant(s).
    const { data: account } = await supabase
      .from('social_accounts')
      .select('id, account_name, username')
      .in('company_id', companyIds)
      .in('platform', platformAliases)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (account?.id) {
      accountId = account.id;
      account_name = account.account_name || account.username || null;
    }
  }

  if (accountId) {
    const tokenObj = await getToken(accountId).catch(() => null);
    if (tokenObj?.access_token) {
      if (platform === 'threads') {
        return res.status(200).json({
          platform,
          credentials_ok,
          credentials_source,
          token_ok: true,
          token_detail: account_name
            ? `Threads token stored - ${account_name}`
            : 'Threads token stored',
          account_name,
          live_check_supported: false,
          checked_at,
        });
      }

      let tokenForValidation = tokenObj;
      if (platform === 'x' || platform === 'twitter') {
        const refreshResult = await refreshTwitterTokenIfNeeded({
          account_id: accountId,
          access_token: tokenObj.access_token,
          refresh_token: tokenObj.refresh_token ?? null,
          token_expires_at: tokenObj.expires_at ?? null,
        });

        if (refreshResult.status === 'requires_reconnect') {
          token_ok = false;
          // Pull the persisted error reason so the admin sees the X error
          // class (e.g. invalid_grant) instead of a generic message.
          const { data: telemetryRow } = await supabase
            .from('social_accounts')
            .select('last_refresh_error')
            .eq('id', accountId)
            .maybeSingle();
          const reason = telemetryRow?.last_refresh_error;
          token_detail = reason ? `Reconnect required: ${reason}` : 'Reconnect required';
          live_check_supported = true;
        } else if (refreshResult.status === 'refresh_failed') {
          token_ok = false;
          const { data: telemetryRow } = await supabase
            .from('social_accounts')
            .select('last_refresh_error')
            .eq('id', accountId)
            .maybeSingle();
          const reason = telemetryRow?.last_refresh_error;
          token_detail = reason ? `refresh_failed: ${reason}` : 'refresh_failed';
          live_check_supported = true;
        } else if (refreshResult.access_token) {
          tokenForValidation = {
            ...tokenObj,
            access_token: refreshResult.access_token,
            refresh_token: refreshResult.refresh_token ?? tokenObj.refresh_token,
            expires_at: refreshResult.token_expires_at ?? tokenObj.expires_at,
          };
        }
      }

      if (token_ok === false && (token_detail === 'Reconnect required' || token_detail === 'refresh_failed')) {
        // Expired X tokens without a usable refresh token cannot be validated.
      } else {
        const result = await testToken(platform, tokenForValidation.access_token);
        token_ok = result.ok;
        token_detail = result.detail;
        live_check_supported = result.live_check_supported;
      }
    } else {
      token_ok = false;
      token_detail = 'No token stored - reconnect account';
    }
  } else {
    // Note: the previous "connector-originated org token" fallback was removed
    // when community_ai_platform_tokens stopped storing tokens. There is now
    // only one token source — social_accounts — and if no row was found above,
    // there is no token to verify.
    token_detail = credentials_ok
      ? live_check_supported
        ? 'No connected account found - connect an account to test live'
        : 'Live verification is not implemented for this platform yet'
      : null;
  }

  return res.status(200).json({
    platform,
    credentials_ok,
    credentials_source,
    token_ok,
    token_detail,
    account_name,
    live_check_supported,
    checked_at,
  });
}
