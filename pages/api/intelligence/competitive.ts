import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { getCompetitiveIntelligenceForCompany } from '../../../backend/services/strategicIntelligenceOrchestrationService';
import { refineUserFacingResponse } from '@/backend/utils/refineUserFacingResponse';

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

    const windowHours = Math.min(168, Math.max(1, parseInt(String(req.query.windowHours ?? 24), 10) || 24));

    const { competitive_signals } = await getCompetitiveIntelligenceForCompany(companyId, {
      windowHours,
    });
    const refinedSignals = await refineUserFacingResponse(competitive_signals);
    return res.status(200).json({ competitive_signals: refinedSignals });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch competitive intelligence';
    console.error('[intelligence/competitive]', message);
    return res.status(500).json({ error: message });
  }
}
