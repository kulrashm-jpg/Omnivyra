import { NextApiRequest, NextApiResponse } from 'next';
import { getAuditByCampaignId } from '../../../../../backend/services/recommendationAuditService';
import { Role } from '../../../../../backend/services/rbacService';
import { withRBAC } from '../../../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  try {
    const audits = await getAuditByCampaignId(id);
    return res.status(200).json({ audits });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load campaign audit logs' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
