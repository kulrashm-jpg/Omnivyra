import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { registerWordPressPlugin } from '../../../backend/services/wordpressPluginService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, website_id, site_url, plugin_site_id, connection_id } = req.body || {};
  if (!company_id || !website_id || !site_url || !plugin_site_id) {
    return res.status(400).json({ error: 'company_id, website_id, site_url, and plugin_site_id are required' });
  }
  const companyId = String(company_id);
  const websiteId = String(website_id);
  const connectionId = typeof connection_id === 'string' ? connection_id : null;

  // ROUTE-AUTH-001: registering (re)issues the registration's nonce and resets
  // its token, so it is a company-admin action — the same gate as
  // wordpress-plugin/revoke and setup-session.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;

  // The website (and the connection, when named) must belong to the authorized
  // company; a foreign id and an unknown id get the same 404.
  const { data: website, error: websiteError } = await supabase
    .from('websites')
    .select('id')
    .eq('id', websiteId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (websiteError) return res.status(503).json({ error: 'Website lookup failed. Please try again.' });
  if (!website) return res.status(404).json({ error: 'Website not found' });
  if (connectionId) {
    const { data: connection, error: connectionError } = await supabase
      .from('website_connections')
      .select('id')
      .eq('id', connectionId)
      .eq('website_id', websiteId)
      .maybeSingle();
    if (connectionError) return res.status(503).json({ error: 'Connection lookup failed. Please try again.' });
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
  }

  const result = await registerWordPressPlugin({
    companyId,
    websiteId,
    siteUrl: String(site_url),
    pluginSiteId: String(plugin_site_id),
    connectionId,
  });
  return res.status(201).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/register' });
