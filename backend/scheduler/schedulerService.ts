/**
 * Scheduler Service
 * 
 * Queries database for scheduled posts that are due for publishing
 * and creates queue_jobs + enqueues them in BullMQ.
 * 
 * Prevents duplicate jobs by checking if queue_job already exists
 * for a scheduled_post_id with status 'pending' or 'processing'.
 */

import { supabase } from '../db/supabaseClient';
import { getQueue } from '../queue/bullmqClient';
import { createQueueJob } from '../db/queries';
import { getCampaignReadiness } from '../services/campaignReadinessService';

interface SchedulerResult {
  found: number; // Posts found that are due
  created: number; // New queue jobs created
  skipped: number; // Duplicates or blocked posts skipped
}

/**
 * Find due scheduled posts and enqueue them
 * 
 * Queries scheduled_posts where:
 * - status = 'scheduled'
 * - scheduled_for <= NOW()
 * 
 * For each due post:
 * - Creates queue_jobs row (status='pending')
 * - Enqueues job in BullMQ
 * - Skips if job already exists
 */
export async function findDuePostsAndEnqueue(): Promise<SchedulerResult> {
  const now = new Date().toISOString();

  console.log(`🔍 Finding scheduled posts due before ${now}...`);

  // Query due scheduled posts with priority sorting
  // Higher priority posts (priority > 0) are processed first
  const { data: duePosts, error } = await supabase
    .from('scheduled_posts')
    .select('id, user_id, social_account_id, platform, scheduled_for, status, priority, campaign_id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .order('priority', { ascending: false }) // Higher priority first
    .order('scheduled_for', { ascending: true }) // Then by scheduled time
    .limit(100); // Process max 100 at a time to avoid overload

  if (error) {
    throw new Error(`Failed to query scheduled_posts: ${error.message}`);
  }

  const found = duePosts?.length || 0;
  console.log(`📋 Found ${found} due posts`);

  if (found === 0) {
    return { found: 0, created: 0, skipped: 0 };
  }

  // Check for existing queue jobs to prevent duplicates
  const { data: existingJobs } = await supabase
    .from('queue_jobs')
    .select('scheduled_post_id, status')
    .in('scheduled_post_id', duePosts.map(p => p.id))
    .in('status', ['pending', 'processing']);

  const existingPostIds = new Set(
    existingJobs?.map(j => j.scheduled_post_id) || []
  );

  let created = 0;
  let skipped = 0;

  const queue = getQueue();

  // Process each due post
  for (const post of duePosts || []) {
    // Skip if job already exists
    if (existingPostIds.has(post.id)) {
      console.log(`⏭️  Skipping ${post.id} - job already queued`);
      skipped++;
      continue;
    }

    if (post.campaign_id) {
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', post.campaign_id)
        .single();

      if (campaignError || !campaign || campaign.status !== 'active') {
        console.warn({
          campaign_id: post.campaign_id,
          scheduled_post_id: post.id,
          reason: 'CAMPAIGN_NOT_ACTIVE',
        });
        skipped++;
        continue;
      }

      const readiness = await getCampaignReadiness(post.campaign_id);
      if (!readiness || readiness.readiness_state !== 'ready') {
        console.warn({
          campaign_id: post.campaign_id,
          scheduled_post_id: post.id,
          reason: 'CAMPAIGN_NOT_READY',
        });
        skipped++;
        continue;
      }
    }

    try {
      // Create queue_jobs row with priority from scheduled_post
      const queueJobId = await createQueueJob({
        scheduled_post_id: post.id,
        job_type: 'publish',
        status: 'pending',
        scheduled_for: post.scheduled_for,
        priority: (post as any).priority || 0, // Use post priority, default to 0
      });

      // Enqueue in BullMQ
      await queue.add(
        'publish',
        {
          scheduled_post_id: post.id,
          social_account_id: post.social_account_id,
          user_id: post.user_id,
        },
        {
          jobId: queueJobId, // Use DB UUID as BullMQ job ID for consistency
          removeOnComplete: true,
          removeOnFail: false, // Keep failed jobs for debugging
        }
      );

      console.log(`✅ Enqueued job ${queueJobId} for post ${post.id}`);
      created++;
    } catch (error: any) {
      console.error(`❌ Failed to enqueue post ${post.id}:`, error.message);
      // Continue with other posts
    }
  }

  return { found, created, skipped };
}

