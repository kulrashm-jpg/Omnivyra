import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getRecommendationAnalytics } from '../../../backend/services/recommendationAnalyticsService';
import { PERMISSIONS } from '../../../backend/services/rbacService';
import { withRBAC, type RbacContext } from '../../../backend/middleware/withRBAC';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fromDate, toDate, campaignId } = req.query;
  // ROUTE-AUTH-001 (STEP 3AH-85) — the ONLY tenant id is the one withRBAC
  // authorized (it may have come from the body), never a re-read of the query.
  const companyId = (req as NextApiRequest & { rbac?: RbacContext }).rbac?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  // performance_feedback is filtered by campaign only, so a supplied campaignId
  // must belong to the authorized company (foreign/unknown → 404).
  if (typeof campaignId === 'string' && campaignId) {
    const bound = await enforceCompanyAccess({ req, res, companyId, campaignId });
    if (!bound) return;
  }
  try {
    const analytics = await getRecommendationAnalytics({
      fromDate: typeof fromDate === 'string' ? fromDate : undefined,
      toDate: typeof toDate === 'string' ? toDate : undefined,
      campaignId: typeof campaignId === 'string' ? campaignId : undefined,
      companyId,
    });
    return res.status(200).json(analytics);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
}

export default __createApiRoute(withRBAC(handler, PERMISSIONS.VIEW_ANALYTICS as import('../../../backend/services/rbacService').Role[]), { route: '/api/recommendations/analytics' });
