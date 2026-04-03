
/**
 * GET /api/community-ai/strategic-feedback
 *
 * Returns latest strategic feedback for a campaign. If none exists recently,
 * generates feedback (deterministic) and returns it.
 * Query: campaign_id (required).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import {
  getLatestStrategicFeedback,
  generateStrategicFeedback,
  hasRecentStrategicFeedback,
} from '../../../backend/services/strategicFeedbackService';

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

  const campaignId = access.campaignId;

  try {
    let feedback = await getLatestStrategicFeedback(campaignId);
    if (!feedback) {
      feedback = await generateStrategicFeedback(campaignId);
    } else {
      const recent = await hasRecentStrategicFeedback(campaignId);
      if (!recent) {
        feedback = await generateStrategicFeedback(campaignId);
      }
    }

    return res.status(200).json({
      success: true,
      feedback: {
        insights: feedback.insights,
        metrics: feedback.metrics,
        generated_at: feedback.generated_at,
      },
    });
  } catch (error: any) {
    console.error('[strategic-feedback]', error?.message);
    return res.status(500).json({ error: 'Failed to load or generate strategic feedback' });
  }
}
