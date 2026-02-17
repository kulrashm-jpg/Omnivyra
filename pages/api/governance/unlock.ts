/**
 * POST /api/governance/unlock
 * Stage 29 — Release governance lockdown. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { releaseGovernanceLock } from '../../../backend/services/GovernanceLockdownService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = (req as any).rbac?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await releaseGovernanceLock(userId);
  return res.status(200).json({ success: true });
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
