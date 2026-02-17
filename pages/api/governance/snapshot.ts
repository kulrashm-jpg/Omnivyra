/**
 * POST /api/governance/snapshot
 * Stage 30 — Create governance snapshot. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { createGovernanceSnapshot } from '../../../backend/services/GovernanceSnapshotService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.body?.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const snapshotType = (req.body?.snapshotType as string) || 'FULL';
  if (!['FULL', 'CAMPAIGN', 'COMPANY'].includes(snapshotType)) {
    return res.status(400).json({ error: 'snapshotType must be FULL, CAMPAIGN, or COMPANY' });
  }

  const campaignId = (req.body?.campaignId as string)?.trim?.() || undefined;
  if (snapshotType === 'CAMPAIGN' && !campaignId) {
    return res.status(400).json({ error: 'campaignId is required for CAMPAIGN snapshot' });
  }

  const userId = (req as any).rbac?.userId;

  const result = await createGovernanceSnapshot({
    companyId,
    campaignId,
    snapshotType: snapshotType as 'FULL' | 'CAMPAIGN' | 'COMPANY',
    userId,
  });

  return res.status(200).json({
    snapshotId: result.snapshotId,
    policyVersion: result.policyVersion,
    policyHash: result.policyHash,
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
