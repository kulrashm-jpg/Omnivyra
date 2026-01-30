import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../../backend/services/recommendationEngineService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, objective, durationWeeks } = req.body || {};
    if (!companyId || !campaignId) {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;
    console.log('RECOMMENDATION_REQUEST', { companyId, campaignId });

    const result = await generateRecommendations({
      companyId,
      campaignId,
      objective,
      durationWeeks,
      userId: access.userId,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error generating recommendations:', error);
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}
