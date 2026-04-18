import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
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

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const context = await getMarketPulseContext(companyId);
    return res.status(200).json(context);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to load Market Pulse context' });
  }
}
