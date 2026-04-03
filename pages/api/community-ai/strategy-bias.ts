
/**
 * GET /api/community-ai/strategy-bias
 *
 * Optional debug. Returns computed strategy bias (advisory only).
 * Query: campaign_id (required).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { computeStrategyBias } from '../../../backend/services/strategyBiasService';

function getCampaignId(req: NextApiRequest): string | null {
  const fromQuery = req.query?.campaign_id;
  if (typeof fromQuery === 'string') return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.campaign_id;
  if (typeof fromBody === 'string') return fromBody;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaign_id = getCampaignId(req);
  const access = await requireCampaignAccess(req, res, campaign_id ?? '');
  if (!access) return;

  try {
    const bias = await computeStrategyBias(access.campaignId);
    return res.status(200).json({
      success: true,
      bias,
    });
  } catch (error: any) {
    console.error('[strategy-bias]', error?.message);
    return res.status(500).json({ error: 'Failed to compute strategy bias' });
  }
}
