import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { activityId, reason, ipAddress, userAgent } = req.body;

    if (!activityId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: activityId and reason' 
      });
    }

    // Get activity data before deletion for audit
    const { data: activityData, error: activityError } = await supabase
      .from('daily_content_plans')
      .select('*')
      .eq('id', activityId)
      .single();

    if (activityError || !activityData) {
      return res.status(404).json({
        error: 'Activity not found',
        code: 'NOT_FOUND'
      });
    }

    // Log the deletion attempt
    const { error: logError } = await supabase
      .from('super_admin_audit_logs')
      .insert({
        actor_user_id: user.id,
        action: 'delete_activity',
        target_type: 'daily_content_plans',
        target_id: activityId,
        metadata: {
          record_data: activityData,
          reason,
          ip_address: ipAddress || '127.0.0.1',
          user_agent: userAgent || 'Unknown',
        },
      });

    if (logError) {
      console.error('Error logging deletion:', logError);
    }

    // Delete the activity via execution engine
    const { deleteActivity } = await import('../../../backend/services/executionPlannerService');
    try {
      await deleteActivity(activityId);
    } catch (deleteError) {
      console.error('Error deleting activity:', deleteError);
      return res.status(500).json({
        error: 'Failed to delete activity',
        details: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Activity deleted successfully',
      activityId: activityId,
      deleted_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in delete-activity API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/delete-activity' });
