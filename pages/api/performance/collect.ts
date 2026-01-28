import { NextApiRequest, NextApiResponse } from 'next';
import { recordPerformance } from '../../../backend/services/performanceFeedbackService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    campaign_id,
    recommendation_id,
    platform,
    post_id,
    impressions,
    likes,
    shares,
    comments,
    clicks,
    engagement_rate,
    collected_at,
    source,
  } = req.body || {};

  if (!campaign_id || !platform || !post_id || !source) {
    return res.status(400).json({ error: 'campaign_id, platform, post_id, and source are required' });
  }

  const ok = await recordPerformance({
    campaign_id,
    recommendation_id: recommendation_id ?? null,
    platform,
    post_id,
    impressions,
    likes,
    shares,
    comments,
    clicks,
    engagement_rate,
    collected_at,
    source,
  });

  return res.status(200).json({ ok });
}
