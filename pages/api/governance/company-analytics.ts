/**
 * GET /api/governance/company-analytics
 * Stage 22 — Company-level governance analytics. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getCompanyGovernanceAnalytics } from '../../../backend/services/GovernanceAnalyticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const analytics = await getCompanyGovernanceAnalytics(companyId);
  return res.status(200).json(analytics);
}
