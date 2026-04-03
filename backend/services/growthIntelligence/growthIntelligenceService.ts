/**
 * Growth Intelligence Service - Phase-1 Read-Only
 * Aggregates metrics from existing tables. SELECT only, no writes.
 * No worker imports, no schema changes.
 * Optional in-memory cache (60s TTL) for expensive aggregations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GrowthSummary } from './types';
import { getCachedGrowth, setCachedGrowth } from './cache/growthCache';
import { getContentVelocityMetrics } from './metrics/contentVelocity';
import { getPublishingSuccessMetrics } from './metrics/publishingSuccess';
import { getEngagementScore } from './metrics/engagementScore';
import { getCommunityEngagementMetrics } from './metrics/communityEngagement';
import { getOpportunityActivationMetrics } from './metrics/opportunityActivation';
import {
  archiveDecisionScope,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from '../decisionObjectService';
import { assertBackgroundJobContext } from '../intelligenceExecutionContext';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a value to 0-1 against a max threshold.
 * Enables stable cross-company and cross-campaign score comparison.
 */
function normalize(value: number, max: number): number {
  if (!value) return 0;
  if (!max || !Number.isFinite(max)) return 0;
  return Math.min(value / max, 1);
}

/**
 * Resolve campaign IDs for a company.
 * Uses campaign_versions first; falls back to user_company_roles + campaigns.
 */
export async function resolveCampaignIdsForCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<string[]> {
  const ids = new Set<string>();

  try {
    const { data: versions } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId);

    for (const row of versions ?? []) {
      const cid = (row as { campaign_id?: string }).campaign_id;
      if (cid) ids.add(cid);
    }

    if (ids.size > 0) return Array.from(ids);

    const { data: roles } = await supabase
      .from('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active');

    const userIds = (roles ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
    if (userIds.length === 0) return [];

    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id')
      .in('user_id', userIds);

    for (const row of campaigns ?? []) {
      const id = (row as { id: string }).id;
      if (id) ids.add(id);
    }

    return Array.from(ids);
  } catch {
    return [];
  }
}

export async function getGrowthIntelligenceSummary(
  supabase: SupabaseClient,
  companyId: string,
  campaignId?: string
): Promise<GrowthSummary> {
  try {
    const cached = getCachedGrowth(companyId, campaignId);
    if (cached) return cached;
  } catch {
    // fail-safe: continue to compute
  }

  const campaignIds = campaignId ? [campaignId] : await resolveCampaignIdsForCompany(supabase, companyId);

  const [contentVelocity, publishing, engagement, community, opportunities] = await Promise.all([
    getContentVelocityMetrics(supabase, campaignIds),
    getPublishingSuccessMetrics(supabase, campaignIds),
    getEngagementScore(supabase, campaignIds),
    getCommunityEngagementMetrics(supabase, companyId),
    getOpportunityActivationMetrics(supabase, companyId),
  ]);

  // Normalized components for stable scoring across different activity volumes
  // publishedPosts normalized against 30 posts per cycle (prevents large campaigns from dominating)
  const contentVelocityScore = normalize(contentVelocity.publishedPosts, 30);
  // successRate is 0-1 (e.g. 0.85 = 85%)
  const publishingScore = Math.min(publishing.successRate, 1);
  // engagementRate normalized against 10% benchmark (stored as percentage, e.g. 5.5 = 5.5%)
  const engagementScore = normalize(engagement.engagementRate, 10);
  // community actions normalized against 50 actions (active engagement threshold)
  const communityScore = normalize(community.executedActions, 50);
  // campaignsFromOpportunities normalized against 10 opportunities (strong activation)
  const opportunityScore = normalize(opportunities.campaignsFromOpportunities, 10);

  // Component contributions (weight x 100): explainability for how growthScore is built
  // contentVelocity weight 20%
  const contentVelocityContribution = contentVelocityScore * 0.2 * 100;
  // publishing weight 25%
  const publishingContribution = publishingScore * 0.25 * 100;
  // engagement weight 30% (highest impact)
  const engagementContribution = engagementScore * 0.3 * 100;
  // community weight 15%
  const communityContribution = communityScore * 0.15 * 100;
  // opportunity weight 10%
  const opportunityContribution = opportunityScore * 0.1 * 100;

  const rawScore =
    contentVelocityContribution +
    publishingContribution +
    engagementContribution +
    communityContribution +
    opportunityContribution;

  const growthScore = Math.round(Math.max(0, Math.min(100, rawScore)));

  const summary: GrowthSummary = {
    companyId,
    campaignId,
    contentVelocity,
    publishing,
    engagement,
    community,
    opportunities,
    growthScore,
    scoreBreakdown: {
      contentVelocity: Math.round(contentVelocityContribution),
      publishing: Math.round(publishingContribution),
      engagement: Math.round(engagementContribution),
      community: Math.round(communityContribution),
      opportunity: Math.round(opportunityContribution),
    },
  };

  try {
    setCachedGrowth(companyId, summary, campaignId);
  } catch {
    // fail-safe: ignore cache write errors
  }

  return summary;
}

export async function generateGrowthIntelligenceDecisions(
  supabase: SupabaseClient,
  companyId: string,
  campaignId?: string
): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('growthIntelligenceService');
  const summary = await getGrowthIntelligenceSummary(supabase, companyId, campaignId);
  const entityType = campaignId ? 'campaign' as const : 'global' as const;
  const entityId = campaignId ?? null;
  const decisions = [];

  if (summary.contentVelocity.plannedPosts > summary.contentVelocity.publishedPosts) {
    const unpublished = summary.contentVelocity.plannedPosts - summary.contentVelocity.publishedPosts;
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'growthIntelligenceService',
      entity_type: entityType,
      entity_id: entityId,
      issue_type: 'content_gap',
      title: 'Planned content is not reaching publish velocity',
      description: `Only ${summary.contentVelocity.publishedPosts} of ${summary.contentVelocity.plannedPosts} planned posts were published.`,
      evidence: {
        planned_posts: summary.contentVelocity.plannedPosts,
        scheduled_posts: summary.contentVelocity.scheduledPosts,
        published_posts: summary.contentVelocity.publishedPosts,
        unpublished_gap: unpublished,
      },
      impact_traffic: clamp(30 + unpublished * 5, 0, 100),
      impact_conversion: clamp(20 + unpublished * 3, 0, 100),
      impact_revenue: clamp(15 + unpublished * 2, 0, 100),
      priority_score: clamp(25 + unpublished * 4, 0, 100),
      effort_score: 30,
      confidence_score: 0.91,
      recommendation: 'Close the publish gap before adding more content volume.',
      action_type: 'improve_content',
      action_payload: {
        entity_scope: campaignId ? 'campaign' : 'company',
        campaign_id: campaignId ?? null,
        planned_posts: summary.contentVelocity.plannedPosts,
        published_posts: summary.contentVelocity.publishedPosts,
      },
      status: 'open' as const,
    });
  }

  if (summary.publishing.successRate < 0.85) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'growthIntelligenceService',
      entity_type: entityType,
      entity_id: entityId,
      issue_type: 'publishing_failure_risk',
      title: 'Publishing reliability is below target',
      description: `Publishing success rate is ${(summary.publishing.successRate * 100).toFixed(1)}%, creating delivery risk.`,
      evidence: {
        published: summary.publishing.published,
        failed: summary.publishing.failed,
        success_rate: summary.publishing.successRate,
      },
      impact_traffic: clamp(Math.round((1 - summary.publishing.successRate) * 120), 0, 100),
      impact_conversion: clamp(Math.round((1 - summary.publishing.successRate) * 90), 0, 100),
      impact_revenue: clamp(Math.round((1 - summary.publishing.successRate) * 70), 0, 100),
      priority_score: clamp(Math.round((1 - summary.publishing.successRate) * 110), 0, 100),
      effort_score: 25,
      confidence_score: 0.95,
      recommendation: 'Fix publish failures before scaling spend or content volume.',
      action_type: 'fix_distribution',
      action_payload: {
        entity_scope: campaignId ? 'campaign' : 'company',
        campaign_id: campaignId ?? null,
        failed_publications: summary.publishing.failed,
      },
      status: 'open' as const,
    });
  }

  if (summary.engagement.engagementRate < 3) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'growthIntelligenceService',
      entity_type: entityType,
      entity_id: entityId,
      issue_type: 'engagement_drop',
      title: 'Engagement rate is below the operating benchmark',
      description: `Engagement rate is ${summary.engagement.engagementRate.toFixed(2)}%, well below the 3% operating threshold.`,
      evidence: {
        engagement_rate: summary.engagement.engagementRate,
        total_views: summary.engagement.totalViews,
        total_likes: summary.engagement.totalLikes,
        total_comments: summary.engagement.totalComments,
        total_shares: summary.engagement.totalShares,
      },
      impact_traffic: clamp(40 + Math.round((3 - summary.engagement.engagementRate) * 10), 0, 100),
      impact_conversion: clamp(45 + Math.round((3 - summary.engagement.engagementRate) * 12), 0, 100),
      impact_revenue: clamp(35 + Math.round((3 - summary.engagement.engagementRate) * 10), 0, 100),
      priority_score: clamp(50 + Math.round((3 - summary.engagement.engagementRate) * 10), 0, 100),
      effort_score: 20,
      confidence_score: 0.92,
      recommendation: 'Rewrite hooks, offers, and CTA sequencing before increasing campaign volume.',
      action_type: 'fix_cta',
      action_payload: {
        entity_scope: campaignId ? 'campaign' : 'company',
        campaign_id: campaignId ?? null,
        engagement_rate: summary.engagement.engagementRate,
      },
      status: 'open' as const,
    });
  }

  if (
    summary.opportunities.availableOpportunities > 0 &&
    summary.opportunities.campaignsFromOpportunities < summary.opportunities.availableOpportunities
  ) {
    const activationGap = summary.opportunities.availableOpportunities - summary.opportunities.campaignsFromOpportunities;
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'growthIntelligenceService',
      entity_type: entityType,
      entity_id: entityId,
      issue_type: 'opportunity_activation_gap',
      title: 'Detected opportunities are not being activated',
      description: `${activationGap} detected opportunities have not turned into campaigns yet.`,
      evidence: {
        available_opportunities: summary.opportunities.availableOpportunities,
        campaigns_from_opportunities: summary.opportunities.campaignsFromOpportunities,
        activation_gap: activationGap,
      },
      impact_traffic: clamp(25 + activationGap * 6, 0, 100),
      impact_conversion: clamp(35 + activationGap * 7, 0, 100),
      impact_revenue: clamp(45 + activationGap * 8, 0, 100),
      priority_score: clamp(40 + activationGap * 7, 0, 100),
      effort_score: 35,
      confidence_score: 0.88,
      recommendation: 'Promote top opportunities into active campaigns instead of letting them sit in backlog.',
      action_type: 'launch_campaign',
      action_payload: {
        entity_scope: campaignId ? 'campaign' : 'company',
        campaign_id: campaignId ?? null,
        activation_gap: activationGap,
      },
      status: 'open' as const,
    });
  }

  if (decisions.length === 0) {
    await archiveDecisionScope({
      company_id: companyId,
      report_tier: 'growth',
      source_service: 'growthIntelligenceService',
      entity_type: entityType,
      entity_id: entityId,
      changed_by: 'system',
    });
    return [];
  }

  return replaceDecisionObjectsForSource(decisions);
}
