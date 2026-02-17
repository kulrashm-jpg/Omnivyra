/**
 * GET /api/governance/verify-snapshot
 * Stage 30 — Verify snapshot integrity.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { verifySnapshotIntegrity } from '../../../backend/services/GovernanceSnapshotService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const snapshotId = (req.query.snapshotId as string)?.trim?.();
  if (!snapshotId) {
    return res.status(400).json({ error: 'snapshotId is required' });
  }

  const result = await verifySnapshotIntegrity(snapshotId);
  return res.status(200).json(result);
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
