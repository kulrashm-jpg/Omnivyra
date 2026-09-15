import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Team Assignments API
 * GET /api/team/assignments - Get user assignments
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getUserAssignments, getCampaignTeam } from '../../../backend/services/teamService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85) — this route had no authentication at all:
  // anyone could list any user's assignments or any campaign's team.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { user_id, campaign_id, status } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (campaign_id) {
      // Get team for a campaign — the campaign must belong to the caller's tenant.
      const access = await requireCampaignAccess(req, res, typeof campaign_id === 'string' ? campaign_id : '');
      if (!access) return;
      const teamMembers = await getCampaignTeam(access.campaignId);
      return res.status(200).json({
        success: true,
        data: teamMembers,
      });
    }

    // Get assignments for a user — only the caller's own.
    if (user_id !== user.id) {
      return res.status(403).json({ error: 'Cannot read another user\'s assignments' });
    }
    const assignments = await getUserAssignments(user.id, {
      status: status as any,
    });

    res.status(200).json({
      success: true,
      data: assignments,
    });
  } catch (error: any) {
    console.error('Assignments API error:', error);
    res.status(500).json({
      error: 'Failed to fetch assignments',
      message: error.message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/team/assignments' });
