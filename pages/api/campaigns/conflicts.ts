/**
 * Campaign Conflict Detection API
 * GET /api/campaigns/conflicts
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { detectCampaignConflicts, suggestAvailableDateRange } from '../../../backend/services/schedulingService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, start_date, end_date, exclude_campaign_id, suggest_duration } = req.query;

    if (!user_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'user_id, start_date, and end_date are required' });
    }

    const startDate = new Date(start_date as string);
    const endDate = new Date(end_date as string);

    const conflicts = await detectCampaignConflicts(
      user_id as string,
      startDate,
      endDate,
      exclude_campaign_id as string
    );

    let suggestion = null;
    if (suggest_duration) {
      const duration = parseInt(suggest_duration as string);
      suggestion = await suggestAvailableDateRange(user_id as string, duration, startDate);
    }

    res.status(200).json({
      success: true,
      data: {
        conflicts,
        suggestion,
      },
    });
  } catch (error: any) {
    console.error('Conflict detection error:', error);
    res.status(500).json({
      error: 'Failed to detect conflicts',
      message: error.message,
    });
  }
}

