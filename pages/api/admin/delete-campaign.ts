import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCompanyCampaignIds } from '../../../backend/db/campaignVersionStore';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  isSuperAdmin,
  getUserRole,
  getCompanyRoleIncludingInvited,
  Role,
} from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    const message = authError === 'MISSING_AUTH'
      ? 'No auth token provided. Please sign in and try again.'
      : authError === 'INVALID_AUTH'
        ? 'Invalid or expired session. Please refresh the page and sign in again.'
        : 'Unauthorized';
    return res.status(401).json({ error: message, code: authError || 'UNAUTHORIZED' });
  }

  try {
    const { campaignId, reason, ipAddress, userAgent } = req.body;
    const companyId = (req.query.companyId as string) || req.body.companyId;

    if (!campaignId) {
      return res.status(400).json({ 
        error: 'Missing required field: campaignId' 
      });
    }

    const superAdmin = await isSuperAdmin(user.id);
    let isCompanyAdmin = false;
    if (companyId) {
      const { role } = await getUserRole(user.id, companyId);
      if (role === Role.COMPANY_ADMIN || role === Role.ADMIN) isCompanyAdmin = true;
      if (!isCompanyAdmin) {
        const fallback = await getCompanyRoleIncludingInvited(user.id, companyId);
        isCompanyAdmin =
          fallback === Role.COMPANY_ADMIN || fallback === Role.ADMIN;
      }
    }

    if (!superAdmin && !isCompanyAdmin) {
      return res.status(403).json({ error: 'Forbidden: Only super admins or company admins can delete campaigns.' });
    }

    if (isCompanyAdmin && !superAdmin) {
      const companyCampaignIds = await getCompanyCampaignIds(companyId);
      if (!companyCampaignIds.includes(campaignId)) {
        return res.status(403).json({ error: 'Forbidden: Campaign does not belong to your company.' });
      }
      // Delete all campaign-related data before deleting the campaign (order: child tables first)
      const tablesWithCampaignId = [
        'daily_content_plans',
        'weekly_content_refinements',
        'weekly_content_plans',
        'twelve_week_plan',
        'campaign_analytics',
        'ai_feedback',
        'ai_improvements',
        'campaign_learnings',
        'content_plans',
        'ai_threads',
        'campaign_performance',
        'campaign_goals',
        'campaign_resource_projection',
        'campaign_readiness',
        'campaign_governance_events',
        'governance_snapshots',
        'governance_projections',
        'scheduled_posts',
      ];
      for (const table of tablesWithCampaignId) {
        const { error: delError } = await supabase.from(table).delete().eq('campaign_id', campaignId);
        if (delError) console.warn(`Delete ${table}:`, delError);
      }
      // Preemption logs/requests use initiator/target campaign IDs (delete in two passes)
      const { error: preemptInit } = await supabase.from('campaign_preemption_log').delete().eq('initiator_campaign_id', campaignId);
      if (preemptInit) console.warn('Delete campaign_preemption_log initiator:', preemptInit);
      const { error: preemptPreempt } = await supabase.from('campaign_preemption_log').delete().eq('preempted_campaign_id', campaignId);
      if (preemptPreempt) console.warn('Delete campaign_preemption_log preempted:', preemptPreempt);
      const { error: preemptReqInit } = await supabase.from('campaign_preemption_requests').delete().eq('initiator_campaign_id', campaignId);
      if (preemptReqInit) console.warn('Delete campaign_preemption_requests initiator:', preemptReqInit);
      const { error: preemptReqTgt } = await supabase.from('campaign_preemption_requests').delete().eq('target_campaign_id', campaignId);
      if (preemptReqTgt) console.warn('Delete campaign_preemption_requests target:', preemptReqTgt);
      const { error: cvError } = await supabase.from('campaign_versions').delete().eq('campaign_id', campaignId);
      if (cvError) console.warn('Delete campaign_versions:', cvError);
      const { error: campError } = await supabase.from('campaigns').delete().eq('id', campaignId);
      if (campError) {
        console.error('Error deleting campaign:', campError);
        return res.status(500).json({ error: 'Failed to delete campaign', details: campError.message });
      }
      return res.status(200).json({ success: true, message: 'Campaign deleted successfully' });
    }

    const { data, error } = await supabase.rpc('safe_delete_campaign', {
      p_campaign_id: campaignId,
      p_user_id: user.id,
      p_reason: reason || null,
      p_ip_address: ipAddress || '127.0.0.1',
      p_user_agent: userAgent || 'Unknown'
    });

    if (error) {
      console.error('Error deleting campaign:', error);
      return res.status(500).json({ 
        error: 'Failed to delete campaign',
        details: error.message 
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error in delete-campaign API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






