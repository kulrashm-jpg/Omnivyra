import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/v15/commands/ack (EXTENSION-1.5.0-CONTRACT.md §4).
 * Signed, version >= 1.5.0. pending -> dispatched, once, immediately before acting.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { acknowledgeCommand } from '@/backend/services/extension15';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const gate = checkExtensionVersion(body.extension_version);
  if (gate.ok !== true) return res.status(gate.status).json({ success: false, error: gate.code, minimum: gate.minimum });
  const r = await acknowledgeCommand(auth.session, body.command_id);
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(200).json({ success: true, status: 'dispatched' });
}

export default __createApiRoute(handler, { route: '/api/extension/v15/commands/ack' });
