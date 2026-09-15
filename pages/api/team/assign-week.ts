import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Team Assignment API
 * POST /api/team/assign-week
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { assignWeek, updateWeekStatus } from '../../../backend/services/teamService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { getUserRole } from '../../../backend/services/rbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

      // ROUTE-AUTH-001 (STEP 3AH-85) — bind the campaign to the caller's tenant
      // (foreign/unknown → 404, non-member → 403). The actor is the
      // authenticated caller: a different assigned_by_user_id is refused.
      const access = await requireCampaignAccess(req, res, String(campaign_id));
      if (!access) return;
      if (assigned_by_user_id !== access.userId) {
        return res.status(403).json({ error: 'assigned_by_user_id must be the authenticated user' });
      }
      // The assignee must be a member of the campaign's company.
      const assignee = await getUserRole(String(assigned_to_user_id), access.companyId);
      if (!assignee.role) {
        return res.status(400).json({ error: 'Assignee is not a member of this company' });
      }

      await assignWeek(access.campaignId, week_number, String(assigned_to_user_id), access.userId);

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

      // ROUTE-AUTH-001 (STEP 3AH-85) — bind the campaign; user_id (the actor)
      // must be the authenticated caller.
      const access = await requireCampaignAccess(req, res, String(campaign_id));
      if (!access) return;
      if (user_id !== access.userId) {
        return res.status(403).json({ error: 'user_id must be the authenticated user' });
      }

      await updateWeekStatus(access.campaignId, week_number, status, access.userId, notes);

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/team/assign-week' });
