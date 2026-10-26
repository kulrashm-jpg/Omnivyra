import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET  /api/super-admin/pagespeed-config — Google PageSpeed Insights provider status (no secret)
 * POST /api/super-admin/pagespeed-config — { enabled, api_key?, clear_key? } save
 *                                          { action: 'check' } one free request with the live credential
 *
 * Same gates as /api/super-admin/analytics-provider-config:
 *   - GET: legacy super-admin bridge (read only) or an active SUPER_ADMIN role.
 *   - POST save: requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE) (step-up: phishing-resistant
 *     + trusted device) and enforcePlatformWriteAuthority. Replacing the key every tenant report
 *     uses has the same blast radius as replacing the GA/GSC OAuth client.
 *   - POST check: the read gate plus a strict rate limit; it changes no credential.
 *
 * The key is accepted on save and never returned, logged or echoed: responses carry the
 * shape-only summary (getPageSpeedConfigSummary), errors carry a fixed message.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { checkPageSpeedConfig, getPageSpeedConfigSummary, PageSpeedSaveError, savePageSpeedConfig } from '../../../backend/services/pageSpeedProviderConfigService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { enforcePlatformWriteAuthority } from '../../../backend/security/platformWriteAuthority';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';

async function requireSuperAdminRead(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
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

/** A save error that is safe to show: our own validation messages only, never a provider or DB body. */
const SAFE_ERROR = /^(The API key is empty\.|The API key contains spaces\.|That does not look like a Google API key\.)$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && !(await requireAdminRateLimit(req, res, 'rl:super-admin:pagespeed-config', 10, 60, { sensitive: true }))) return;

  if (req.method === 'GET') {
    if (!(await requireSuperAdminRead(req, res))) return;
    try {
      return res.status(200).json({ config: await getPageSpeedConfigSummary() });
    } catch {
      return res.status(500).json({ error: 'Failed to load the PageSpeed provider configuration.' });
    }
  }

  if (req.method === 'POST') {
    if (req.body?.action === 'check') {
      if (!(await requireSuperAdminRead(req, res))) return;
      try {
        return res.status(200).json({ config: await checkPageSpeedConfig() });
      } catch {
        return res.status(500).json({ error: 'The PageSpeed check could not be run.' });
      }
    }

    const guard = await requireCapability(req, res, {
      capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
      reason: 'pagespeed provider credential mutation',
    });
    if (guard.ok !== true) return;
    if (!(await enforcePlatformWriteAuthority(req, res, guard.principal, INTEGRATION_PLATFORM_OAUTH_MANAGE, 'pagespeed_config.write'))) return;

    try {
      const config = await savePageSpeedConfig({
        enabled: Boolean(req.body?.enabled),
        apiKey: typeof req.body?.api_key === 'string' ? req.body.api_key : undefined,
        clearKey: req.body?.clear_key === true,
      });
      return res.status(200).json({ success: true, config });
    } catch (error) {
      if (error instanceof PageSpeedSaveError) {
        // Step + database error code to the operator; the scrubbed database message to the server log only.
        console.error('[pagespeed-config] save failed', { step: error.step, code: error.code, detail: error.logDetail });
        return res.status(500).json({ error: error.message, step: error.step, code: error.code });
      }
      const message = error instanceof Error && SAFE_ERROR.test(error.message) ? error.message : 'Failed to save the PageSpeed provider configuration.';
      if (!(error instanceof Error && SAFE_ERROR.test(error.message))) console.error('[pagespeed-config] save failed', { step: 'unknown', name: error instanceof Error ? error.name : typeof error });
      return res.status(400).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/super-admin/pagespeed-config' });
