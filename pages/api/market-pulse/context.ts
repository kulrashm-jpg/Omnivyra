import { NextApiRequest, NextApiResponse } from 'next';
import { isContentArchitectSession, resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { getMarketPulseContext } from '../../../backend/services/marketPulseV2Service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = isContentArchitectSession(req)
      ? { userId: 'content_architect', role: 'CONTENT_ARCHITECT' }
      : await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const viewType = typeof req.query.viewType === 'string' ? req.query.viewType : 'executive';
    const safeViewType = ['executive', 'operational', 'compliance', 'workforce', 'funding'].includes(viewType)
      ? viewType as 'executive' | 'operational' | 'compliance' | 'workforce' | 'funding'
      : 'executive';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;
    const context = await getMarketPulseContext(companyId, safeViewType, { limit, offset });
    return res.status(200).json(context);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to load Market Pulse context' });
  }
}
