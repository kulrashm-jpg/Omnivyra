import type { NextApiRequest, NextApiResponse } from 'next';
import { recordWordPressPluginHeartbeat } from '../../../backend/services/wordpressPluginService';

function bearer(req: NextApiRequest): string {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { registration_id, metadata, plugin_version, wp_version, php_version, health_status, settings, capabilities } = req.body || {};
  const token = bearer(req) || (typeof req.body?.access_token === 'string' ? req.body.access_token : undefined);
  if (!registration_id && !token) return res.status(400).json({ error: 'registration_id or bearer token is required' });
  try {
    await recordWordPressPluginHeartbeat({
      registrationId: registration_id ? String(registration_id) : undefined,
      accessToken: token,
      metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
      pluginVersion: typeof plugin_version === 'string' ? plugin_version : null,
      wpVersion: typeof wp_version === 'string' ? wp_version : null,
      phpVersion: typeof php_version === 'string' ? php_version : null,
      healthStatus: (['healthy', 'warning', 'degraded', 'failed', 'reauth_required'].includes(health_status)
        ? health_status
        : 'healthy') as 'warning' | 'healthy' | 'degraded' | 'failed' | 'reauth_required',
      settings: typeof settings === 'object' && settings !== null ? settings : {},
      capabilities: typeof capabilities === 'object' && capabilities !== null ? capabilities : {},
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : 'Heartbeat failed' });
  }
}
