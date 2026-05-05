import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { inviteUser } from '../../../backend/services/userManagementService';
import { getOrganizationContext } from '../../../lib/orgResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, role } = req.body || {};
  if (!email || !role) {
    return res.status(400).json({ error: 'email, role, organization_id are required' });
  }

  const { organization_id } = getOrganizationContext(req);
  const requester = await resolveUserContext(req);
  const result = await inviteUser(String(email), organization_id, String(role), requester);
  if (!result.ok) {
    const err = result as { status: number; error: string };
    return res.status(err.status).json({ error: err.error });
  }

  return res.status(200).json({ user: result });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
  allowSuperAdminOverride: true,
})(handler);
