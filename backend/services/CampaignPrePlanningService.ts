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
  /** Stage 24: Suppress governance event emission during replay */
  suppressEvents?: boolean;
  /** Stage 26: Optional policy version for evaluation. Default = current. Replay uses stored version. */
  policyVersion?: string;
}

const DEFAULT_EXPECTED_POSTS_PER_WEEK = 5;
const DEFAULT_COST_PER_WEEK = 100;

const VIDEO_PLATFORMS = new Set(['youtube', 'tiktok', 'instagram']);

function deriveContentTypeFromAsset(asset: any): string {
  const content = asset?.latest_content ?? asset?.content_json ?? {};
  const type = content?.content_type ?? content?.contentType ?? content?.type;
  if (typeof type === 'string' && type.length > 0) return type.toLowerCase();
  const platform = String(asset?.platform ?? '').toLowerCase();
  if (VIDEO_PLATFORMS.has(platform)) return 'video';
  return 'post';
}

function buildContentAssetsByType(assets: any[]): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const asset of assets) {
    const t = deriveContentTypeFromAsset(asset);
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return byType;
}

function inferExpectedContentMix(
  snapshot: any,
  campaignWeights: Record<string, number>
): Record<string, number> | undefined {
  const weeklyPlan = snapshot?.weekly_plan ?? snapshot?.campaign_snapshot?.weekly_plan;
  if (Array.isArray(weeklyPlan) && weeklyPlan.length > 0) {
    const mix = weeklyPlan[0]?.content_type_mix ?? weeklyPlan[0]?.contentTypeMix;
    if (Array.isArray(mix) && mix.length > 0) {
      const out: Record<string, number> = {};
      for (const t of mix) {
        const key = String(t).toLowerCase();
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    }
  }
  const explicit = snapshot?.expected_content_mix ?? snapshot?.expectedContentMix;
  if (explicit && typeof explicit === 'object' && Object.keys(explicit).length > 0) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(explicit)) {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!isNaN(n) && n > 0) out[String(k).toLowerCase()] = n;
    }
    if (Object.keys(out).length > 0) return out;
  }
  const awareness = (campaignWeights?.awareness ?? 0) + (campaignWeights?.brand ?? 0);
  if (awareness >= 50) return { video: 2, post: 3 };
  const leadWeight = (campaignWeights?.lead_generation ?? 0) + (campaignWeights?.lead_nurturing ?? 0);
  if (leadWeight >= 50) return { video: 1, post: 4 };
  return undefined;
}

export async function runPrePlanning(input: PrePlanningInput): Promise<DurationEvaluationResult> {
  const { companyId, campaignId, requested_weeks } = input;

  const [contentAssets, campaignVersion, profile, campaignResult] = await Promise.all([
    listAssetsWithLatestContent({ campaignId }),
    getLatestCampaignVersion(companyId, campaignId),
    getProfile(companyId, { autoRefine: false }),
    supabase.from('campaigns').select('id, budget, start_date, end_date, priority_level, execution_status, blueprint_status, duration_locked').eq('id', campaignId).maybeSingle(),
  ]);

  const campaignRow = campaignResult?.data;
  const existing_content_count = contentAssets?.length ?? 0;

  const snapshot = campaignVersion?.campaign_snapshot;
  const sourceOpportunityId =
    snapshot?.source_opportunity_id ?? snapshot?.metadata?.source_opportunity_id;
  const fromOpportunity = !!sourceOpportunityId;
  const allowPlaceholderPlanning = fromOpportunity && existing_content_count <= 0;
  const campaignTypes = snapshot?.campaign_types ?? snapshot?.campaign?.campaign_types;
  const campaignWeights = snapshot?.campaign_weights ?? snapshot?.campaign?.campaign_weights ?? {};
  const contentAssetsByType = buildContentAssetsByType(contentAssets ?? []);
  const expectedContentMix = inferExpectedContentMix(snapshot, campaignWeights as Record<string, number>);
  const plannedAssetIds = (contentAssets ?? []).map((a: any) => a.asset_id).filter(Boolean);

  const profileExt = profile as { company_stage?: string; market_scope?: string } | null;
  const companyStage = snapshot?.company_stage ?? profileExt?.company_stage ?? 'early_stage';
  const marketScope = snapshot?.market_scope ?? profileExt?.market_scope ?? 'niche';

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
    allowPlaceholderPlanning,
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
    contentAssetsByType,
    expectedContentMix,
    plannedAssetIds,
    execution_status: campaignRow?.execution_status != null ? String(campaignRow.execution_status) : undefined,
    blueprint_status: campaignRow?.blueprint_status != null ? String(campaignRow.blueprint_status) : undefined,
    duration_locked: campaignRow?.duration_locked != null ? Boolean(campaignRow.duration_locked) : undefined,
    evaluationOptions: {
      suppressEvents: input.suppressEvents === true,
      policyVersion: input.policyVersion,
    },
  });
}
