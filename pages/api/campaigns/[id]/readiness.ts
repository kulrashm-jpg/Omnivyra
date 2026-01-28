import { NextApiRequest, NextApiResponse } from 'next';
import { evaluateCampaignReadiness } from '../../../../backend/services/campaignReadinessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const readiness = await evaluateCampaignReadiness(id);

    const notFound = readiness.blocking_issues.some(
      (issue) => issue.code === 'CAMPAIGN_NOT_FOUND'
    );
    if (notFound) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    return res.status(200).json({
      campaign_id: readiness.campaign_id,
      readiness_percentage: readiness.readiness_percentage,
      readiness_state: readiness.readiness_state,
      blocking_issues: readiness.blocking_issues,
    });
  } catch (error: any) {
    console.error('Error in campaign readiness API:', error);
    return res.status(500).json({ error: 'Failed to evaluate campaign readiness' });
  }
}
