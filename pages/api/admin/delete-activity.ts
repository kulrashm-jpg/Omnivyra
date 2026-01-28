import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { activityId, reason, ipAddress, userAgent } = req.body;

    if (!activityId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: activityId and reason' 
      });
    }

    // Get current user ID (you'll need to implement proper auth)
    const userId = 'current-user-id'; // Replace with actual user ID from auth

    // Check if user is super admin
    const { data: isSuperAdmin, error: checkError } = await supabase.rpc('is_super_admin', {
      check_user_id: userId
    });

    if (checkError || !isSuperAdmin) {
      return res.status(403).json({ 
        error: 'Access denied. Only super admins can delete activities.',
        code: 'INSUFFICIENT_PRIVILEGES'
      });
    }

    // Get user role for audit
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

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
      .from('deletion_audit_log')
      .insert({
        user_id: userId,
        user_role: userRole?.role || 'super_admin',
        action: 'delete_activity',
        table_name: 'daily_content_plans',
        record_id: activityId,
        record_data: activityData,
        reason: reason,
        ip_address: ipAddress || '127.0.0.1',
        user_agent: userAgent || 'Unknown'
      });

    if (logError) {
      console.error('Error logging deletion:', logError);
    }

    // Delete the activity
    const { error: deleteError } = await supabase
      .from('daily_content_plans')
      .delete()
      .eq('id', activityId);

    if (deleteError) {
      console.error('Error deleting activity:', deleteError);
      return res.status(500).json({ 
        error: 'Failed to delete activity',
        details: deleteError.message 
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






