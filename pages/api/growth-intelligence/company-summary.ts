/**
 * GET /api/growth-intelligence/company-summary
 * Company-level Growth Intelligence — aggregates metrics across all campaigns.
 * Phase-1 Read-Only. Reuses getGrowthIntelligenceSummary.
 * Auth: RBAC COMPANY_ADMIN, VIEW_ONLY, CONTENT_*
 *
 * Performance: Limits to latest 50 campaigns if company has more.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import {
  getGrowthIntelligenceSummary,
  resolveCampaignIdsForCompany,
} from '../../../backend/services/growthIntelligence';

const MAX_CAMPAIGNS_PROCESSED = 50;

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
    let campaignIds = await resolveCampaignIdsForCompany(supabase, companyId);

    if (campaignIds.length > MAX_CAMPAIGNS_PROCESSED) {
      const { data: ordered } = await supabase
        .from('campaigns')
        .select('id')
        .in('id', campaignIds)
        .order('created_at', { ascending: false })
        .limit(MAX_CAMPAIGNS_PROCESSED);
      campaignIds = (ordered ?? []).map((r: { id: string }) => r.id).filter(Boolean);
    }

    const campaignCount = campaignIds.length;

    let plannedPosts = 0;
    let scheduledPosts = 0;
    let publishedPosts = 0;
    let published = 0;
    let failed = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let totalShares = 0;
    let totalComments = 0;
    let totalEngagementRate = 0;
    let engagementRateCount = 0;
    let executedActions = 0;
    let campaignsFromOpportunities = 0;
    let growthScoreSum = 0;
    let contentVelocitySum = 0;
    let publishingSum = 0;
    let engagementSum = 0;
    let communitySum = 0;
    let opportunitySum = 0;
    let breakdownCount = 0;

    for (let i = 0; i < campaignIds.length; i++) {
      const summary = await getGrowthIntelligenceSummary(supabase, companyId, campaignIds[i]);
      plannedPosts += summary.contentVelocity.plannedPosts;
      scheduledPosts += summary.contentVelocity.scheduledPosts;
      publishedPosts += summary.contentVelocity.publishedPosts;
      published += summary.publishing.published;
      failed += summary.publishing.failed;
      totalViews += summary.engagement.totalViews;
      totalLikes += summary.engagement.totalLikes;
      totalShares += summary.engagement.totalShares;
      totalComments += summary.engagement.totalComments;
      if (Number.isFinite(summary.engagement.engagementRate)) {
        totalEngagementRate += summary.engagement.engagementRate;
        engagementRateCount += 1;
      }
      growthScoreSum += summary.growthScore;
      if (summary.scoreBreakdown) {
        contentVelocitySum += summary.scoreBreakdown.contentVelocity;
        publishingSum += summary.scoreBreakdown.publishing;
        engagementSum += summary.scoreBreakdown.engagement;
        communitySum += summary.scoreBreakdown.community;
        opportunitySum += summary.scoreBreakdown.opportunity;
        breakdownCount += 1;
      }
      if (i === 0) {
        executedActions = summary.community.executedActions;
        campaignsFromOpportunities = summary.opportunities.campaignsFromOpportunities;
      }
    }

    const totalPublishedOrFailed = published + failed;
    const successRate =
      totalPublishedOrFailed > 0 ? Math.round((published / totalPublishedOrFailed) * 1000) / 1000 : 0;

    const avgEngagementRate =
      engagementRateCount > 0 ? Math.round((totalEngagementRate / engagementRateCount) * 1000) / 1000 : 0;

    const avgGrowthScore =
      campaignCount > 0 ? Math.round((growthScoreSum / campaignCount) * 100) / 100 : 0;

    const avgContentVelocity =
      breakdownCount > 0 ? Math.round(contentVelocitySum / breakdownCount) : 0;
    const avgPublishing = breakdownCount > 0 ? Math.round(publishingSum / breakdownCount) : 0;
    const avgEngagement = breakdownCount > 0 ? Math.round(engagementSum / breakdownCount) : 0;
    const avgCommunity = breakdownCount > 0 ? Math.round(communitySum / breakdownCount) : 0;
    const avgOpportunity = breakdownCount > 0 ? Math.round(opportunitySum / breakdownCount) : 0;

    return res.status(200).json({
      success: true,
      data: {
        companyId,
        campaignCount,
        contentVelocity: {
          plannedPosts,
          scheduledPosts,
          publishedPosts,
        },
        publishing: {
          published,
          failed,
          successRate,
        },
        engagement: {
          totalViews,
          totalLikes,
          totalShares,
          totalComments,
          engagementRate: avgEngagementRate,
        },
        community: {
          executedActions,
        },
        opportunities: {
          campaignsFromOpportunities,
        },
        growthScore: avgGrowthScore,
        scoreBreakdown: {
          contentVelocity: avgContentVelocity,
          publishing: avgPublishing,
          engagement: avgEngagement,
          community: avgCommunity,
          opportunity: avgOpportunity,
        },
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch company growth summary';
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
