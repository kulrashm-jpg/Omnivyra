/**
 * Activity Feed API
 * GET /api/activity/feed
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getActivityFeed } from '../../../backend/services/activityLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, campaign_id, action_type, entity_type, start_date, end_date, limit, offset } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const activities = await getActivityFeed(user_id, {
      campaign_id: campaign_id as string,
      action_type: action_type as any,
      entity_type: entity_type as any,
      start_date: start_date ? new Date(start_date as string) : undefined,
      end_date: end_date ? new Date(end_date as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.status(200).json({
      success: true,
      data: activities,
    });
  } catch (error: any) {
    console.error('Activity feed API error:', error);
    res.status(500).json({
      error: 'Failed to fetch activity feed',
      message: error.message,
    });
  }
}

