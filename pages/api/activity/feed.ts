/**
 * Activity Feed API
 * GET /api/activity/feed
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getActivityFeed } from '../../../backend/services/activityLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { campaign_id, action_type, entity_type, start_date, end_date, limit, offset } = req.query;

    // Always use the authenticated user's own ID — never accept user_id from query (IDOR prevention)
    const activities = await getActivityFeed(user.id, {
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
