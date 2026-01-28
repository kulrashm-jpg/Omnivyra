/**
 * Activity Logger Service
 * 
 * Tracks all user actions for audit log and activity feed.
 * 
 * Features:
 * - Log user actions (create, update, delete, schedule, publish)
 * - Activity feed with filtering
 * - Audit trail for compliance
 */

import { supabase } from '../db/supabaseClient';

export type ActionType = 
  | 'campaign_created' 
  | 'campaign_updated' 
  | 'campaign_deleted'
  | 'post_scheduled'
  | 'post_published'
  | 'post_updated'
  | 'post_deleted'
  | 'content_edited'
  | 'template_created'
  | 'template_used'
  | 'account_connected'
  | 'account_disconnected'
  | 'week_assigned'
  | 'week_completed';

export type EntityType = 
  | 'campaign'
  | 'post'
  | 'template'
  | 'account'
  | 'week'
  | 'content';

export interface ActivityLog {
  id: string;
  user_id: string;
  action_type: ActionType;
  entity_type: EntityType;
  entity_id: string;
  campaign_id?: string;
  metadata: Record<string, any>;
  created_at: Date;
}

/**
 * Log an activity
 */
export async function logActivity(
  userId: string,
  actionType: ActionType,
  entityType: EntityType,
  entityId: string,
  metadata: {
    campaign_id?: string;
    [key: string]: any;
  } = {}
): Promise<void> {
  // Check if activity_feed table exists, if not, create logs in notifications or create the table
  const { error } = await supabase
    .from('activity_feed')
    .insert({
      user_id: userId,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      campaign_id: metadata.campaign_id || null,
      metadata: metadata,
    });

  if (error) {
    // If table doesn't exist, fall back to console logging
    // In production, ensure table exists via migration
    console.warn('Activity feed table not found, logging to console:', {
      user_id: userId,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  }
}

/**
 * Get activity feed for a user
 */
export async function getActivityFeed(
  userId: string,
  options: {
    campaign_id?: string;
    action_type?: ActionType;
    entity_type?: EntityType;
    start_date?: Date;
    end_date?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ActivityLog[]> {
  let query = supabase
    .from('activity_feed')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options.campaign_id) {
    query = query.eq('campaign_id', options.campaign_id);
  }

  if (options.action_type) {
    query = query.eq('action_type', options.action_type);
  }

  if (options.entity_type) {
    query = query.eq('entity_type', options.entity_type);
  }

  if (options.start_date) {
    query = query.gte('created_at', options.start_date.toISOString());
  }

  if (options.end_date) {
    query = query.lte('created_at', options.end_date.toISOString());
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    // Table might not exist yet - return empty array
    console.warn('Activity feed query failed:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    action_type: row.action_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    campaign_id: row.campaign_id,
    metadata: row.metadata || {},
    created_at: new Date(row.created_at),
  }));
}

/**
 * Get activity count for a campaign
 */
export async function getCampaignActivityCount(campaignId: string): Promise<number> {
  const { count, error } = await supabase
    .from('activity_feed')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);

  if (error) {
    return 0;
  }

  return count || 0;
}

