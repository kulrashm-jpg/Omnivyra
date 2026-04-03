
/**
 * POST /api/opportunity/build-campaign
 * Builds prefilled campaign context from an opportunity object.
 * Returns idea_spine, strategy_context, campaign_direction for planner prefill.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { buildCampaignFromOpportunity } from '../../../backend/services/opportunityCampaignBuilder';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};
    const opportunity = body.opportunity ?? body;

    if (!opportunity || typeof opportunity !== 'object') {
      return res.status(400).json({ error: 'opportunity object is required' });
    }

    const result = buildCampaignFromOpportunity({
      title: opportunity.title ?? '',
      description: opportunity.description ?? '',
      opportunity_type: opportunity.opportunity_type,
      confidence: opportunity.confidence,
      opportunity_score: opportunity.opportunity_score,
      supporting_signals: opportunity.supporting_signals,
      recommended_action: opportunity.recommended_action,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[opportunity/build-campaign]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build campaign from opportunity',
    });
  }
}
