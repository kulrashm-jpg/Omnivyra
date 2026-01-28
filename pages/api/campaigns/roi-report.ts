import type { NextApiRequest, NextApiResponse } from 'next';
import { calculateROI } from '../../../backend/services/roiService';
import { saveRoiReport } from '../../../backend/db/forecastStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, costInputs, performanceMetrics } = req.body || {};
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const roi = calculateROI({ campaignId, costInputs: costInputs ?? {}, performanceMetrics });
    await saveRoiReport({ campaignId, roi });
    console.log('ROI CALCULATED', { campaignId });
    return res.status(200).json(roi);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to calculate ROI' });
  }
}
