import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { removeUser } from '../../../../backend/services/userManagementService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const companyId = req.query.companyId as string | undefined;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const requester = await resolveUserContext(req);
  const result = await removeUser(userId, String(companyId), requester);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json({ success: true });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]);
