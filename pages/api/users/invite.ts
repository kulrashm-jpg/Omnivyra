import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { inviteUser } from '../../../backend/services/userManagementService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, companyId, role } = req.body || {};
  if (!email || !companyId || !role) {
    return res.status(400).json({ error: 'email, companyId, role are required' });
  }

  const requester = await resolveUserContext(req);
  const result = await inviteUser(String(email), String(companyId), String(role), requester);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json({ user: result });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]);
