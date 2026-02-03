import { NextApiRequest, NextApiResponse } from 'next';
import { getRecommendationAnalytics } from '../../../backend/services/recommendationAnalyticsService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fromDate, toDate, campaignId, companyId } = req.query;
  try {
    const analytics = await getRecommendationAnalytics({
      fromDate: typeof fromDate === 'string' ? fromDate : undefined,
      toDate: typeof toDate === 'string' ? toDate : undefined,
      campaignId: typeof campaignId === 'string' ? campaignId : undefined,
      companyId: typeof companyId === 'string' ? companyId : undefined,
    });
    return res.status(200).json(analytics);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.COMPANY_ADMIN]);
