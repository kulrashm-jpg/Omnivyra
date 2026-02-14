/**
 * Pre-Planning Service — collects inputs and runs HorizonConstraintEvaluator.
 * Fetches: content inventory, production capacity, budget, campaign type weights, baseline.
 */

import { evaluateCampaignDuration } from './HorizonConstraintEvaluator';
import type { DurationEvaluationResult } from '../types/CampaignDuration';
import { supabase } from '../db/supabaseClient';
import { listAssetsWithLatestContent } from '../db/contentAssetStore';
import { getLatestCampaignVersion } from '../db/campaignVersionStore';
import { getProfile } from './companyProfileService';
import { classifyBaseline, computeExpectedBaseline } from './baselineClassificationService';

export interface PrePlanningInput {
  companyId: string;
  campaignId: string;
  requested_weeks: number;
}

const DEFAULT_EXPECTED_POSTS_PER_WEEK = 5;
const DEFAULT_COST_PER_WEEK = 100;

export async function runPrePlanning(input: PrePlanningInput): Promise<DurationEvaluationResult> {
  const { companyId, campaignId, requested_weeks } = input;

  const [contentAssets, campaignVersion, profile, campaignResult] = await Promise.all([
    listAssetsWithLatestContent({ campaignId }),
    getLatestCampaignVersion(companyId, campaignId),
    getProfile(companyId, { autoRefine: false }),
    supabase.from('campaigns').select('id, budget, start_date, end_date, priority_level').eq('id', campaignId).maybeSingle(),
  ]);

  const campaignRow = campaignResult?.data;
  const existing_content_count = contentAssets?.length ?? 0;

  const snapshot = campaignVersion?.campaign_snapshot;
  const campaignTypes = snapshot?.campaign_types ?? snapshot?.campaign?.campaign_types;
  const campaignWeights = snapshot?.campaign_weights ?? snapshot?.campaign?.campaign_weights ?? {};
  const companyStage = snapshot?.company_stage ?? profile?.company_stage ?? 'early_stage';
  const marketScope = snapshot?.market_scope ?? profile?.market_scope ?? 'niche';

  let expected_posts_per_week = DEFAULT_EXPECTED_POSTS_PER_WEEK;
  if (snapshot?.platform_frequency && typeof snapshot.platform_frequency === 'object') {
    const freq = snapshot.platform_frequency as Record<string, number>;
    expected_posts_per_week = Math.max(1, Object.values(freq).reduce((a, b) => a + b, 0));
  }

  let team_posts_per_week_capacity: number | undefined;
  const teamData = (profile as any)?.team;
  if (teamData && typeof teamData === 'object' && typeof teamData.posts_per_week === 'number') {
    team_posts_per_week_capacity = teamData.posts_per_week;
  }

  const total_budget = campaignRow?.budget
    ? Number(campaignRow.budget)
    : undefined;
  const cost_per_week =
    total_budget != null && total_budget > 0 ? total_budget / 12 : DEFAULT_COST_PER_WEEK;

  let baseline_status: 'underdeveloped' | 'aligned' | 'strong' = 'aligned';
  const actualFollowers = (profile as any)?.followers ?? (profile as any)?.actual_baseline ?? 0;
  const expectedBaseline = computeExpectedBaseline(companyStage, marketScope);
  if (expectedBaseline > 0) {
    const classified = classifyBaseline(actualFollowers, expectedBaseline);
    baseline_status = classified.status;
  }

  const requestedPostsPerWeek =
    existing_content_count > 0
      ? Math.ceil(existing_content_count / requested_weeks)
      : expected_posts_per_week;

  const startDate =
    campaignRow?.start_date != null
      ? (typeof campaignRow.start_date === 'string'
          ? campaignRow.start_date
          : (campaignRow.start_date as Date)?.toISOString?.()?.slice(0, 10))
      : undefined;
  const endDate =
    campaignRow?.end_date != null
      ? (typeof campaignRow.end_date === 'string'
          ? campaignRow.end_date
          : (campaignRow.end_date as Date)?.toISOString?.()?.slice(0, 10))
      : undefined;

  const campaignPriorityLevel =
    campaignRow?.priority_level != null
      ? String(campaignRow.priority_level)
      : undefined;

  return evaluateCampaignDuration({
    requested_weeks,
    existing_content_count,
    expected_posts_per_week,
    team_posts_per_week_capacity,
    total_budget,
    cost_per_week,
    baseline_status,
    campaign_type_weights: campaignWeights as Record<string, number>,
    lead_heavy_minimum_weeks: 3,
    campaignId,
    companyId,
    startDate,
    endDate,
    requestedPostsPerWeek,
    campaignPriorityLevel,
  });
}
