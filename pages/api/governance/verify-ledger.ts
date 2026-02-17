/**
 * GET /api/governance/verify-ledger
 * Stage 31 — Verify company governance ledger. SUPER_ADMIN only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { verifyCompanyLedger } from '../../../backend/services/GovernanceLedgerVerificationService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const result = await verifyCompanyLedger(companyId);
  return res.status(200).json({
    valid: result.valid,
    corruptedCampaigns: result.corruptedCampaigns,
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
