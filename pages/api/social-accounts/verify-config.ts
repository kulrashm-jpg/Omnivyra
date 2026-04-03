
/**
 * GET /api/social-accounts/verify-config?platform=linkedin
 *
 * Verifies a platform's OAuth configuration by:
 *   1. Checking credentials exist (client_id + client_secret configured)
 *   2. Finding any active connected account for that platform
 *   3. Making a real live API call to the platform to confirm the token works
 *
 * Super admin session (cookie) picks up any active account across all users.
 * Regular users test their own account only.
 *
 * Returns:
 *   { platform, credentials_ok, token_ok, token_detail, account_name, checked_at }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getOAuthCredentialsForPlatform } from '@/backend/auth/oauthCredentialResolver';
import { getToken } from '@/backend/auth/tokenStore';

async function testToken(platform: string, accessToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    switch (platform) {
      case 'linkedin': {
        const r = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          return { ok: true, detail: `Token valid — ${body.name || body.email || 'connected'}` };
        }
        return { ok: false, detail: `LinkedIn returned ${r.status} — token invalid or expired` };
      }
      case 'twitter':
      case 'x': {
        const r = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          return { ok: true, detail: `Token valid — @${body.data?.username || 'connected'}` };
        }
        return { ok: false, detail: `Twitter returned ${r.status} — token invalid or expired` };
      }
      case 'youtube': {
        const r = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          const name = body.items?.[0]?.snippet?.title;
          return { ok: true, detail: `Token valid${name ? ` — ${name}` : ''}` };
        }
        return { ok: false, detail: `YouTube returned ${r.status} — token invalid or expired` };
      }
      case 'instagram':
      case 'facebook': {
        const r = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${accessToken}`);
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          return { ok: true, detail: `Token valid — ${body.name || 'connected'}` };
        }
        return { ok: false, detail: `Meta returned ${r.status} — token invalid or expired` };
      }
      case 'reddit': {
        const r = await fetch('https://oauth.reddit.com/api/v1/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'Virality/1.0',
          },
        });
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          return { ok: true, detail: `Token valid — u/${body.name || 'connected'}` };
        }
        return { ok: false, detail: `Reddit returned ${r.status} — token invalid or expired` };
      }
      default:
        return { ok: true, detail: 'Live token check not yet implemented for this platform' };
    }
  } catch (e: any) {
    return { ok: false, detail: `Network error: ${e?.message}` };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const platform = typeof req.query.platform === 'string' ? req.query.platform.toLowerCase().trim() : '';
  if (!platform) return res.status(400).json({ error: 'platform required' });

  const checked_at = new Date().toISOString();

  // 1. Credentials check — does the config exist (DB or env)?
  const creds = await getOAuthCredentialsForPlatform(platform).catch(() => null);
  const credentials_ok = !!(creds?.client_id && creds?.client_secret);
  const credentials_source = creds?.source ?? null; // 'platform_config' (DB) | 'env' | null

  let token_ok: boolean | null = null;
  let token_detail: string | null = null;
  let account_name: string | null = null;

  // 2. Find an account to test against.
  //    Super admin (cookie session) → any active account across all users for this platform.
  //    Regular Supabase user        → their own account only.
  const isSuperAdmin = req.cookies?.super_admin_session === '1';
  const { user } = await getSupabaseUserFromRequest(req).catch(() => ({ user: null, error: '' }));

  let accountId: string | null = null;

  if (isSuperAdmin) {
    // Pick the most recently active account for this platform across all users
    const { data: account } = await supabase
      .from('social_accounts')
      .select('id, account_name, username')
      .eq('platform', platform)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (account?.id) {
      accountId = account.id;
      account_name = account.account_name || account.username || null;
    }
  } else if (user?.id) {
    const { data: account } = await supabase
      .from('social_accounts')
      .select('id, account_name, username')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%')
      .limit(1)
      .maybeSingle();
    if (account?.id) {
      accountId = account.id;
      account_name = account.account_name || account.username || null;
    }
  }

  // 3. Test the token with a real API call
  if (accountId) {
    const tokenObj = await getToken(accountId).catch(() => null);
    if (tokenObj?.access_token) {
      const result = await testToken(platform, tokenObj.access_token);
      token_ok = result.ok;
      token_detail = result.detail;
    } else {
      token_ok = false;
      token_detail = 'No token stored — reconnect account';
    }
  } else {
    token_detail = credentials_ok
      ? 'No connected account found — connect an account to test live'
      : null;
  }

  return res.status(200).json({
    platform,
    credentials_ok,
    credentials_source,
    token_ok,
    token_detail,
    account_name,
    checked_at,
  });
}
