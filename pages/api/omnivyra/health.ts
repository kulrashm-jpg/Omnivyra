import { NextApiRequest, NextApiResponse } from 'next';
import { getOmnivyraHealthReport } from '../../../backend/services/omnivyraClientV1';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const report = getOmnivyraHealthReport();
  return res.status(200).json(report);
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
