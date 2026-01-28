import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

export interface CampaignMetadata {
  id: string;
  status: string | null;
  timeframe: string | null;
  start_date: string | null;
  end_date: string | null;
  objective: string | null;
  goal_objectives: string[];
}

export interface WeeklyRefinement {
  id: string;
  week_number: number;
  theme?: string | null;
  focus_area?: string | null;
  refinement_status?: string | null;
  content_plan?: any;
  performance_targets?: any;
  marketing_channels?: string[] | null;
  existing_content?: string | null;
  content_notes?: string | null;
}

export interface DailyPlan {
  id: string;
  week_number: number;
  day_of_week: string;
  date: string | null;
  platform: string | null;
  content_type: string | null;
  title?: string | null;
  topic?: string | null;
  content?: string | null;
  hashtags?: string[] | null;
  mentions?: string[] | null;
  media_requirements?: any;
  media_urls?: string[] | null;
  media_types?: string[] | null;
  required_resources?: string[] | null;
  scheduled_time?: string | null;
  timezone?: string | null;
  posting_strategy?: string | null;
  status?: string | null;
  priority?: string | null;
  ai_generated?: boolean | null;
  expected_engagement?: number | null;
  target_audience?: string | null;
  scheduled_post_id?: string | null;
}

export interface ScheduledPostSnapshot {
  id: string;
  campaign_id?: string | null;
  platform: string | null;
  content_type: string | null;
  title?: string | null;
  content?: string | null;
  hashtags?: string[] | null;
  media_urls?: string[] | null;
  scheduled_for?: string | null;
  status?: string | null;
}

export interface MediaAssetSnapshot {
  id: string;
  filename?: string | null;
  original_filename?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  media_type?: string | null;
  mime_type?: string | null;
  file_extension?: string | null;
  platforms?: string[] | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  aspect_ratio?: string | null;
}

export interface PlatformCoverageSummary {
  platforms: string[];
  daily_plan_counts: Record<string, number>;
  scheduled_post_counts: Record<string, number>;
  weekly_gaps: Record<string, number[]>;
}

export interface AssetAvailabilitySummary {
  daily_plans_total: number;
  daily_plans_with_content: number;
  daily_plans_with_media_requirements: number;
  daily_plans_with_media_attached: number;
  media_assets_total: number;
}

export interface ViralitySnapshot {
  campaign: CampaignMetadata;
  weekly_plans: WeeklyRefinement[];
  daily_plans: DailyPlan[];
  scheduled_posts: ScheduledPostSnapshot[];
  media_assets: MediaAssetSnapshot[];
  platform_coverage: PlatformCoverageSummary;
  asset_availability: AssetAvailabilitySummary;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayOrderIndex(day: string): number {
  const index = DAY_ORDER.indexOf(day);
  return index === -1 ? DAY_ORDER.length : index;
}

function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const result = compare(a.item, b.item);
      return result === 0 ? a.index - b.index : result;
    })
    .map(({ item }) => item);
}

function hasContent(value?: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMedia(value?: string[] | null): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasMediaRequirements(requirements: any): boolean {
  if (!requirements) return false;
  if (Array.isArray(requirements)) return requirements.length > 0;
  if (typeof requirements === 'object') return Object.keys(requirements).length > 0;
  return true;
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, any> = {};
    sortedKeys.forEach((key) => {
      result[key] = canonicalize(value[key]);
    });
    return result;
  }
  return value;
}

export function canonicalJsonStringify(value: any): string {
  return JSON.stringify(canonicalize(value));
}

export function hashSnapshot(snapshot: ViralitySnapshot): string {
  const canonical = canonicalJsonStringify(snapshot);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function buildCampaignSnapshot(
  campaignId: string
): Promise<ViralitySnapshot> {
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, status, timeframe, start_date, end_date')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error('Campaign not found');
  }

  const { data: strategy } = await supabase
    .from('campaign_strategies')
    .select('objective')
    .eq('campaign_id', campaignId)
    .single();

  const { data: goals } = await supabase
    .from('campaign_goals')
    .select('objectives')
    .eq('campaign_id', campaignId);

  const goalObjectives =
    goals?.flatMap((goal: any) => (goal.objectives as string[]) || []) || [];

  const campaignMetadata: CampaignMetadata = {
    id: campaign.id,
    status: campaign.status || null,
    timeframe: campaign.timeframe || null,
    start_date: campaign.start_date || null,
    end_date: campaign.end_date || null,
    objective: strategy?.objective || (goalObjectives[0] || null),
    goal_objectives: goalObjectives,
  };

  const { data: weeklyRaw, error: weeklyError } = await supabase
    .from('weekly_content_refinements')
    .select('*')
    .eq('campaign_id', campaignId);

  if (weeklyError) {
    throw new Error(`Failed to load weekly refinements: ${weeklyError.message}`);
  }

  const weeklyPlans = stableSort(
    (weeklyRaw || []).map((plan: any) => ({
      id: plan.id,
      week_number: plan.week_number,
      theme: plan.theme ?? null,
      focus_area: plan.focus_area ?? null,
      refinement_status: plan.refinement_status ?? null,
      content_plan: plan.content_plan ?? null,
      performance_targets: plan.performance_targets ?? null,
      marketing_channels: plan.marketing_channels ?? null,
      existing_content: plan.existing_content ?? null,
      content_notes: plan.content_notes ?? null,
    })),
    (a, b) => a.week_number - b.week_number
  );

  const { data: dailyRaw, error: dailyError } = await supabase
    .from('daily_content_plans')
    .select('*')
    .eq('campaign_id', campaignId);

  if (dailyError) {
    throw new Error(`Failed to load daily plans: ${dailyError.message}`);
  }

  const dailyPlans = stableSort(
    (dailyRaw || []).map((plan: any) => ({
      id: plan.id,
      week_number: plan.week_number,
      day_of_week: plan.day_of_week,
      date: plan.date ?? null,
      platform: plan.platform ?? null,
      content_type: plan.content_type ?? null,
      title: plan.title ?? null,
      topic: plan.topic ?? null,
      content: plan.content ?? null,
      hashtags: plan.hashtags ?? null,
      mentions: plan.mentions ?? null,
      media_requirements: plan.media_requirements ?? null,
      media_urls: plan.media_urls ?? null,
      media_types: plan.media_types ?? null,
      required_resources: plan.required_resources ?? null,
      scheduled_time: plan.scheduled_time ?? null,
      timezone: plan.timezone ?? null,
      posting_strategy: plan.posting_strategy ?? null,
      status: plan.status ?? null,
      priority: plan.priority ?? null,
      ai_generated: plan.ai_generated ?? null,
      expected_engagement: plan.expected_engagement ?? null,
      target_audience: plan.target_audience ?? null,
      scheduled_post_id: plan.scheduled_post_id ?? null,
    })),
    (a, b) => {
      if (a.week_number !== b.week_number) return a.week_number - b.week_number;
      const dayDiff = dayOrderIndex(a.day_of_week) - dayOrderIndex(b.day_of_week);
      if (dayDiff !== 0) return dayDiff;
      const platformDiff = (a.platform || '').localeCompare(b.platform || '');
      if (platformDiff !== 0) return platformDiff;
      return a.id.localeCompare(b.id);
    }
  );

  const { data: scheduledRaw, error: scheduledError } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('campaign_id', campaignId);

  if (scheduledError) {
    throw new Error(`Failed to load scheduled posts: ${scheduledError.message}`);
  }

  const scheduledPosts = stableSort(
    (scheduledRaw || []).map((post: any) => ({
      id: post.id,
      campaign_id: post.campaign_id ?? null,
      platform: post.platform ?? null,
      content_type: post.content_type ?? null,
      title: post.title ?? null,
      content: post.content ?? null,
      hashtags: post.hashtags ?? null,
      media_urls: post.media_urls ?? null,
      scheduled_for: post.scheduled_for ?? null,
      status: post.status ?? null,
    })),
    (a, b) => {
      const dateA = a.scheduled_for || '';
      const dateB = b.scheduled_for || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const platformDiff = (a.platform || '').localeCompare(b.platform || '');
      if (platformDiff !== 0) return platformDiff;
      return a.id.localeCompare(b.id);
    }
  );

  const { data: mediaRaw, error: mediaError } = await supabase
    .from('media_files')
    .select('*')
    .eq('campaign_id', campaignId);

  if (mediaError) {
    throw new Error(`Failed to load media assets: ${mediaError.message}`);
  }

  const mediaAssets = stableSort(
    (mediaRaw || []).map((asset: any) => ({
      id: asset.id,
      filename: asset.filename ?? null,
      original_filename: asset.original_filename ?? null,
      file_url: asset.file_url ?? null,
      file_path: asset.file_path ?? null,
      media_type: asset.media_type ?? null,
      mime_type: asset.mime_type ?? null,
      file_extension: asset.file_extension ?? null,
      platforms: asset.platforms ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      duration: asset.duration ?? null,
      aspect_ratio: asset.aspect_ratio ?? null,
    })),
    (a, b) => {
      const typeDiff = (a.media_type || '').localeCompare(b.media_type || '');
      if (typeDiff !== 0) return typeDiff;
      return a.id.localeCompare(b.id);
    }
  );

  const platforms = Array.from(
    new Set([
      ...dailyPlans.map((plan) => plan.platform).filter(Boolean),
      ...scheduledPosts.map((post) => post.platform).filter(Boolean),
    ])
  ).sort();

  const weeklyNumbers = Array.from(
    new Set([
      ...weeklyPlans.map((plan) => plan.week_number),
      ...dailyPlans.map((plan) => plan.week_number),
    ])
  ).sort((a, b) => a - b);

  const dailyPlanCounts: Record<string, number> = {};
  const scheduledPostCounts: Record<string, number> = {};
  const weeklyGaps: Record<string, number[]> = {};

  platforms.forEach((platform) => {
    dailyPlanCounts[platform] = dailyPlans.filter((plan) => plan.platform === platform).length;
    scheduledPostCounts[platform] = scheduledPosts.filter((post) => post.platform === platform).length;
    const weeksWithPlatform = new Set(
      dailyPlans.filter((plan) => plan.platform === platform).map((plan) => plan.week_number)
    );
    weeklyGaps[platform] = weeklyNumbers.filter((week) => !weeksWithPlatform.has(week));
  });

  const assetAvailability: AssetAvailabilitySummary = {
    daily_plans_total: dailyPlans.length,
    daily_plans_with_content: dailyPlans.filter((plan) => hasContent(plan.content)).length,
    daily_plans_with_media_requirements: dailyPlans.filter((plan) =>
      hasMediaRequirements(plan.media_requirements)
    ).length,
    daily_plans_with_media_attached: dailyPlans.filter((plan) => hasMedia(plan.media_urls)).length,
    media_assets_total: mediaAssets.length,
  };

  const platformCoverage: PlatformCoverageSummary = {
    platforms,
    daily_plan_counts: dailyPlanCounts,
    scheduled_post_counts: scheduledPostCounts,
    weekly_gaps: weeklyGaps,
  };

  return {
    campaign: campaignMetadata,
    weekly_plans: weeklyPlans,
    daily_plans: dailyPlans,
    scheduled_posts: scheduledPosts,
    media_assets: mediaAssets,
    platform_coverage: platformCoverage,
    asset_availability: assetAvailability,
  };
}

export async function buildCampaignSnapshotWithHash(campaignId: string): Promise<{
  snapshot: ViralitySnapshot;
  snapshot_hash: string;
}> {
  const snapshot = await buildCampaignSnapshot(campaignId);
  const snapshot_hash = hashSnapshot(snapshot);
  return { snapshot, snapshot_hash };
}
