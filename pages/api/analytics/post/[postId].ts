/**
 * Analytics API - Get post analytics
 * GET /api/analytics/post/[postId]
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getPostAnalytics } from '../../../../backend/services/analyticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { postId } = req.query;
    const { start_date, end_date } = req.query;

    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: 'postId is required' });
    }

    const startDate = start_date ? new Date(start_date as string) : undefined;
    const endDate = end_date ? new Date(end_date as string) : undefined;

    const analytics = await getPostAnalytics(postId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error: any) {
    console.error('Analytics API error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      message: error.message,
    });
  }
}

