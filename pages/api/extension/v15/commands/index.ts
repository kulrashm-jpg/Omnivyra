import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * GET /api/extension/v15/commands (EXTENSION-1.5.0-CONTRACT.md §4).
 * Signed. Offers this session's pending 1.5 read commands, bound to its active
 * account binding, each with a signed envelope. A GET carries no body, so the
 * version comes from X-Omnivyra-Extension-Version; the commands themselves are
 * still only actionable through signed, version-gated result routes.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { offerCommands } from '@/backend/services/extension15';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const header = req.headers['x-omnivyra-extension-version'];
  const gate = checkExtensionVersion(Array.isArray(header) ? header[0] : header);
  if (gate.ok !== true) return res.status(gate.status).json({ success: false, error: gate.code, minimum: gate.minimum });
  const r = await offerCommands(auth.session);
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(200).json({ success: true, commands: r.commands });
}

export default __createApiRoute(handler, { route: '/api/extension/v15/commands' });
