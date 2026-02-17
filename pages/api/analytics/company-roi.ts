/**
 * GET /api/analytics/company-roi
 * Stage 34 — Company ROI Overview. Read-only. RBAC: COMPANY_ADMIN+
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getCompanyGovernanceAnalytics } from '../../../backend/services/GovernanceAnalyticsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const analytics = await getCompanyGovernanceAnalytics(companyId);
  return res.status(200).json({
    companyId: analytics.companyId,
    averageRoiScore: analytics.averageRoiScore,
    highRiskCampaignsCount: analytics.highRiskCampaignsCount ?? 0,
    highPotentialCampaignsCount: analytics.highPotentialCampaignsCount ?? 0,
    totalCampaigns: analytics.totalCampaigns,
  });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
