/**
 * Team Service
 * 
 * Manages team collaboration features:
 * - Week/task assignments
 * - Completion tracking
 * - Team member notifications
 */

import { supabase } from '../db/supabaseClient';
import { logActivity } from './activityLogger';

export interface WeekAssignment {
  week_number: number;
  campaign_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  status: 'not_started' | 'in_progress' | 'completed';
  completed_at?: Date;
  notes?: string;
}

/**
 * Assign a week to a team member
 */
export async function assignWeek(
  campaignId: string,
  weekNumber: number,
  assignedToUserId: string,
  assignedByUserId: string
): Promise<void> {
  // Update weekly_content_refinements with assignment
  const { error } = await supabase
    .from('weekly_content_refinements')
    .update({
      assigned_to_user_id: assignedToUserId,
      status: 'not_started',
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .eq('week_number', weekNumber);

  if (error) {
    throw new Error(`Failed to assign week: ${error.message}`);
  }

  // Create notification for assignee
  await supabase
    .from('notifications')
    .insert({
      user_id: assignedToUserId,
      type: 'assignment',
      title: `Week ${weekNumber} Assigned`,
      message: `You have been assigned to work on week ${weekNumber} of campaign.`,
      metadata: {
        campaign_id: campaignId,
        week_number: weekNumber,
        assigned_by: assignedByUserId,
      },
      is_read: false,
    });

  // Log activity
  await logActivity(assignedByUserId, 'week_assigned', 'week', `${campaignId}-${weekNumber}`, {
    campaign_id: campaignId,
    assigned_to: assignedToUserId,
    week_number: weekNumber,
  });
}

/**
 * Update week assignment status
 */
export async function updateWeekStatus(
  campaignId: string,
  weekNumber: number,
  status: 'not_started' | 'in_progress' | 'completed',
  userId: string,
  notes?: string
): Promise<void> {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'completed') {
    updateData.completed_at = new Date().toISOString();
  }

  if (notes) {
    updateData.notes = notes;
  }

  const { error } = await supabase
    .from('weekly_content_refinements')
    .update(updateData)
    .eq('campaign_id', campaignId)
    .eq('week_number', weekNumber);

  if (error) {
    throw new Error(`Failed to update week status: ${error.message}`);
  }

  // Log activity
  if (status === 'completed') {
    await logActivity(userId, 'week_completed', 'week', `${campaignId}-${weekNumber}`, {
      campaign_id: campaignId,
      week_number: weekNumber,
    });
  }
}

/**
 * Get assignments for a user
 */
export async function getUserAssignments(
  userId: string,
  options: {
    campaign_id?: string;
    status?: 'not_started' | 'in_progress' | 'completed';
  } = {}
): Promise<WeekAssignment[]> {
  let query = supabase
    .from('weekly_content_refinements')
    .select('*')
    .eq('assigned_to_user_id', userId);

  if (options.campaign_id) {
    query = query.eq('campaign_id', options.campaign_id);
  }

  if (options.status) {
    query = query.eq('status', options.status);
  }

  const { data, error } = await query.order('week_number', { ascending: true });

  if (error) {
    throw new Error(`Failed to get assignments: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    week_number: row.week_number,
    campaign_id: row.campaign_id,
    assigned_to_user_id: row.assigned_to_user_id,
    assigned_by_user_id: row.assigned_by_user_id || row.user_id,
    status: row.status || 'not_started',
    completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
    notes: row.notes,
  }));
}

/**
 * Get team members for a campaign
 */
export async function getCampaignTeam(campaignId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('weekly_content_refinements')
    .select('assigned_to_user_id')
    .eq('campaign_id', campaignId)
    .not('assigned_to_user_id', 'is', null);

  if (error) {
    return [];
  }

  // Get unique user IDs
  const userIds = new Set<string>();
  (data || []).forEach((row: any) => {
    if (row.assigned_to_user_id) {
      userIds.add(row.assigned_to_user_id);
    }
  });

  return Array.from(userIds);
}

