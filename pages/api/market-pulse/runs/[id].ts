import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../backend/services/contentArchitectService';
import { getMarketPulseRun, syncLegacyJobIntoRun } from '../../../../backend/services/marketPulseV2Service';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runId = typeof req.query.id === 'string' ? req.query.id : '';
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
    if (!runId || !companyId) {
      return res.status(400).json({ error: 'run id and companyId are required' });
    }

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    const synced = await syncLegacyJobIntoRun(runId, companyId);
    return res.status(200).json(synced);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to load Market Pulse run' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

