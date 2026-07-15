import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/governance/company-analytics
 * Stage 22 — Company-level governance analytics. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
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
  return res.status(200).json(analytics);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/governance/company-analytics' });
