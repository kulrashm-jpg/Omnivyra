/**
 * GET /api/social-accounts/status
 * Returns platform connection status for the current user (unauthenticated: shows
 * platform availability only, no user-specific connection data).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';

const SUPPORTED_PLATFORMS = [
  { key: 'linkedin',  label: 'LinkedIn',     authPath: '/api/auth/linkedin' },
  { key: 'twitter',   label: 'X (Twitter)',  authPath: '/api/auth/twitter' },
  { key: 'youtube',   label: 'YouTube',      authPath: '/api/auth/youtube' },
  { key: 'instagram', label: 'Instagram',    authPath: '/api/auth/instagram' },
  { key: 'facebook',  label: 'Facebook',     authPath: null },
  { key: 'tiktok',    label: 'TikTok',       authPath: null },
  { key: 'pinterest', label: 'Pinterest',    authPath: null },
  { key: 'reddit',    label: 'Reddit',       authPath: null },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Try to get user — not required, just shows connection status if available
  const { user } = await getSupabaseUserFromRequest(req).catch(() => ({ user: null, error: 'err' }));
  const userId = user?.id ?? null;

  // Load user's connected accounts (only if authenticated)
  const accountMap: Record<string, any> = {};
  if (userId) {
    const { data: accounts } = await supabase
      .from('social_accounts')
      .select('id, platform, account_name, username, is_active, token_expires_at, platform_user_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%');

    for (const acc of accounts || []) {
      if (!accountMap[acc.platform]) accountMap[acc.platform] = acc;
    }
  }

  // Load which platforms have OAuth configured by super admin
  const { data: configs } = await supabase
    .from('platform_oauth_configs')
    .select('platform, enabled')
    .eq('enabled', true);

  const configuredSet = new Set((configs || []).map((r: any) => r.platform));

  // Env-var fallback for backward compatibility
  const envFallbacks: (string | null)[] = [
    process.env.LINKEDIN_CLIENT_ID && !String(process.env.LINKEDIN_CLIENT_ID).includes('your_') ? 'linkedin' : null,
    process.env.TWITTER_CLIENT_ID && !String(process.env.TWITTER_CLIENT_ID).includes('your_') ? 'twitter' : null,
    (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) ? 'youtube' : null,
    process.env.INSTAGRAM_CLIENT_ID && !String(process.env.INSTAGRAM_CLIENT_ID).includes('your_') ? 'instagram' : null,
  ];
  envFallbacks.forEach((p) => p && configuredSet.add(p));

  const now = new Date().toISOString();

  const result = SUPPORTED_PLATFORMS.map((p) => {
    const acc = accountMap[p.key];
    const isExpired = acc?.token_expires_at && acc.token_expires_at < now;
    return {
      platform_key: p.key,
      platform_label: p.label,
      auth_path: p.authPath,
      oauth_configured: configuredSet.has(p.key),
      connected: !!acc,
      expired: !!isExpired,
      account_name: acc?.account_name ?? null,
      username: acc?.username ?? null,
      token_expires_at: acc?.token_expires_at ?? null,
      social_account_id: acc?.id ?? null,
    };
  });

  return res.status(200).json({ accounts: result });
}
