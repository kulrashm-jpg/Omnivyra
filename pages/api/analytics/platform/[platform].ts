/**
 * Analytics API - Get platform performance
 * GET /api/analytics/platform/[platform]
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformPerformance } from '../../../../backend/services/analyticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform } = req.query;
    const { start_date, end_date, user_id } = req.query;

    if (!platform || typeof platform !== 'string') {
      return res.status(400).json({ error: 'platform is required' });
    }

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    const startDate = new Date(start_date as string);
    const endDate = new Date(end_date as string);

    const performance = await getPlatformPerformance(user_id, platform, startDate, endDate);

    res.status(200).json({
      success: true,
      data: performance,
    });
  } catch (error: any) {
    console.error('Platform analytics API error:', error);
    res.status(500).json({
      error: 'Failed to fetch platform performance',
      message: error.message,
    });
  }
}

