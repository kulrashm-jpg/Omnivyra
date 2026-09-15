import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  authenticateWordPressPluginToken,
  recordWordPressPluginHeartbeat,
} from '../../../backend/services/wordpressPluginService';

function bearer(req: NextApiRequest): string {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { registration_id, metadata, plugin_version, wp_version, php_version, health_status, settings, capabilities } = req.body || {};
  const token = bearer(req) || (typeof req.body?.access_token === 'string' ? req.body.access_token : '');

  // SEC-91A (STEP 3AH-91, A1) — the plugin bearer token is REQUIRED.
  // recordWordPressPluginHeartbeat() accepts a bare registrationId and, when
  // given one, never checks a token, so this route used to let an anonymous
  // caller who knew (or saw) a registration UUID overwrite that registration's
  // metadata / settings / capabilities / diagnostics and flip its status back to
  // 'connected' (even after a revoke). The allowlist entry claimed "authenticated
  // by the plugin bearer token … 401 otherwise"; that is now what the code does.
  // The plugin (class-omnivera-client.php heartbeat()) always sends its token and
  // never a registration_id, so legitimate heartbeats are unaffected.
  if (!token) return res.status(401).json({ error: 'Plugin bearer token is required' });
  const plugin = await authenticateWordPressPluginToken(token);
  if (!plugin) return res.status(401).json({ error: 'Invalid plugin token' });
  if (registration_id && String(registration_id) !== plugin.registrationId) {
    return res.status(403).json({ error: 'Plugin token does not match registration_id' });
  }

  try {
    await recordWordPressPluginHeartbeat({
      registrationId: plugin.registrationId,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/heartbeat' });
