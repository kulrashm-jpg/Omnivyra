import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { removeUser } from '../../../../backend/services/userManagementService';
import { getOrganizationContext } from '../../../../lib/orgResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const { organization_id } = getOrganizationContext(req);
  const requester = await resolveUserContext(req);
  const result = await removeUser(userId, organization_id, requester);
  if (!result.ok) {
    const err = result as { status: number; error: string };
    return res.status(err.status).json({ error: err.error });
  }

  return res.status(200).json({ success: true });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
  allowSuperAdminOverride: true,
})(handler);
