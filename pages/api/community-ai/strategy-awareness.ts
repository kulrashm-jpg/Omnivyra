
/**
 * GET /api/community-ai/strategy-awareness
 *
 * Read-only. Returns unified strategy awareness (confidence + engagement intelligence).
 * Query: campaign_id (required).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getStrategyAwareness } from '../../../backend/services/strategyAwarenessService';

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
    const awareness = await getStrategyAwareness(access.campaignId);
    return res.status(200).json({
      success: true,
      awareness,
    });
  } catch (error: any) {
    console.error('[strategy-awareness]', error?.message);
    return res.status(500).json({ error: 'Failed to load strategy awareness' });
  }
}
