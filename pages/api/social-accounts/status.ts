import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/social-accounts/status
 * Returns platform connection status for the current user (unauthenticated: shows
 * platform availability only, no user-specific connection data).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole, isPlatformSuperAdmin } from '@/backend/services/rbacService';
import { refreshExpiringSocialAccountsForCompany } from '@/backend/auth/tokenRefresh';
import { getOAuthCredentialsForPlatform } from '@/backend/auth/oauthCredentialResolver';

const SUPPORTED_PLATFORMS = [
  // Social media platforms
  { key: 'linkedin',       label: 'LinkedIn',       authPath: '/api/auth/linkedin',  category: 'social' },
  { key: 'x',              label: 'X',              authPath: '/api/auth/x',         category: 'social' },
  { key: 'youtube',        label: 'YouTube',        authPath: '/api/auth/youtube',   category: 'social' },
  { key: 'instagram',      label: 'Instagram',      authPath: '/api/auth/instagram', category: 'social' },
  { key: 'facebook',       label: 'Facebook',       authPath: '/api/auth/facebook',  category: 'social' },
  { key: 'whatsapp',       label: 'WhatsApp',       authPath: null,                  category: 'social' },
  { key: 'tiktok',         label: 'TikTok',         authPath: '/api/auth/tiktok',    category: 'social' },
  { key: 'pinterest',      label: 'Pinterest',      authPath: '/api/auth/pinterest', category: 'social' },
  { key: 'threads',        label: 'Threads',        authPath: '/api/auth/instagram', category: 'social' },
  { key: 'reddit',         label: 'Reddit',         authPath: '/api/community-ai/connectors/reddit/auth', category: 'social' },
  // Community platforms
  { key: 'github',         label: 'GitHub',         authPath: null,                  category: 'community' },
  { key: 'hackernews',     label: 'Hacker News',    authPath: null,                  category: 'community' },
  { key: 'discord',        label: 'Discord',        authPath: null,                  category: 'community' },
  { key: 'devto',          label: 'Dev.to',         authPath: null,                  category: 'community' },
  { key: 'medium',         label: 'Medium',         authPath: null,                  category: 'community' },
  { key: 'stackoverflow',  label: 'Stack Overflow', authPath: null,                  category: 'community' },
  { key: 'quora',          label: 'Quora',          authPath: null,                  category: 'community' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      // No company scope — check the canonical SUPER_ADMIN authority
      // (user_company_roles.role='SUPER_ADMIN'). The legacy `super_admins`
      // table that previously backed this check does not exist in the DB
      // and is removed in Phase 1 — see super-admin-unification-audit.
      try {
        if (await isPlatformSuperAdmin(userId)) userRole = 'SUPER_ADMIN';
      } catch (_) {}
    }
  }

  // Pre-flight: refresh any expiring/expired social_accounts tokens for this company
  // through the centralized token refresh service.
  // BEFORE we load and report status. Short-lived tokens (e.g. X — 2h expiry) would
  // otherwise show "Token Expired" on every dashboard load between sessions.
  if (userId && companyId && isValidUuid(companyId)) {
    try {
      await refreshExpiringSocialAccountsForCompany(companyId);
    } catch (e: any) {
      // Non-fatal — fall through and report stale state if refresh fails.
      console.warn('[social-accounts/status] proactive refresh failed:', e?.message);
    }
  }

  // Load user's connected accounts (only if authenticated)
  const accountMap: Record<string, any> = {};
  const inactiveAccountMap: Record<string, any> = {};

  if (userId) {
    const baseSelect = 'id, platform, account_name, username, is_active, token_expires_at, platform_user_id, company_id, access_token, refresh_status';

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
        const normalizedPlatform = acc.platform === 'twitter' ? 'x' : acc.platform;
        if (!accountMap[normalizedPlatform]) accountMap[normalizedPlatform] = acc;
      }

      const [{ data: inactiveScoped }, { data: inactiveLegacy }] = await Promise.all([
        supabase.from('social_accounts').select(baseSelect)
          .eq('user_id', userId).eq('is_active', false).eq('company_id', companyId)
          .eq('platform', 'threads')
          .not('platform_user_id', 'like', 'planning_%'),
        supabase.from('social_accounts').select(baseSelect)
          .eq('user_id', userId).eq('is_active', false).is('company_id', null)
          .eq('platform', 'threads')
          .not('platform_user_id', 'like', 'planning_%'),
      ]);
      for (const acc of [...(inactiveScoped || []), ...(inactiveLegacy || [])]) {
        if (!inactiveAccountMap.threads) inactiveAccountMap.threads = acc;
      }
    } else {
      const { data: accounts } = await supabase.from('social_accounts').select(baseSelect)
        .eq('user_id', userId).eq('is_active', true)
        .not('platform_user_id', 'like', 'planning_%');
      for (const acc of accounts || []) {
        const normalizedPlatform = acc.platform === 'twitter' ? 'x' : acc.platform;
        if (!accountMap[normalizedPlatform]) accountMap[normalizedPlatform] = acc;
      }

      const { data: inactiveAccounts } = await supabase.from('social_accounts').select(baseSelect)
        .eq('user_id', userId).eq('is_active', false)
        .eq('platform', 'threads')
        .not('platform_user_id', 'like', 'planning_%');
      for (const acc of inactiveAccounts || []) {
        if (!inactiveAccountMap.threads) inactiveAccountMap.threads = acc;
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
  if (configuredSet.has('facebook') || configuredSet.has('meta')) {
    configuredSet.add('facebook');
    configuredSet.add('instagram');
    configuredSet.add('whatsapp');
    configuredSet.add('threads');
  }
  configuredSet.add('threads');

  // Env-var fallback for backward compatibility
  const hasEnv = (key: string) => {
    const v = process.env[key];
    return v && v.trim() && !v.includes('your_');
  };
  if (hasEnv('LINKEDIN_CLIENT_ID')) configuredSet.add('linkedin');
  if (hasEnv('TWITTER_CLIENT_ID') || hasEnv('X_CLIENT_ID')) configuredSet.add('x');
  if (hasEnv('YOUTUBE_CLIENT_ID') || hasEnv('GOOGLE_CLIENT_ID')) configuredSet.add('youtube');
  // Facebook App covers facebook, instagram, whatsapp
  if (
    hasEnv('FACEBOOK_CLIENT_ID') ||
    hasEnv('FACEBOOK_APP_ID') ||
    hasEnv('META_CLIENT_ID') ||
    hasEnv('META_APP_ID')
  ) {
    configuredSet.add('facebook');
    configuredSet.add('instagram');
    configuredSet.add('whatsapp');
    configuredSet.add('threads');
  }
  if (hasEnv('TIKTOK_CLIENT_ID')) configuredSet.add('tiktok');
  if (hasEnv('PINTEREST_CLIENT_ID') || hasEnv('PINTEREST_APP_ID')) configuredSet.add('pinterest');
  if (hasEnv('REDDIT_CLIENT_ID')) configuredSet.add('reddit');

  // Final fallback: use the same resolver as /api/social-accounts/verify-config.
  // This keeps the Connect button in sync with credential verification, including
  // per-platform aliases and env names.
  await Promise.all(
    SUPPORTED_PLATFORMS
      .filter((p) => p.category === 'social' && !configuredSet.has(p.key))
      .map(async (p) => {
        const credentialKey = p.key === 'threads' ? 'instagram' : p.key;
        const creds = await getOAuthCredentialsForPlatform(credentialKey).catch(() => null);
        if (creds?.client_id && creds?.client_secret) configuredSet.add(p.key);
      })
  );

  const now = new Date().toISOString();

  // Provider-taxonomy normalization: Threads is a Meta-family sub-feature
  // that piggy-backs the Instagram OAuth handler (`authPath: '/api/auth/
  // instagram'`). Internally it remains a routable provider for SUPER_ADMIN
  // tooling, but Company Admin operators should not see it as a standalone
  // connect option — connecting Instagram already provisions Threads. Pure
  // response-layer filter: SUPPORTED_PLATFORMS is untouched, no DB rows
  // mutated, OAuth handlers and refresh helpers continue to support
  // platform='threads' for any internal/SUPER_ADMIN code path.
  const HIDE_FROM_COMPANY_ADMIN = new Set(['threads']);
  const isSuperAdminCaller = userRole === 'SUPER_ADMIN';
  const visiblePlatforms = isSuperAdminCaller
    ? SUPPORTED_PLATFORMS
    : SUPPORTED_PLATFORMS.filter((p) => !HIDE_FROM_COMPANY_ADMIN.has(p.key));

  const result = visiblePlatforms.map((p) => {
    const acc = accountMap[p.key] ?? null;
    const inactiveAcc = inactiveAccountMap[p.key] ?? null;
    const isThreads = p.key === 'threads';
    const connected = isThreads ? !!acc : !!acc?.access_token;
    const isExpired = acc?.token_expires_at && acc.token_expires_at < now;
    return {
      platform_key: p.key,
      platform_label: p.label,
      auth_path: p.authPath,
      category: p.category,
      oauth_configured: configuredSet.has(p.key),
      available: p.key === 'threads' ? true : configuredSet.has(p.key),
      connected,
      connection_status: connected ? 'connected' : inactiveAcc ? 'disconnected' : 'not_connected',
      expired: !!isExpired,
      // Canonical token-refresh health for publishing-permission evaluation:
      // 'success' | 'failed' | 'requires_reconnect' | null (unknown).
      refresh_status: (acc?.refresh_status ?? null) as string | null,
      account_name: acc?.account_name ?? inactiveAcc?.account_name ?? null,
      username: acc?.username ?? inactiveAcc?.username ?? null,
      token_expires_at: acc?.token_expires_at ?? inactiveAcc?.token_expires_at ?? null,
      social_account_id: acc?.id ?? inactiveAcc?.id ?? null,
    };
  });

  return res.status(200).json({ accounts: result, user_role: userRole });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/social-accounts/status' });
