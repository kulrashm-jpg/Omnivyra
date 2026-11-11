import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/super-admin/analytics-provider-config — read GA4 OAuth config
 * POST /api/super-admin/analytics-provider-config — upsert GA4 OAuth config
 *
 * Auth:
 *   - GET gates on `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` (2026-11-11:
 *     the legacy super-admin cookie arm is gone).
 *   - POST gates on `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)`.
 *     This is the same capability that protects /super-admin/platform-oauth-configs;
 *     overwriting Google Analytics OAuth client secrets has the same blast
 *     radius as overwriting platform OAuth credentials. Step-up
 *     (phishing-resistant + trusted device) is required.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getAnalyticsProviderConfigSummary,
  getDefaultAnalyticsProviderScopes,
  getDefaultAnalyticsRedirectUri,
  upsertAnalyticsProviderConfig,
} from '../../../backend/services/analyticsProviderConfigService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { enforcePlatformWriteAuthority } from '../../../backend/security/platformWriteAuthority';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';

// 2026-11-11: platform VIEW capability; requireCapability answers 401/403 itself.
// The legacy super-admin cookie arm is gone.
async function requireAnalyticsProviderRead(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: '/api/super-admin/analytics-provider-config read',
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (req.method !== 'GET' && !(await requireAdminRateLimit(req, res, 'rl:super-admin:analytics-provider-config', 10, 60, { sensitive: true }))) return;

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
    // Closure-013 (D-3): GA/GSC credential writes also need an active platform SUPER_ADMIN.
    if (!(await enforcePlatformWriteAuthority(req, res, guard.principal, INTEGRATION_PLATFORM_OAUTH_MANAGE, 'analytics_provider_config.write'))) return;

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
