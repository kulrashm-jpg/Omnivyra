import type { NextApiRequest, NextApiResponse } from 'next';
import { exchangeWordPressPluginToken } from '../../../backend/services/wordpressPluginService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { registration_id, nonce, plugin_version, wp_version, php_version, capabilities, settings } = req.body || {};
  if (!registration_id || !nonce) return res.status(400).json({ error: 'registration_id and nonce are required' });
  try {
    const result = await exchangeWordPressPluginToken({
      registrationId: String(registration_id),
      nonce: String(nonce),
      pluginVersion: typeof plugin_version === 'string' ? plugin_version : null,
      wpVersion: typeof wp_version === 'string' ? wp_version : null,
      phpVersion: typeof php_version === 'string' ? php_version : null,
      capabilities: typeof capabilities === 'object' && capabilities !== null ? capabilities : {},
      settings: typeof settings === 'object' && settings !== null ? settings : {},
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Token exchange failed' });
  }
}
