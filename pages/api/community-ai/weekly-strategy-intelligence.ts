/**
 * GET /api/community-ai/weekly-strategy-intelligence
 *
 * Read-only. Returns aggregated weekly strategy intelligence for a campaign.
 * Query: campaign_id (required).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getWeeklyStrategyIntelligence } from '../../../backend/services/weeklyStrategyIntelligenceService';

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
    const intelligence = await getWeeklyStrategyIntelligence(access.campaignId);
    return res.status(200).json({
      success: true,
      intelligence,
    });
  } catch (error: any) {
    console.error('[weekly-strategy-intelligence]', error?.message);
    return res.status(500).json({ error: 'Failed to load weekly strategy intelligence' });
  }
}
