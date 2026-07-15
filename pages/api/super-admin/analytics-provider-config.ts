import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/super-admin/analytics-provider-config — read GA4 OAuth config
 * POST /api/super-admin/analytics-provider-config — upsert GA4 OAuth config
 *
 * Phase 2 — direct-cookie migration (mutation only):
 *   - GET stays bridge-compatible via the centralized
 *     `getLegacySuperAdminSession` helper (now signature-validated +
 *     dry-run-aware). Read access continues to work for env-credential
 *     operators on the home tab.
 *   - POST gates on `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)`.
 *     This is the same capability that protects /super-admin/platform-oauth-configs;
 *     overwriting Google Analytics OAuth client secrets has the same blast
 *     radius as overwriting platform OAuth credentials. Step-up
 *     (phishing-resistant + trusted device) is required.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getAnalyticsProviderConfigSummary,
  getDefaultAnalyticsProviderScopes,
  getDefaultAnalyticsRedirectUri,
  upsertAnalyticsProviderConfig,
} from '../../../backend/services/analyticsProviderConfigService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';

async function requireAnalyticsProviderRead(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  // Bridge accepted for READ only via centralized helper.
  if (getLegacySuperAdminSession(req) !== null) return true;

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    if (!(await requireAnalyticsProviderRead(req, res))) return;
    try {
      const config = await getAnalyticsProviderConfigSummary('google_analytics');
      return res.status(200).json({ config });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load analytics provider config';
      return res.status(500).json({ error: message });
    }
  }

  if (req.method === 'POST') {
    // Phase 2 migration: capability + step-up gate. Bridge principals
    // are explicitly rejected (BRIDGE_FACTOR_INSUFFICIENT) because the
    // bridge cap set excludes INTEGRATION_PLATFORM_OAUTH_MANAGE.
    const guard = await requireCapability(req, res, {
      capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
      reason: 'analytics provider OAuth credentials mutation',
    });
    if (guard.ok !== true) return;

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
      const capabilityRedirectInput = req.body?.capability_redirect_uris && typeof req.body.capability_redirect_uris === 'object'
        ? req.body.capability_redirect_uris as Record<string, unknown>
        : {};
      const capabilityRedirectUris = {
        google_analytics: typeof capabilityRedirectInput.google_analytics === 'string'
          ? capabilityRedirectInput.google_analytics.trim()
          : redirectUri,
        google_search_console: typeof capabilityRedirectInput.google_search_console === 'string'
          ? capabilityRedirectInput.google_search_console.trim()
          : redirectUri,
      };

      await upsertAnalyticsProviderConfig({
        provider: 'google_analytics',
        enabled,
        oauth_client_id: clientId,
        oauth_client_secret: clientSecret,
        redirect_uri: redirectUri,
        capability_redirect_uris: capabilityRedirectUris,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/analytics-provider-config' });
