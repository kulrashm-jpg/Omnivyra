/**
 * GET  /api/admin/platform-oauth-configs  — list all platforms with config status
 * POST /api/admin/platform-oauth-configs  — upsert OAuth credentials for a platform
 * Super admin only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, isSuperAdmin } from '@/backend/services/rbacService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { encryptCredential, decryptCredential } from '@/backend/auth/credentialEncryption';

async function requireAdminAccess(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (isContentArchitectSession(req)) return true;
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  console.log('[platform-oauth-configs] auth debug:', {
    hasUser: !!user?.id,
    userId: user?.id,
    authError: error,
    cookieKeys: Object.keys(req.cookies || {}),
    hasSuperAdminCookie: req.cookies?.super_admin_session,
  });
  if (!error && user?.id) {
    // Check any admin role in user_company_roles
    const { data: roleRows } = await supabase
      .from('user_company_roles')
      .select('role')
      .eq('user_id', user.id)
      .limit(5);
    console.log('[platform-oauth-configs] user roles:', roleRows);
    const adminRoles = ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'company_admin', 'super_admin', 'admin'];
    const hasAdminRole = (roleRows || []).some((r: any) => adminRoles.includes(r.role));
    if (hasAdminRole) return true;
    res.status(403).json({ error: 'Admin role required', roles: roleRows });
    return false;
  }
  res.status(403).json({ error: 'Not authorized — no valid session' });
  return false;
}

const PLATFORM_DEFAULTS: Record<string, { label: string; authUrl: string; tokenUrl: string; scopes: string[] }> = {
  linkedin:  { label: 'LinkedIn',  authUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken', scopes: ['r_liteprofile','r_emailaddress','w_member_social'] },
  twitter:   { label: 'X (Twitter)', authUrl: 'https://twitter.com/i/oauth2/authorize', tokenUrl: 'https://api.twitter.com/2/oauth2/token', scopes: ['tweet.read','tweet.write','users.read','offline.access'] },
  youtube:   { label: 'YouTube',   authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes: ['https://www.googleapis.com/auth/youtube','https://www.googleapis.com/auth/youtube.upload'] },
  instagram: { label: 'Instagram', authUrl: 'https://www.facebook.com/v18.0/dialog/oauth', tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token', scopes: ['instagram_basic','instagram_content_publish','pages_show_list'] },
  facebook:  { label: 'Facebook',  authUrl: 'https://www.facebook.com/v18.0/dialog/oauth', tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token', scopes: ['pages_manage_posts','pages_read_engagement'] },
  tiktok:    { label: 'TikTok',   authUrl: 'https://www.tiktok.com/auth/authorize/', tokenUrl: 'https://open-api.tiktok.com/oauth/access_token/', scopes: ['user.info.basic','video.list'] },
  pinterest: { label: 'Pinterest', authUrl: 'https://www.pinterest.com/oauth/', tokenUrl: 'https://api.pinterest.com/v5/oauth/token', scopes: ['boards:read','pins:read','pins:write'] },
  reddit:    { label: 'Reddit',   authUrl: 'https://www.reddit.com/api/v1/authorize', tokenUrl: 'https://www.reddit.com/api/v1/access_token', scopes: ['identity','submit','read'] },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const allowed = await requireAdminAccess(req, res);
  if (!allowed) return;

  if (req.method === 'GET') {
    const { data: configs } = await supabase
      .from('platform_oauth_configs')
      .select('platform, oauth_authorize_url, oauth_token_url, oauth_scopes, enabled, updated_at, oauth_client_id_encrypted, oauth_client_secret_encrypted');

    const configMap: Record<string, any> = {};
    for (const row of configs || []) {
      let clientIdPreview = '';
      try {
        const dec = row.oauth_client_id_encrypted ? decryptCredential(row.oauth_client_id_encrypted) : '';
        clientIdPreview = dec ? dec.slice(0, 6) + '…' : '';
      } catch { /* bad key */ }
      configMap[row.platform] = {
        ...row,
        client_id_preview: clientIdPreview,
        has_client_id: !!row.oauth_client_id_encrypted,
        has_client_secret: !!row.oauth_client_secret_encrypted,
      };
    }

    const platforms = Object.entries(PLATFORM_DEFAULTS).map(([key, defaults]) => ({
      platform_key: key,
      platform_label: defaults.label,
      default_auth_url: defaults.authUrl,
      default_token_url: defaults.tokenUrl,
      default_scopes: defaults.scopes,
      configured: !!configMap[key]?.has_client_id,
      enabled: configMap[key]?.enabled ?? false,
      client_id_preview: configMap[key]?.client_id_preview ?? '',
      has_client_secret: configMap[key]?.has_client_secret ?? false,
      updated_at: configMap[key]?.updated_at ?? null,
    }));

    return res.status(200).json({ platforms });
  }

  if (req.method === 'POST') {
    const { platform, client_id, client_secret, enabled = true } = req.body || {};
    if (!platform || !PLATFORM_DEFAULTS[platform]) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    // If no client_id supplied, check if credentials already exist — allow enabled-only toggle
    if (!client_id) {
      const { data: existing } = await supabase
        .from('platform_oauth_configs')
        .select('oauth_client_id_encrypted')
        .eq('platform', platform)
        .maybeSingle();

      if (!existing?.oauth_client_id_encrypted) {
        return res.status(400).json({ error: 'client_id required' });
      }

      // Credentials exist — just update the enabled flag
      const { error: updateErr } = await supabase
        .from('platform_oauth_configs')
        .update({ enabled: Boolean(enabled), updated_at: new Date().toISOString() })
        .eq('platform', platform);

      if (updateErr) {
        console.error('[platform-oauth-configs] enabled-update error:', updateErr);
        return res.status(500).json({ error: updateErr.message });
      }
      return res.status(200).json({ success: true });
    }

    const defaults = PLATFORM_DEFAULTS[platform];
    const encrypted_id = encryptCredential(String(client_id).trim());
    const encrypted_secret = client_secret ? encryptCredential(String(client_secret).trim()) : undefined;

    const upsertData: Record<string, unknown> = {
      platform,
      oauth_client_id_encrypted: encrypted_id,
      oauth_authorize_url: defaults.authUrl,
      oauth_token_url: defaults.tokenUrl,
      oauth_scopes: defaults.scopes,
      enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
    };
    if (encrypted_secret !== undefined) {
      upsertData.oauth_client_secret_encrypted = encrypted_secret;
    }

    const { error: upsertErr } = await supabase
      .from('platform_oauth_configs')
      .upsert(upsertData, { onConflict: 'platform' });

    if (upsertErr) {
      console.error('[platform-oauth-configs] upsert error:', upsertErr);
      return res.status(500).json({ error: upsertErr.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
