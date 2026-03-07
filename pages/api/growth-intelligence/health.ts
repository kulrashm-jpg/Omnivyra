/**
 * GET /api/growth-intelligence/health
 * Diagnostics endpoint to validate Growth Intelligence system operation.
 * Phase-1 Read-Only. SELECT queries only.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { resolveCampaignIdsForCompany } from '../../../backend/services/growthIntelligence';

type SystemHealth = 'healthy' | 'partial' | 'empty';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'companyId is required' });
  }

  try {
    const campaignIds = await resolveCampaignIdsForCompany(supabase, companyId);
    const campaignCount = campaignIds.length;

    let scheduledPostCount = 0;
    let analyticsRecords = 0;

    if (campaignIds.length > 0) {
      const { count: scheduledCount } = await supabase
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .in('campaign_id', campaignIds);
      scheduledPostCount = scheduledCount ?? 0;

      if (scheduledPostCount > 0) {
        const { data: postIds } = await supabase
          .from('scheduled_posts')
          .select('id')
          .in('campaign_id', campaignIds);
        const ids = (postIds ?? []).map((r: { id: string }) => r.id).filter(Boolean);
        if (ids.length > 0) {
          const { count: analyticsCount } = await supabase
            .from('content_analytics')
            .select('id', { count: 'exact', head: true })
            .in('scheduled_post_id', ids);
          analyticsRecords = analyticsCount ?? 0;
        }
      }
    }

    const { count: communityCount } = await supabase
      .from('community_ai_actions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', companyId);
    const communityActions = communityCount ?? 0;

    const { count: opportunityCount } = await supabase
      .from('theme_company_relevance')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    const opportunitySignals = opportunityCount ?? 0;

    const hasCampaigns = campaignCount > 0;
    const hasScheduledPosts = scheduledPostCount > 0;
    const hasAnalytics = analyticsRecords > 0;
    const hasCommunityData = communityActions > 0;
    const hasOpportunitySignals = opportunitySignals > 0;

    let systemHealth: SystemHealth = 'empty';
    if (hasCampaigns && hasScheduledPosts) {
      systemHealth = 'healthy';
    } else if (hasCampaigns) {
      systemHealth = 'partial';
    }

    return res.status(200).json({
      success: true,
      data: {
        companyId,
        counts: {
          campaigns: campaignCount,
          scheduledPosts: scheduledPostCount,
          analyticsRecords,
          communityActions,
          opportunitySignals,
        },
        flags: {
          hasCampaigns,
          hasScheduledPosts,
          hasAnalytics,
          hasCommunityData,
          hasOpportunitySignals,
        },
        systemHealth,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    return res.status(500).json({ success: false, error: message });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.VIEW_ONLY,
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.SUPER_ADMIN,
]);
