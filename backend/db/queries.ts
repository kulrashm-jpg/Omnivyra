/**
 * Database Query Functions
 * 
 * Typed functions for common database operations.
 * All functions use Supabase client for queries.
 * 
 * Tables used:
 * - queue_jobs
 * - queue_job_logs
 * - scheduled_posts
 * - social_accounts
 */

import { supabase } from './supabaseClient';

export interface QueueJob {
  id: string;
  scheduled_post_id: string;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  next_retry_at?: string;
  error_message?: string;
  error_code?: string;
  metadata?: any;
  result_data?: any;
  created_at: string;
  updated_at: string;
}

export interface ScheduledPost {
  id: string;
  user_id: string;
  social_account_id: string;
  campaign_id?: string;
  platform: string;
  content_type: string;
  title?: string;
  content: string;
  hashtags?: string[];
  media_urls?: string[];
  scheduled_for: string;
  status: string;
  platform_post_id?: string;
  post_url?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
  repurpose_index?: number;
  repurpose_total?: number;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string;
  platform_user_id: string;
  account_name: string;
  username?: string;
  access_token: string;
  refresh_token?: string;
  token_expires_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new queue job
 */
export async function createQueueJob(data: {
  scheduled_post_id: string;
  job_type: string;
  status: string;
  scheduled_for: string;
  priority?: number;
}): Promise<string> {
  const { data: job, error } = await supabase
    .from('queue_jobs')
    .insert({
      scheduled_post_id: data.scheduled_post_id,
      job_type: data.job_type,
      status: data.status,
      scheduled_for: data.scheduled_for,
      priority: data.priority || 0,
      attempts: 0,
      max_attempts: 3,
    })
    .select('id')
    .single();

  if (error || !job) {
    throw new Error(`Failed to create queue job: ${error?.message}`);
  }

  return job.id;
}

/**
 * Get queue job by ID
 */
export async function getQueueJob(jobId: string): Promise<QueueJob | null> {
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get queue job: ${error.message}`);
  }

  return data;
}

/**
 * Update queue job status
 */
export async function updateQueueJobStatus(
  jobId: string,
  status: string,
  updates?: {
    error_message?: string;
    error_code?: string;
    next_retry_at?: string;
    result_data?: any;
  }
): Promise<void> {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (updates?.error_message) {
    updateData.error_message = updates.error_message;
  }
  if (updates?.error_code) {
    updateData.error_code = updates.error_code;
  }
  if (updates?.next_retry_at) {
    updateData.next_retry_at = updates.next_retry_at;
  }
  if (updates?.result_data) {
    updateData.result_data = updates.result_data;
  }

  const { error } = await supabase
    .from('queue_jobs')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    throw new Error(`Failed to update queue job: ${error.message}`);
  }
}

/**
 * Create queue job log entry
 */
export async function createQueueJobLog(
  jobId: string,
  logLevel: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  metadata?: any
): Promise<void> {
  const { error } = await supabase.from('queue_job_logs').insert({
    job_id: jobId,
    log_level: logLevel,
    message,
    metadata: metadata || {},
  });

  if (error) {
    console.error('Failed to create queue job log:', error);
    // Don't throw - logging is non-critical
  }
}

/**
 * Get scheduled post by ID
 */
export async function getScheduledPost(postId: string): Promise<ScheduledPost | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get scheduled post: ${error.message}`);
  }

  return data;
}

/**
 * Update scheduled post on successful publish
 */
export async function updateScheduledPostOnPublish(
  postId: string,
  platformPostId: string,
  postUrl: string,
  publishedAt?: Date
): Promise<void> {
  const { error } = await supabase
    .from('scheduled_posts')
    .update({
      status: 'published',
      platform_post_id: platformPostId,
      post_url: postUrl,
      published_at: publishedAt?.toISOString() || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId);

  if (error) {
    throw new Error(`Failed to update scheduled post: ${error.message}`);
  }

  // Sync platform_post_id to daily_content_plans.external_post_id — single batch update
  const { data: plans } = await supabase
    .from('daily_content_plans')
    .select('id')
    .eq('scheduled_post_id', postId);

  if (plans?.length) {
    const planIds = (plans as { id: string }[]).map((p) => p.id);
    const { error: syncError } = await supabase
      .from('daily_content_plans')
      .update({ external_post_id: platformPostId })
      .in('id', planIds);
    if (syncError) {
      console.warn(`[queries] Could not batch-sync external_post_id: ${syncError.message}`);
    }
  }
}

/**
 * Update scheduled post on failure
 */
export async function updateScheduledPostOnFailure(
  postId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from('scheduled_posts')
    .update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId);

  if (error) {
    throw new Error(`Failed to update scheduled post: ${error.message}`);
  }
}

/**
 * Get social account by ID
 */
export async function getSocialAccount(accountId: string): Promise<SocialAccount | null> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get social account: ${error.message}`);
  }

  return data;
}

