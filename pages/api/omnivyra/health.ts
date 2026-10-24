import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getOmnivyraHealthReport } from '../../../backend/services/omnivyraClientV1';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { requireActivePlatformSuperAdmin } from '../../../backend/security/requireActivePlatformSuperAdmin';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Closure-015C (P1): the report is platform-level. withRBAC([SUPER_ADMIN]) also admits an INVITED
  // company-scoped SUPER_ADMIN membership; only an active platform super admin may act.
  if (!(await requireActivePlatformSuperAdmin(req, res, 'omnivyra.health'))) return;
  const report = getOmnivyraHealthReport();
  return res.status(200).json(report);
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN]), { route: '/api/omnivyra/health' });
