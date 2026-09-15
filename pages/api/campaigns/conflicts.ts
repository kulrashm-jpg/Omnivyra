import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Campaign Conflict Detection API
 * GET /api/campaigns/conflicts
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { detectCampaignConflicts, suggestAvailableDateRange } from '../../../backend/services/schedulingService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001: conflicts are computed over the CALLER's own campaigns.
  // The user is the authenticated identity, never a query parameter.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const { user_id, start_date, end_date, exclude_campaign_id, suggest_duration } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    // Legacy callers passed user_id; it may only ever name the caller.
    if (user_id !== undefined && String(user_id) !== user.id) {
      return res.status(403).json({ error: 'user_id must be the authenticated user' });
    }

    // exclude_campaign_id only narrows the caller's own list, but it is still
    // a campaign id from the request: bind it to the caller's tenant.
    let excludeCampaignId: string | undefined;
    if (exclude_campaign_id) {
      const access = await requireCampaignAccess(req, res, exclude_campaign_id as string);
      if (!access) return;
      excludeCampaignId = access.campaignId;
    }

    const startDate = new Date(start_date as string);
    const endDate = new Date(end_date as string);

    const conflicts = await detectCampaignConflicts(
      user.id,
      startDate,
      endDate,
      excludeCampaignId
    );

    let suggestion = null;
    if (suggest_duration) {
      const duration = parseInt(suggest_duration as string);
      suggestion = await suggestAvailableDateRange(user.id, duration, startDate);
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/conflicts' });
