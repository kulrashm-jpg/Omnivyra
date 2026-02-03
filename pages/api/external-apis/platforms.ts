import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformStrategies } from '../../../backend/services/externalApiService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId =
      (req.query.companyId as string | undefined) ||
      (req.query.company_id as string | undefined);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const strategies = await getPlatformStrategies(companyId);
    const grouped = strategies.reduce((acc: Record<string, any[]>, item: any) => {
      const key = item.platform_type || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return res.status(200).json({ platforms: grouped });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load platform configs' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
