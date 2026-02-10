import { NextApiRequest, NextApiResponse } from 'next';
import { runWeeklyRecommendationRefresh } from '../../../backend/services/recommendationScheduler';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode, companyId } = req.body || {};
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    if (mode === 'weekly') {
      await runWeeklyRecommendationRefresh();
      return res.status(200).json({ success: true });
    }
    if (mode === 'company') {
      return res.status(200).json({
        success: true,
        message: 'Recommendations are user-initiated only. Use the Generate button or POST /api/recommendations/generate.',
      });
    }
    return res.status(400).json({ error: 'Invalid mode' });
  } catch (error: any) {
    console.error('Error refreshing recommendations:', error);
    return res.status(500).json({ error: 'Failed to refresh recommendations' });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);
