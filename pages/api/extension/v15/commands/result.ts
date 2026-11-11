import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/v15/commands/result (EXTENSION-1.5.0-CONTRACT.md §5).
 * Signed, version >= 1.5.0. The extension's refusal or failure of a dispatched READ
 * command it could not complete. Body: { command_id, status: refused|failed, error_code, extension_version }.
 * Write commands report through /api/extension/action-result.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { reportReadCommandOutcome } from '@/backend/services/extension15';

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
  const r = await reportReadCommandOutcome(auth.session, body);
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(200).json({ success: true });
}

export default __createApiRoute(handler, { route: '/api/extension/v15/commands/result' });
