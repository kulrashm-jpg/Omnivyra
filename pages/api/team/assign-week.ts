/**
 * Team Assignment API
 * POST /api/team/assign-week
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { assignWeek, updateWeekStatus } from '../../../backend/services/teamService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    try {
      const { campaign_id, week_number, assigned_to_user_id, assigned_by_user_id } = req.body;

      if (!campaign_id || !week_number || !assigned_to_user_id || !assigned_by_user_id) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await assignWeek(campaign_id, week_number, assigned_to_user_id, assigned_by_user_id);

      res.status(200).json({
        success: true,
        message: 'Week assigned successfully',
      });
    } catch (error: any) {
      console.error('Assignment error:', error);
      res.status(500).json({
        error: 'Failed to assign week',
        message: error.message,
      });
    }
  } else if (req.method === 'PATCH') {
    try {
      const { campaign_id, week_number, status, user_id, notes } = req.body;

      if (!campaign_id || !week_number || !status || !user_id) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await updateWeekStatus(campaign_id, week_number, status, user_id, notes);

      res.status(200).json({
        success: true,
        message: 'Week status updated',
      });
    } catch (error: any) {
      console.error('Status update error:', error);
      res.status(500).json({
        error: 'Failed to update status',
        message: error.message,
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

