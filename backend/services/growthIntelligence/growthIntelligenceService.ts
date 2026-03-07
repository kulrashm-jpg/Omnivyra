/**
 * Growth Intelligence Service — Phase-1 Read-Only
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a value to 0–1 against a max threshold.
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
  // successRate is 0–1 (e.g. 0.85 = 85%)
  const publishingScore = Math.min(publishing.successRate, 1);
  // engagementRate normalized against 10% benchmark (stored as percentage, e.g. 5.5 = 5.5%)
  const engagementScore = normalize(engagement.engagementRate, 10);
  // community actions normalized against 50 actions (active engagement threshold)
  const communityScore = normalize(community.executedActions, 50);
  // campaignsFromOpportunities normalized against 10 opportunities (strong activation)
  const opportunityScore = normalize(opportunities.campaignsFromOpportunities, 10);

  // Component contributions (weight × 100): explainability for how growthScore is built
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
