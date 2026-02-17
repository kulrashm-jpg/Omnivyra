/**
 * POST /api/governance/rebuild-projection
 * Stage 32 — Rebuild governance projection for a campaign. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { rebuildGovernanceProjection } from '../../../backend/services/GovernanceProjectionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.body?.campaignId ?? req.query.campaignId) as string;
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  await rebuildGovernanceProjection(campaignId.trim());
  return res.status(200).json({ ok: true, campaignId: campaignId.trim() });
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
