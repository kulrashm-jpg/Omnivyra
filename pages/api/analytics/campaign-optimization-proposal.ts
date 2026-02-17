/**
 * GET /api/analytics/campaign-optimization-proposal
 * Stage 36 — Structured optimization proposal. Advisory only. RBAC: COMPANY_ADMIN+
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { generateOptimizationProposal } from '../../../backend/services/CampaignOptimizationProposalService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const proposal = await generateOptimizationProposal(campaignId);
  return res.status(200).json({ proposal });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
