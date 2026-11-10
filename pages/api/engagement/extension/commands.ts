import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/engagement/extension/commands (EXTENSION-1.5.0-CONTRACT.md §4).
 * Called by the Omnivyra UI when a user asks for a sync or a capture: issues ONE
 * read command for that user's own extension. Never called by a background job.
 * Body: { organization_id, action, params? }.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { issueReadCommand } from '@/backend/services/extension15';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : '';
  if (!organizationId) return res.status(400).json({ success: false, error: 'organization_id is required' });
  const user = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!user) return;
  const r = await issueReadCommand({ orgId: organizationId, userId: user.userId, action: body.action, params: body.params });
  if (r.ok !== true) return res.status(r.status).json({ success: false, error: r.code });
  return res.status(201).json({ success: true, command_id: r.commandId });
}

export default __createApiRoute(handler, { route: '/api/engagement/extension/commands' });
