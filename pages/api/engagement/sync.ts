import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

function readBody(req: NextApiRequest): Record<string, unknown> {
  return req.method === 'GET'
    ? (req.query as Record<string, unknown>)
    : ((req.body || {}) as Record<string, unknown>);
}

function clampWindowDays(value: unknown): number {
  const parsed = Number(value ?? 7);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, Math.floor(parsed)));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // The Omnivyra Chrome extension fires this endpoint on every Facebook page
  // load, including when the user is not signed in to Omnivyra. Without this
  // guard, resolveUserContext falls back to a dev-only context and the
  // downstream enforceCompanyAccess crashes with a 500. Return 401 cleanly
  // so the extension can no-op instead of spamming the error log.
  const { user: authedUser } = await getSupabaseUserFromRequest(req);
  if (!authedUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const user = await resolveUserContext(req);
  const input = readBody(req);
  const organizationId = String(input.organization_id ?? input.organizationId ?? user.defaultCompanyId ?? '').trim();
  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'organization_id required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  const windowDays = clampWindowDays(input.window_days ?? input.windowDays);
  const until = new Date();
  const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : null;

  // Facebook auth precheck â€” when sync targets Facebook (or is unfiltered)
  // verify a usable Page Access Token is stored. The publish/fetch path uses
  // social_accounts.page_access_token directly; never /me/accounts at runtime.
  if (platform === null || platform === 'facebook') {
    const { data: fbRow, error: fbErr } = await supabase
      .from('social_accounts')
      .select('id, platform_user_id, page_access_token, is_active, meta_connection_id')
      .eq('company_id', organizationId)
      .eq('platform', 'facebook')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fbErr) {
      return res.status(500).json({ success: false, error: fbErr.message });
    }

    if (!fbRow || !fbRow.page_access_token) {
      return res.status(400).json({
        success: false,
        error: 'NO_PAGE_TOKEN',
        platform: 'facebook',
        organization_id: organizationId,
      });
    }

    return res.status(200).json({
      success: true,
      mode: 'sync_recent',
      sync_recent: {
        organization_id: organizationId,
        platform,
        window_days: windowDays,
        since: since.toISOString(),
        until: until.toISOString(),
        ingestion: 'extension_driven',
        facebook: {
          social_account_id: fbRow.id,
          page_id: fbRow.platform_user_id,
          meta_connection_id: fbRow.meta_connection_id,
          page_access_token_present: true,
        },
      },
    });
  }

  return res.status(200).json({
    success: true,
    mode: 'sync_recent',
    sync_recent: {
      organization_id: organizationId,
      platform,
      window_days: windowDays,
      since: since.toISOString(),
      until: until.toISOString(),
      ingestion: 'extension_driven',
    },
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

