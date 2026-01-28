/**
 * Campaign Risk Assessment API
 * GET /api/campaigns/[id]/risk
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { assessCampaignRisk } from '../../../../backend/services/riskAssessor';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    const assessment = await assessCampaignRisk(id);

    res.status(200).json({
      success: true,
      data: assessment,
    });
  } catch (error: any) {
    console.error('Risk assessment error:', error);
    res.status(500).json({
      error: 'Failed to assess risk',
      message: error.message,
    });
  }
}

