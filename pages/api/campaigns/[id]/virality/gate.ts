import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { evaluateViralityGate } from '../../../../../backend/services/viralityGateService';
import { requireCampaignAccess } from '../../../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: enforce caller has access to this campaign's company.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;

  try {
    const gateResult = await evaluateViralityGate(id);
    return res.status(200).json(gateResult);
  } catch (error: any) {
    console.error('Error in virality gate API:', error);
    return res.status(500).json({ error: 'Failed to evaluate virality gate' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/virality/gate' });
