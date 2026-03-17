/**
 * GET /api/social-accounts/status
 * Returns platform connection status for the current user (unauthenticated: shows
 * platform availability only, no user-specific connection data).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole } from '@/backend/services/rbacService';

const SUPPORTED_PLATFORMS = [
  // Social media platforms
  { key: 'linkedin',       label: 'LinkedIn',       authPath: '/api/auth/linkedin',  category: 'social' },
  { key: 'twitter',        label: 'X (Twitter)',    authPath: '/api/auth/twitter',   category: 'social' },
  { key: 'youtube',        label: 'YouTube',        authPath: '/api/auth/youtube',   category: 'social' },
  { key: 'instagram',      label: 'Instagram',      authPath: '/api/auth/instagram', category: 'social' },
  { key: 'facebook',       label: 'Facebook',       authPath: null,                  category: 'social' },
  { key: 'whatsapp',       label: 'WhatsApp',       authPath: null,                  category: 'social' },
  { key: 'tiktok',         label: 'TikTok',         authPath: null,                  category: 'social' },
  { key: 'pinterest',      label: 'Pinterest',      authPath: null,                  category: 'social' },
  { key: 'reddit',         label: 'Reddit',         authPath: null,                  category: 'social' },
  // Community platforms
  { key: 'github',         label: 'GitHub',         authPath: null,                  category: 'community' },
  { key: 'hackernews',     label: 'Hacker News',    authPath: null,                  category: 'community' },
  { key: 'discord',        label: 'Discord',        authPath: null,                  category: 'community' },
  { key: 'devto',          label: 'Dev.to',         authPath: null,                  category: 'community' },
  { key: 'medium',         label: 'Medium',         authPath: null,                  category: 'community' },
  { key: 'stackoverflow',  label: 'Stack Overflow', authPath: null,                  category: 'community' },
  { key: 'quora',          label: 'Quora',          authPath: null,                  category: 'community' },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Try to get user — not required, just shows connection status if available
  const { user } = await getSupabaseUserFromRequest(req).catch(() => ({ user: null, error: 'err' }));
  const userId = user?.id ?? null;
  const companyId = (req.query.companyId as string) || null;
  const isValidUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // Resolve user role so UI can hide super-admin-only labels from company admins
  let userRole: string | null = null;
  if (userId) {
    if (companyId && isValidUuid(companyId)) {
      const { role } = await getUserRole(userId, companyId).catch(() => ({ role: null, error: '' }));
      userRole = role ?? null;
    } else {
      // No company scope — check if platform super admin
      try {
        const { data: sa } = await supabase
          .from('super_admins').select('id').eq('user_id', userId).limit(1).maybeSingle();
        if (sa) userRole = 'SUPER_ADMIN';
      } catch (_) {}
    }
  }

  // Load user's connected accounts (only if authenticated)
  const accountMap: Record<string, any> = {};

  if (userId) {
    const baseSelect = 'id, platform, account_name, username, is_active, token_expires_at, platform_user_id, company_id';

    if (companyId && isValidUuid(companyId)) {
      // Company-scoped accounts — two typed queries to avoid text=uuid cast error
      const [{ data: scopedAccounts }, { data: legacyAccounts }] = await Promise.all([
        supabase.from('social_accounts').select(baseSelect)
          .eq('user_id', userId).eq('is_active', true).eq('company_id', companyId)
          .not('platform_user_id', 'like', 'planning_%'),
        supabase.from('social_accounts').select(baseSelect)
          .eq('user_id', userId).eq('is_active', true).is('company_id', null)
          .not('platform_user_id', 'like', 'planning_%'),
      ]);
      for (const acc of [...(scopedAccounts || []), ...(legacyAccounts || [])]) {
        if (!accountMap[acc.platform]) accountMap[acc.platform] = acc;
      }
    } else {
      const { data: accounts } = await supabase.from('social_accounts').select(baseSelect)
        .eq('user_id', userId).eq('is_active', true)
        .not('platform_user_id', 'like', 'planning_%');
      for (const acc of accounts || []) {
        if (!accountMap[acc.platform]) accountMap[acc.platform] = acc;
      }
    }
  }

  // Load which platforms have OAuth credentials configured (enabled OR just has credentials)
  // We use credentials_exist as "configured" so company admins can see all platforms the
  // super admin has set up credentials for, regardless of the enabled toggle.
  const { data: configs } = await supabase
    .from('platform_oauth_configs')
    .select('platform, enabled, oauth_client_id_encrypted')
    .not('oauth_client_id_encrypted', 'is', null);

  const configuredSet = new Set((configs || []).map((r: any) => r.platform));

  // Env-var fallback for backward compatibility
  const hasEnv = (key: string) => {
    const v = process.env[key];
    return v && v.trim() && !v.includes('your_');
  };
  if (hasEnv('LINKEDIN_CLIENT_ID')) configuredSet.add('linkedin');
  if (hasEnv('TWITTER_CLIENT_ID')) configuredSet.add('twitter');
  if (hasEnv('YOUTUBE_CLIENT_ID') || hasEnv('GOOGLE_CLIENT_ID')) configuredSet.add('youtube');
  // Facebook App covers facebook, instagram, whatsapp
  if (hasEnv('FACEBOOK_CLIENT_ID')) {
    configuredSet.add('facebook');
    configuredSet.add('instagram');
    configuredSet.add('whatsapp');
  }

  const now = new Date().toISOString();

  const result = SUPPORTED_PLATFORMS.map((p) => {
    const acc = accountMap[p.key];
    const isExpired = acc?.token_expires_at && acc.token_expires_at < now;
    return {
      platform_key: p.key,
      platform_label: p.label,
      auth_path: p.authPath,
      category: p.category,
      oauth_configured: configuredSet.has(p.key),
      connected: !!acc,
      expired: !!isExpired,
      account_name: acc?.account_name ?? null,
      username: acc?.username ?? null,
      token_expires_at: acc?.token_expires_at ?? null,
      social_account_id: acc?.id ?? null,
    };
  });

  return res.status(200).json({ accounts: result, user_role: userRole });
}
