/**
 * Advanced Scheduling Service
 * 
 * Provides advanced scheduling features:
 * - Priority-based job scheduling
 * - Date adjustment on campaign changes
 * - Conflict detection for overlapping campaigns
 */

import { supabase } from '../db/supabaseClient';
import { logActivity } from './activityLogger';

/**
 * Set priority for a scheduled post
 */
export async function setPostPriority(
  scheduledPostId: string,
  priority: number
): Promise<void> {
  const { error } = await supabase
    .from('scheduled_posts')
    .update({ priority })
    .eq('id', scheduledPostId);

  if (error) {
    throw new Error(`Failed to set priority: ${error.message}`);
  }
}

/**
 * Adjust dates when campaign start date changes
 */
export async function adjustCampaignDates(
  campaignId: string,
  newStartDate: Date,
  userId: string
): Promise<{
  weekly_adjusted: number;
  daily_adjusted: number;
  posts_adjusted: number;
}> {
  // Get campaign
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('start_date')
    .eq('id', campaignId)
    .single();

  if (!campaign || !campaign.start_date) {
    throw new Error('Campaign not found or has no start date');
  }

  const oldStartDate = new Date(campaign.start_date);
  const dateDiff = Math.floor((newStartDate.getTime() - oldStartDate.getTime()) / (1000 * 60 * 60 * 24));

  if (dateDiff === 0) {
    return { weekly_adjusted: 0, daily_adjusted: 0, posts_adjusted: 0 };
  }

  // Adjust weekly content refinements
  const { data: weekly } = await supabase
    .from('weekly_content_refinements')
    .select('id, week_start_date')
    .eq('campaign_id', campaignId);

  let weeklyAdjusted = 0;
  if (weekly) {
    for (const week of weekly) {
      if (week.week_start_date) {
        const newWeekDate = new Date(week.week_start_date);
        newWeekDate.setDate(newWeekDate.getDate() + dateDiff);

        await supabase
          .from('weekly_content_refinements')
          .update({ week_start_date: newWeekDate.toISOString() })
          .eq('id', week.id);

        weeklyAdjusted++;
      }
    }
  }

  // Adjust daily content plans via execution engine
  const { data: daily } = await supabase
    .from('daily_content_plans')
    .select('id, date')
    .eq('campaign_id', campaignId);

  let dailyAdjusted = 0;
  if (daily) {
    const { updateActivity } = await import('./executionPlannerService');
    for (const plan of daily) {
      if (plan.date) {
        const newDate = new Date(plan.date);
        newDate.setDate(newDate.getDate() + dateDiff);
        try {
          await updateActivity(plan.id, { date: newDate.toISOString() }, 'manual');
          dailyAdjusted++;
        } catch (e) {
          console.warn('[schedulingService] updateActivity failed:', (e as Error).message);
        }
      }
    }
  }

  // Adjust scheduled posts
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, scheduled_for')
    .eq('campaign_id', campaignId)
    .eq('status', 'scheduled');

  let postsAdjusted = 0;
  if (posts) {
    for (const post of posts) {
      if (post.scheduled_for) {
        const newScheduledFor = new Date(post.scheduled_for);
        newScheduledFor.setDate(newScheduledFor.getDate() + dateDiff);

        await supabase
          .from('scheduled_posts')
          .update({ scheduled_for: newScheduledFor.toISOString() })
          .eq('id', post.id);

        postsAdjusted++;
      }
    }
  }

  // Log activity
  await logActivity(userId, 'campaign_updated', 'campaign', campaignId, {
    date_adjusted: true,
    date_diff_days: dateDiff,
    weekly_adjusted: weeklyAdjusted,
    daily_adjusted: dailyAdjusted,
    posts_adjusted: postsAdjusted,
  });

  return {
    weekly_adjusted: weeklyAdjusted,
    daily_adjusted: dailyAdjusted,
    posts_adjusted: postsAdjusted,
  };
}

/**
 * Detect campaign conflicts (overlapping date ranges)
 */
export async function detectCampaignConflicts(
  userId: string,
  startDate: Date,
  endDate: Date,
  excludeCampaignId?: string
): Promise<Array<{
  campaign_id: string;
  campaign_name: string;
  start_date: Date;
  end_date: Date;
  overlap_days: number;
}>> {
  let query = supabase
    .from('campaigns')
    .select('id, name, start_date, end_date')
    .eq('user_id', userId)
    .not('status', 'eq', 'completed')
    .not('status', 'eq', 'cancelled');

  if (excludeCampaignId) {
    query = query.neq('id', excludeCampaignId);
  }

  const { data: campaigns, error } = await query;

  if (error || !campaigns) {
    return [];
  }

  const conflicts: Array<{
    campaign_id: string;
    campaign_name: string;
    start_date: Date;
    end_date: Date;
    overlap_days: number;
  }> = [];

  campaigns.forEach((campaign: any) => {
    if (!campaign.start_date || !campaign.end_date) return;

    const campStart = new Date(campaign.start_date);
    const campEnd = new Date(campaign.end_date);

    // Check for overlap: start_date < other.end_date AND end_date > other.start_date
    if (startDate < campEnd && endDate > campStart) {
      // Calculate overlap
      const overlapStart = startDate > campStart ? startDate : campStart;
      const overlapEnd = endDate < campEnd ? endDate : campEnd;
      const overlapDays = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24));

      conflicts.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        start_date: campStart,
        end_date: campEnd,
        overlap_days: overlapDays,
      });
    }
  });

  return conflicts;
}

/**
 * Get suggested next available date range
 */
export async function suggestAvailableDateRange(
  userId: string,
  durationDays: number,
  preferredStart?: Date
): Promise<{ start_date: Date; end_date: Date } | null> {
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('start_date, end_date')
    .eq('user_id', userId)
    .not('status', 'eq', 'completed')
    .not('status', 'eq', 'cancelled')
    .order('start_date', { ascending: true });

  if (!campaigns || campaigns.length === 0) {
    const start = preferredStart || new Date();
    return {
      start_date: start,
      end_date: new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000),
    };
  }

  // Find gap between campaigns
  const startDate = preferredStart || new Date();
  
  for (let i = 0; i < campaigns.length; i++) {
    const campaign = campaigns[i];
    if (!campaign.end_date) continue;

    const campEnd = new Date(campaign.end_date);
    const nextStart = i < campaigns.length - 1 && campaigns[i + 1].start_date
      ? new Date(campaigns[i + 1].start_date)
      : null;

    if (startDate < campEnd) {
      // Start date is before this campaign ends, suggest after it ends
      const gapStart = new Date(campEnd.getTime() + 24 * 60 * 60 * 1000); // Day after
      
      if (!nextStart || (gapStart.getTime() + durationDays * 24 * 60 * 60 * 1000) < nextStart.getTime()) {
        return {
          start_date: gapStart,
          end_date: new Date(gapStart.getTime() + durationDays * 24 * 60 * 60 * 1000),
        };
      }
    }
  }

  // Suggest after last campaign
  const lastCampaign = campaigns[campaigns.length - 1];
  if (lastCampaign.end_date) {
    const suggestedStart = new Date(lastCampaign.end_date);
    suggestedStart.setDate(suggestedStart.getDate() + 1);
    
    return {
      start_date: suggestedStart,
      end_date: new Date(suggestedStart.getTime() + durationDays * 24 * 60 * 60 * 1000),
    };
  }

  return null;
}

