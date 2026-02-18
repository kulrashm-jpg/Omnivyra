/**
 * Campaign Readiness Service
 *
 * Calculates and stores readiness status for campaigns.
 * Considers: weekly_content_plans, weekly_content_refinements, twelve_week_plan blueprint, daily_content_plans.
 */

import { supabase } from '../db/supabaseClient';
import { getUnifiedCampaignBlueprint } from './campaignBlueprintService';

export type ReadinessState = 'not_ready' | 'partial' | 'ready';

export interface ReadinessIssue {
  code: string;
  message: string;
}

export interface CampaignReadinessResult {
  campaign_id: string;
  readiness_percentage: number;
  readiness_state: ReadinessState;
  blocking_issues: ReadinessIssue[];
  last_evaluated_at: string;
}

const READY_STATUSES = new Set(['scheduled', 'published', 'completed']);
const SKIPPED_STATUSES = new Set(['skipped']);

function hasContent(content?: string | null): boolean {
  return typeof content === 'string' && content.trim().length > 0;
}

function hasMediaRequirements(requirements: any): boolean {
  if (!requirements) return false;
  if (Array.isArray(requirements)) return requirements.length > 0;
  if (typeof requirements === 'object') return Object.keys(requirements).length > 0;
  return true;
}

function isExplicitlySkipped(status?: string | null): boolean {
  return status ? SKIPPED_STATUSES.has(status) : false;
}

function isScheduledOrCompleted(status?: string | null, scheduledPostId?: string | null): boolean {
  if (scheduledPostId) return true;
  return status ? READY_STATUSES.has(status) : false;
}

export async function getCampaignReadiness(
  campaignId: string
): Promise<CampaignReadinessResult | null> {
  const { data, error } = await supabase
    .from('campaign_readiness')
    .select('*')
    .eq('campaign_id', campaignId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to load campaign readiness: ${error.message}`);
  }

  return data as CampaignReadinessResult;
}

export async function evaluateCampaignReadiness(
  campaignId: string
): Promise<CampaignReadinessResult> {
  const blockingIssues: ReadinessIssue[] = [];

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    return {
      campaign_id: campaignId,
      readiness_percentage: 0,
      readiness_state: 'not_ready',
      blocking_issues: [
        {
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Campaign does not exist',
        },
      ],
      last_evaluated_at: new Date().toISOString(),
    };
  }

  let weekNumbers: number[] = [];
  const { data: weeklyPlans, error: weeklyError } = await supabase
    .from('weekly_content_plans')
    .select('week_number')
    .eq('campaign_id', campaignId);

  if (weeklyError) {
    const { data: refinements } = await supabase
      .from('weekly_content_refinements')
      .select('week_number')
      .eq('campaign_id', campaignId);
    weekNumbers = (refinements || []).map((r: any) => r.week_number);
  } else {
    weekNumbers = (weeklyPlans || []).map((plan: any) => plan.week_number);
  }
  let weeklyCount = weekNumbers.length;

  let weeksWithTopicsCount = 0;
  if (weeklyCount === 0) {
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    if (blueprint?.weeks?.length) {
      weekNumbers = blueprint.weeks.map((w: any) => w.week_number ?? 0).filter(Boolean);
      weeklyCount = weekNumbers.length;
      weeksWithTopicsCount = blueprint.weeks.filter(
        (w: any) => Array.isArray(w.topics_to_cover) && w.topics_to_cover.length > 0
      ).length;
      if (weeklyCount > 0) {
        blockingIssues.push({
          code: 'WEEKLY_TOPICS_DONE_NEED_DAILY',
          message: weeksWithTopicsCount > 0
            ? `${weeksWithTopicsCount} week(s) have topics. Structure into daily plans with platforms and content, then schedule.`
            : 'Weekly structure defined. Add topics and daily plans, then schedule.',
        });
      }
    }
  } else {
    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    weeksWithTopicsCount = blueprint?.weeks?.filter(
      (w: any) => Array.isArray(w.topics_to_cover) && w.topics_to_cover.length > 0
    ).length ?? 0;
  }
  if (weeklyCount === 0) {
    blockingIssues.push({
      code: 'MISSING_WEEKLY_PLANS',
      message: 'No weekly plans found. Build your campaign plan with AI Assistant to get started.',
    });
  }

  const { data: dailyPlans, error: dailyError } = await supabase
    .from('daily_content_plans')
    .select(
      'id, week_number, content, media_requirements, media_urls, status, scheduled_post_id'
    )
    .eq('campaign_id', campaignId);

  if (dailyError) {
    if (weeklyCount === 0) {
      return {
        campaign_id: campaignId,
        readiness_percentage: 0,
        readiness_state: 'not_ready',
        blocking_issues: [{ code: 'MISSING_WEEKLY_PLANS', message: 'Build your campaign plan with AI Assistant to get started.' }],
        last_evaluated_at: new Date().toISOString(),
      };
    }
    throw new Error(`Failed to load daily plans: ${dailyError.message}`);
  }

  const dailyList = dailyPlans || [];
  const dailyCount = dailyList.length;

  const weeksWithDaily = new Set(dailyList.map((plan: any) => plan.week_number));
  const missingWeeks = weekNumbers.filter((week) => !weeksWithDaily.has(week));

  if (weeklyCount > 0 && missingWeeks.length > 0) {
    const hasWeeklyTopicsMsg = blockingIssues.some((b) => b.code === 'WEEKLY_TOPICS_DONE_NEED_DAILY');
    const msg =
      missingWeeks.length >= weeklyCount
        ? 'All weeks need daily plans with content, then schedule.'
        : `Week(s) missing daily plans: ${missingWeeks.slice(0, 10).join(', ')}${missingWeeks.length > 10 ? '...' : ''}`;
    if (!hasWeeklyTopicsMsg) blockingIssues.push({ code: 'MISSING_DAILY_PLANS', message: msg });
  }

  const contentReadyCount = dailyList.filter((plan: any) =>
    hasContent(plan.content)
  ).length;
  if (dailyCount > 0 && contentReadyCount < dailyCount) {
    blockingIssues.push({
      code: 'MISSING_CONTENT',
      message: `${dailyCount - contentReadyCount} daily plan(s) missing content`,
    });
  }

  const plansRequiringMedia = dailyList.filter((plan: any) =>
    hasMediaRequirements(plan.media_requirements)
  );
  const mediaRequiredCount = plansRequiringMedia.length;
  const mediaReadyCount = plansRequiringMedia.filter((plan: any) => {
    return Array.isArray(plan.media_urls) && plan.media_urls.length > 0;
  }).length;

  if (mediaRequiredCount > 0 && mediaReadyCount < mediaRequiredCount) {
    blockingIssues.push({
      code: 'MISSING_MEDIA',
      message: `${mediaRequiredCount - mediaReadyCount} daily plan(s) missing required media`,
    });
  }

  const requiredDailyPlans = dailyList.filter(
    (plan: any) => !isExplicitlySkipped(plan.status)
  );
  const scheduledCount = requiredDailyPlans.filter((plan: any) =>
    isScheduledOrCompleted(plan.status, plan.scheduled_post_id)
  ).length;

  if (requiredDailyPlans.length > 0 && scheduledCount < requiredDailyPlans.length) {
    blockingIssues.push({
      code: 'UNSCHEDULED_PLANS',
      message: `${requiredDailyPlans.length - scheduledCount} daily plan(s) not scheduled or skipped`,
    });
  }

  // Partial credit for weekly structure: 0.3 skeleton, 0.6 with topics, 1.0 with daily
  const weeklyStructureScore =
    weeklyCount === 0 ? 0
    : weeksWithTopicsCount > 0 ? 0.3 + 0.3 * (weeksWithTopicsCount / Math.max(weeklyCount, 1))
    : 0.2;
  const components = [
    Math.min(1, weeklyStructureScore + (weeklyCount > 0 ? weeksWithDaily.size / Math.max(weeklyCount, 1) * 0.7 : 0)),
    weeklyCount > 0 ? weeksWithDaily.size / weeklyCount : 0,
    dailyCount > 0 ? contentReadyCount / dailyCount : 0,
    mediaRequiredCount > 0 ? mediaReadyCount / mediaRequiredCount : 1,
    requiredDailyPlans.length > 0 ? scheduledCount / requiredDailyPlans.length : 0,
  ];

  const readinessPercentage = Math.round(
    (components.reduce((sum, value) => sum + value, 0) / components.length) * 100
  );

  let readinessState: ReadinessState = 'not_ready';
  if (readinessPercentage >= 100) {
    readinessState = 'ready';
  } else if (readinessPercentage >= 50) {
    readinessState = 'partial';
  }

  const lastEvaluated = new Date().toISOString();

  await supabase.from('campaign_readiness').upsert(
    {
      campaign_id: campaignId,
      readiness_percentage: readinessPercentage,
      readiness_state: readinessState,
      blocking_issues: blockingIssues,
      last_evaluated_at: lastEvaluated,
    },
    { onConflict: 'campaign_id' }
  );

  return {
    campaign_id: campaignId,
    readiness_percentage: readinessPercentage,
    readiness_state: readinessState,
    blocking_issues: blockingIssues,
    last_evaluated_at: lastEvaluated,
  };
}
