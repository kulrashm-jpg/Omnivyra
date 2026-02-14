import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { listUsers } from '../../../backend/services/userManagementService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string | undefined;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const requester = await resolveUserContext(req);
  const result = await listUsers(companyId, requester);
  if (!result.ok) {
    const err = result as { status: number; error: string };
    return res.status(err.status).json({ error: err.error });
  }

  const ok = result as { ok: true; users: unknown };
  return res.status(200).json({ users: ok.users });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]);
