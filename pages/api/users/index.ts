import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { listUsers } from '../../../backend/services/userManagementService';
import { getOrganizationContext } from '../../../lib/orgResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { organization_id } = getOrganizationContext(req);
  const requester = await resolveUserContext(req);
  const result = await listUsers(organization_id, requester);
  if (!result.ok) {
    const err = result as { status: number; error: string };
    return res.status(err.status).json({ error: err.error });
  }

  const ok = result as { ok: true; users: unknown };
  return res.status(200).json({ users: ok.users });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
  allowSuperAdminOverride: true,
})(handler);
