import { NextApiRequest, NextApiResponse } from 'next';
import { getAuditByRecommendationId } from '../../../../backend/services/recommendationAuditService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  try {
    const audit = await getAuditByRecommendationId(id);
    return res.status(200).json({ audit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load recommendation audit log' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
