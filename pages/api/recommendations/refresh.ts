import { NextApiRequest, NextApiResponse } from 'next';
import {
  runCompanyProfileTriggeredRefresh,
  runWeeklyRecommendationRefresh,
} from '../../../backend/services/recommendationScheduler';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode, companyId } = req.body || {};

  try {
    if (mode === 'weekly') {
      await runWeeklyRecommendationRefresh();
    } else if (mode === 'company') {
      await runCompanyProfileTriggeredRefresh(companyId);
    } else {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error refreshing recommendations:', error);
    return res.status(500).json({ error: 'Failed to refresh recommendations' });
  }
}
