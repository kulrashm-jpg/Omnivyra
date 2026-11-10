import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/extension/bind-account (EXTENSION-1.5.0-CONTRACT.md §3).
 * Signed, version >= 1.5.0. Binds this Omnivyra user's extension to the LinkedIn
 * member it is logged in as. A different member for an active binding is refused.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { bindAccount } from '@/backend/services/extension15';

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
  if (body.platform !== 'linkedin') return res.status(400).json({ success: false, error: 'UNSUPPORTED_PLATFORM' });
  const r = await bindAccount(auth.session, body.acting_member_urn);
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(200).json({ success: true, created: r.created });
}

export default __createApiRoute(handler, { route: '/api/extension/bind-account' });
