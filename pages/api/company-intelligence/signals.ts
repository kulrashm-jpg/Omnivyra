import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { getRecentCompanySignals } from '../../../backend/services/companyIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    const windowHours = Math.min(168, Math.max(1, parseInt(String(req.query.windowHours ?? 24), 10) || 24));

    const signals = await getRecentCompanySignals(companyId, { limit, windowHours });
    return res.status(200).json({ signals });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch company signals';
    console.error('[company-intelligence/signals]', message);
    return res.status(500).json({ error: message });
  }
}
