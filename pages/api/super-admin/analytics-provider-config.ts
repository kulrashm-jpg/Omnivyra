import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getAnalyticsProviderConfigSummary,
  getDefaultAnalyticsProviderScopes,
  getDefaultAnalyticsRedirectUri,
  upsertAnalyticsProviderConfig,
} from '../../../backend/services/analyticsProviderConfigService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

async function requireAnalyticsProviderAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(403).json({ error: 'Super admin access required' });
    return false;
  }

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (roleRow) return true;

  res.status(403).json({ error: 'Super admin access required' });
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const allowed = await requireAnalyticsProviderAdmin(req, res);
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const config = await getAnalyticsProviderConfigSummary('google_analytics');
      return res.status(200).json({ config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load analytics provider config';
      return res.status(500).json({ error: message });
    }
  }

  if (req.method === 'POST') {
    try {
      const enabled = Boolean(req.body?.enabled);
      const clientId = typeof req.body?.oauth_client_id === 'string' ? req.body.oauth_client_id : undefined;
      const clientSecret = typeof req.body?.oauth_client_secret === 'string' ? req.body.oauth_client_secret : undefined;
      const redirectUri = typeof req.body?.redirect_uri === 'string' && req.body.redirect_uri.trim()
        ? req.body.redirect_uri.trim()
        : getDefaultAnalyticsRedirectUri('google_analytics');
      const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length > 0
        ? req.body.scopes.filter((scope: unknown): scope is string => typeof scope === 'string' && scope.trim().length > 0)
        : getDefaultAnalyticsProviderScopes('google_analytics');

      await upsertAnalyticsProviderConfig({
        provider: 'google_analytics',
        enabled,
        oauth_client_id: clientId,
        oauth_client_secret: clientSecret,
        redirect_uri: redirectUri,
        scopes,
        status: enabled ? 'active' : 'disabled',
      });

      const config = await getAnalyticsProviderConfigSummary('google_analytics');
      return res.status(200).json({ success: true, config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save analytics provider config';
      return res.status(400).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
