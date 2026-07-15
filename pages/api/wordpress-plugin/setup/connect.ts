import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { consumeWordPressSetupSession } from '../../../../backend/services/wordpressPluginSetupService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { setup_token, site_url, plugin_site_id, plugin_version, wp_version, php_version, capabilities, settings } = req.body || {};
  if (!setup_token || !site_url || !plugin_site_id) {
    return res.status(400).json({ error: 'setup_token, site_url, and plugin_site_id are required' });
  }
  try {
    const result = await consumeWordPressSetupSession({
      setupToken: String(setup_token),
      siteUrl: String(site_url),
      pluginSiteId: String(plugin_site_id),
      pluginVersion: typeof plugin_version === 'string' ? plugin_version : null,
      wpVersion: typeof wp_version === 'string' ? wp_version : null,
      phpVersion: typeof php_version === 'string' ? php_version : null,
      capabilities: typeof capabilities === 'object' && capabilities !== null ? capabilities : {},
      settings: typeof settings === 'object' && settings !== null ? settings : {},
      metadata: { user_agent: req.headers['user-agent'] ?? null },
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Setup failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/setup/connect' });
