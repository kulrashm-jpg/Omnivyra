import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const { contentId, reason, ipAddress, userAgent } = req.body;

    if (!contentId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: contentId and reason' 
      });
    }

    // Get user role for audit
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    // Get content data before deletion for audit
    const { data: contentData, error: contentError } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contentId)
      .single();

    if (contentError || !contentData) {
      return res.status(404).json({
        error: 'Content not found',
        code: 'NOT_FOUND'
      });
    }

    // Log the deletion attempt
    const { error: logError } = await supabase
      .from('deletion_audit_log')
      .insert({
        user_id: user.id,
        user_role: userRole?.role || 'super_admin',
        action: 'delete_content',
        table_name: 'content_items',
        record_id: contentId,
        record_data: contentData,
        reason: reason,
        ip_address: ipAddress || '127.0.0.1',
        user_agent: userAgent || 'Unknown'
      });

    if (logError) {
      console.error('Error logging deletion:', logError);
    }

    // Delete the content
    const { error: deleteError } = await supabase
      .from('content_items')
      .delete()
      .eq('id', contentId);

    if (deleteError) {
      console.error('Error deleting content:', deleteError);
      return res.status(500).json({ 
        error: 'Failed to delete content',
        details: deleteError.message 
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Content deleted successfully',
      contentId: contentId,
      deleted_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in delete-content API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
