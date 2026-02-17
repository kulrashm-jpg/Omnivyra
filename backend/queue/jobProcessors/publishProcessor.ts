/**
 * Publish Job Processor
 * 
 * Processes individual 'publish' jobs from the queue.
 * - Validates job idempotency (prevents duplicate posts)
 * - Updates queue_jobs.status in DB
 * - Calls platform adapter to publish post
 * - Updates scheduled_posts with platform_post_id and status
 * - Creates queue_job_logs entries for audit trail
 * 
 * Idempotency: Checks if job already processed by looking at:
 * - queue_jobs.status === 'completed'
 * - scheduled_posts.platform_post_id exists
 */

import { Job } from 'bullmq';
import { supabase } from '../../db/supabaseClient';
import {
  getQueueJob,
  updateQueueJobStatus,
  createQueueJobLog,
  getScheduledPost,
  updateScheduledPostOnPublish,
  updateScheduledPostOnFailure,
} from '../../db/queries';
import { publishToPlatform } from '../../adapters/platformAdapter';
import { categorizeError } from '../../services/errorRecoveryService';
import { recordPostAnalytics } from '../../services/analyticsService';
import { logActivity } from '../../services/activityLogger';
import { getCampaignReadiness } from '../../services/campaignReadinessService';
import { checkAndCompleteCampaignIfEligible } from '../../services/CampaignCompletionService';

interface PublishJobData {
  scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
}

/**
 * Process a publish job
 * 
 * @param job - BullMQ job containing scheduled_post_id and social_account_id
 */
export async function processPublishJob(job: Job<PublishJobData>): Promise<void> {
  const { scheduled_post_id, social_account_id, user_id } = job.data;
  const jobId = job.id;
  
  console.log(`📝 Processing publish job ${jobId} for scheduled_post ${scheduled_post_id}`);

  try {
    // Step 1: Idempotency check - verify job not already processed
    const queueJob = await getQueueJob(jobId as string);
    if (!queueJob) {
      console.warn(`⚠️ Queue job ${jobId} not found in database, skipping`);
      return;
    }

    if (queueJob.status === 'completed') {
      console.log(`✅ Job ${jobId} already completed, skipping (idempotency)`);
      return;
    }

    // Step 2: Check if scheduled_post already published (additional idempotency check)
    const scheduledPost = await getScheduledPost(scheduled_post_id);
    if (!scheduledPost) {
      throw new Error(`Scheduled post ${scheduled_post_id} not found`);
    }

    if (scheduledPost.platform_post_id) {
      console.log(`✅ Post ${scheduled_post_id} already published (platform_post_id: ${scheduledPost.platform_post_id}), skipping`);
      await updateQueueJobStatus(jobId as string, 'completed', {
        result_data: { message: 'Already published (idempotency check)' },
      });
      return;
    }

    // Step 3: Readiness and status guard
    if (scheduledPost.campaign_id) {
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('status')
        .eq('id', scheduledPost.campaign_id)
        .single();

      if (campaignError || !campaign || campaign.status !== 'active') {
        await updateQueueJobStatus(jobId as string, 'failed', {
          error_message: 'Campaign is not active',
          error_code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE',
        });
        await createQueueJobLog(
          jobId as string,
          'warn',
          'Publish blocked: campaign is not active',
          { campaign_id: scheduledPost.campaign_id }
        );
        const blockedError: any = new Error('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
        blockedError.skipQueueStatusUpdate = true;
        throw blockedError;
      }

      const readiness = await getCampaignReadiness(scheduledPost.campaign_id);
      if (!readiness || readiness.readiness_state !== 'ready') {
        await updateQueueJobStatus(jobId as string, 'failed', {
          error_message: 'Campaign readiness check failed',
          error_code: 'PUBLISH_BLOCKED_CAMPAIGN_NOT_READY',
        });
        await createQueueJobLog(
          jobId as string,
          'warn',
          'Publish blocked: campaign not ready',
          { campaign_id: scheduledPost.campaign_id }
        );
        const blockedError: any = new Error('PUBLISH_BLOCKED_CAMPAIGN_NOT_READY');
        blockedError.skipQueueStatusUpdate = true;
        throw blockedError;
      }
    }

    // Step 4: Update job status to 'processing'
    await updateQueueJobStatus(jobId as string, 'processing');
    await createQueueJobLog(jobId as string, 'info', `Started processing scheduled_post ${scheduled_post_id}`);

    // Step 5: Publish to platform
    console.log(`🚀 Publishing to platform via adapter...`);
    const result = await publishToPlatform(scheduled_post_id, social_account_id);

    if (result.success && result.platform_post_id) {
      // Step 6: Success - update scheduled_posts
      await updateScheduledPostOnPublish(
        scheduled_post_id,
        result.platform_post_id,
        result.post_url || '',
        result.published_at
      );

      // Step 7: Update queue job to completed
      await updateQueueJobStatus(jobId as string, 'completed', {
        result_data: {
          platform_post_id: result.platform_post_id,
          post_url: result.post_url,
        },
      });

      await createQueueJobLog(
        jobId as string,
        'info',
        `Successfully published post. Platform ID: ${result.platform_post_id}`,
        { platform_post_id: result.platform_post_id }
      );

      console.log(`✅ Post published successfully. Platform ID: ${result.platform_post_id}`);

      // Record analytics (mock metrics for now - integrate with platform APIs later)
      try {
        await recordPostAnalytics(
          scheduled_post_id,
          user_id,
          scheduledPost.platform,
          {
            views: 0, // TODO: Fetch from platform API
            likes: 0,
            shares: 0,
            comments: 0,
          },
          {}
        );
      } catch (analyticsError: any) {
        console.warn('Failed to record analytics:', analyticsError.message);
      }

      // Log activity
      try {
        await logActivity(user_id, 'post_published', 'post', scheduled_post_id, {
          campaign_id: scheduledPost.campaign_id,
          platform: scheduledPost.platform,
          platform_post_id: result.platform_post_id,
        });
      } catch (activityError: any) {
        console.warn('Failed to log activity:', activityError.message);
      }

      // Auto-completion: check if campaign is eligible when all posts published
      if (scheduledPost.campaign_id) {
        void checkAndCompleteCampaignIfEligible(scheduledPost.campaign_id).catch(() => {});
      }
    } else {
      // Step 8: Failure - categorize error and update scheduled_posts status
      const platformError = categorizeError(
        scheduledPost.platform,
        result.error || { message: 'Unknown error' }
      );

      await updateScheduledPostOnFailure(scheduled_post_id, platformError.user_message);
      
      // Update scheduled_post with error code
      await supabase
        .from('scheduled_posts')
        .update({
          error_code: platformError.code,
          error_message: platformError.user_message,
        })
        .eq('id', scheduled_post_id);

      // Calculate next retry time (exponential backoff)
      const attempts = queueJob.attempts || 0;
      const backoffDelay = Math.pow(2, attempts) * 60000; // 2^attempts minutes
      const nextRetryAt = new Date(Date.now() + backoffDelay);

      await updateQueueJobStatus(jobId as string, 'failed', {
        error_message: platformError.user_message,
        error_code: platformError.code,
        next_retry_at: nextRetryAt.toISOString(),
      });

      await createQueueJobLog(
        jobId as string,
        'error',
        `Publish failed: ${platformError.user_message}`,
        { error: result.error, scheduled_post_id, error_code: platformError.code }
      );

      console.error(`❌ Post publish failed: ${platformError.user_message}`);
      throw new Error(platformError.user_message);
    }
  } catch (error: any) {
    console.error(`❌ Error processing job ${jobId}:`, error.message);
    
    if (error?.skipQueueStatusUpdate) {
      throw error;
    }

    // Update job status to failed with error categorization
    try {
      const scheduledPost = await getScheduledPost(scheduled_post_id);
      const platformError = scheduledPost
        ? categorizeError(scheduledPost.platform, error)
        : { code: 'PROCESSING_ERROR', user_message: error.message };

      await updateQueueJobStatus(jobId as string, 'failed', {
        error_message: platformError.user_message,
        error_code: platformError.code,
      });
      await createQueueJobLog(
        jobId as string,
        'error',
        `Job processing error: ${error.message}`,
        { error: error.stack }
      );
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}

