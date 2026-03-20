/**
 * POST /api/credits/estimate
 *
 * Returns a credit cost estimate for a campaign plan.
 *
 * Body: CampaignCostPlan (platforms, posting_frequency, duration_weeks, ...)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { estimateCampaignCost, type CampaignCostPlan } from '../../../backend/services/campaignCostEstimator';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const plan = req.body as CampaignCostPlan;
    if (!plan.platforms || !plan.posting_frequency || !plan.duration_weeks) {
      return res.status(400).json({ error: 'platforms, posting_frequency, and duration_weeks required' });
    }
    const estimate = estimateCampaignCost(plan);
    return res.status(200).json(estimate);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}
