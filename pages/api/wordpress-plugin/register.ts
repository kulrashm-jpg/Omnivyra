import type { NextApiRequest, NextApiResponse } from 'next';
import { registerWordPressPlugin } from '../../../backend/services/wordpressPluginService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, website_id, site_url, plugin_site_id, connection_id } = req.body || {};
  if (!company_id || !website_id || !site_url || !plugin_site_id) {
    return res.status(400).json({ error: 'company_id, website_id, site_url, and plugin_site_id are required' });
  }
  const result = await registerWordPressPlugin({
    companyId: String(company_id),
    websiteId: String(website_id),
    siteUrl: String(site_url),
    pluginSiteId: String(plugin_site_id),
    connectionId: typeof connection_id === 'string' ? connection_id : null,
  });
  return res.status(201).json(result);
}
