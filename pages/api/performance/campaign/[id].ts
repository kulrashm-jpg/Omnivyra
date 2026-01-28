import { NextApiRequest, NextApiResponse } from 'next';
import { aggregateCampaignPerformance } from '../../../../backend/services/performanceFeedbackService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const result = await aggregateCampaignPerformance(id);
  if (!result) {
    return res.status(200).json({
      campaign_id: id,
      impressions: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
      engagement_rate: 0,
      expected_reach: null,
      accuracy_score: 0.5,
      recommendation_confidence: null,
      last_collected_at: null,
    });
  }

  return res.status(200).json(result);
}
