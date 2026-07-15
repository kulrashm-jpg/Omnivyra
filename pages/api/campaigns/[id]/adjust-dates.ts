import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * Campaign Date Adjustment API
 * POST /api/campaigns/[id]/adjust-dates
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { adjustCampaignDates } from '../../../../backend/services/schedulingService';
import { logActivity } from '../../../../backend/services/activityLogger';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // SECURITY: enforce that the authenticated caller has access to this campaign's
    // company. Without this, any authenticated user could mutate another company's
    // campaign by guessing the path id.
    const access = await requireCampaignAccess(req, res, id);
    if (!access) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/adjust-dates' });
