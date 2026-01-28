/**
 * Campaign Date Adjustment API
 * POST /api/campaigns/[id]/adjust-dates
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { adjustCampaignDates } from '../../../../backend/services/schedulingService';
import { logActivity } from '../../../../backend/services/activityLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { new_start_date, user_id } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    if (!new_start_date || !user_id) {
      return res.status(400).json({ error: 'new_start_date and user_id are required' });
    }

    const newStartDate = new Date(new_start_date);
    const result = await adjustCampaignDates(id, newStartDate, user_id);

    // Log activity
    await logActivity(user_id, 'campaign_updated', 'campaign', id, {
      date_adjusted: true,
      ...result,
    });

    res.status(200).json({
      success: true,
      message: 'Campaign dates adjusted successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Date adjustment error:', error);
    res.status(500).json({
      error: 'Failed to adjust campaign dates',
      message: error.message,
    });
  }
}

