import type { NextApiRequest, NextApiResponse } from 'next';
import { computeAnalytics } from '../../../backend/services/analyticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, timeframe } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const report = await computeAnalytics({ companyId, campaignId, timeframe });
    return res.status(200).json(report);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to compute analytics' });
  }
}
