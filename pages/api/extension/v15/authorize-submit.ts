import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/v15/authorize-submit (EXTENSION-1.5.0-CONTRACT.md §5.4).
 * Signed, version >= 1.5.0. The last gate before an extension 1.5 write click:
 * authorize_extension_submit re-checks, under one row lock, the lease, in-flight
 * status, approval evidence, execution policy, binding, own content and text hash,
 * then writes submit_attempted_at. Body: { command_id, lease_id, text_sha256?, extension_version }.
 * 200 { success: true } means click once; anything else means do not click.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { checkExtensionVersion } from '@/lib/extension/version';
import { getActiveBinding } from '@/backend/services/extension15';
import { authorizeSubmit } from '@/backend/services/extension15/writeCommands';

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
  const binding = await getActiveBinding(auth.session.orgId, auth.session.userId);
  if (binding.ok !== true) return res.status(binding.status).json({ success: false, error: binding.code });
  if (!binding.urn) return res.status(409).json({ success: false, error: 'NO_ACCOUNT_BINDING' });
  const r = await authorizeSubmit(auth.session, binding.urn, body);
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(200).json({ success: true });
}

export default __createApiRoute(handler, { route: '/api/extension/v15/authorize-submit' });
