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
import { validatePublishReadiness } from '../../services/publishReadinessValidator';
import { refreshDurableMediaBeforePublish } from '../../services/mediaReferenceResolver';
import { logPipelineEvent } from '../../../lib/shared/observability';
import { categorizeError } from '../../services/errorRecoveryService';
import { recordPostAnalytics } from '../../services/analyticsService';
import { schedulePostPolls } from '../../services/analyticsNormalizationService';
import { logActivity } from '../../services/activityLogger';
import { getCampaignReadiness } from '../../services/campaignReadinessService';
import { checkAndCompleteCampaignIfEligible } from '../../services/CampaignCompletionService';
import { runJob } from '../../services/jobRunner';

interface PublishJobData {
  scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
}

/**
 * Process a publish job
 *
 * Wrapped in canonical jobRunner for tenant containment + execution
 * attribution + DLQ lineage. Retry ownership is 'external' — BullMQ owns
 * retry semantics for queue processors; the runner adds the tenant-guard
 * + idempotency + audit layer without double-retrying.
 *
 * Tenant binding: the social_account_id is resolved to the owning
 * organizationId BEFORE any mutation. If the org is soft-deleted /
 * missing, the job short-circuits with `tenant_invalid` — no platform
 * call, no scheduled_posts mutation, no analytics write.
 *
 * @param job - BullMQ job containing scheduled_post_id and social_account_id
 */
export async function processPublishJob(job: Job<PublishJobData>): Promise<void> {
  const { scheduled_post_id, social_account_id, user_id } = job.data;
  const jobId = job.id;

  // Resolve the owning organization BEFORE the runner so the tenant
  // guard has the canonical org id. social_accounts.company_id IS the
  // canonical owning tenant — we never trust caller-supplied org ids.
  let resolvedOrgId: string | null = null;
  try {
    const { data: acct } = await supabase
      .from('social_accounts')
      .select('company_id')
      .eq('id', social_account_id)
      .single();
    resolvedOrgId = (acct?.company_id as string | undefined) ?? null;
  } catch {
    /* fall through — runner will reject with NO_ORG_ID */
  }

  const outcome = await runJob(
    {
      jobName:         'queue:publish',
      triggerSource:   'queue',
      tenantId:        resolvedOrgId,
      principalUserId: user_id,
      principalKind:   'queue:bullmq',
      // BullMQ's job id is unique per delivery; one publish per job id is
      // the canonical idempotency boundary. Re-deliveries (broker retry)
      // collapse via the queue_jobs.status='completed' guard inside the
      // handler, so the runner key is also the BullMQ job id.
      idempotencyKey:  `queue:publish:${String(jobId)}`,
      attempt:         (job.attemptsMade ?? 0) + 1,
      retryOwner:      'external',
      // Per-tenant concurrency cap. Social platforms have their own
      // rate limits; running more than 5 publishes simultaneously for
      // one tenant just queues at the platform. The burst cap of 30/s
      // bounds runaway-client fanout (someone POSTing /publish 100x in
      // a tight loop). When the tenantId is unknown the lease falls
      // back to a generic 'queue:publish:no-tenant' bucket so an org
      // with no resolved company_id still can't saturate.
      concurrency: {
        key:                 resolvedOrgId
          ? `tenant:${resolvedOrgId}:queue:publish`
          : 'queue:publish:no-tenant',
        max:                 5,
        maxPerSecond:        30,
        maxRetriesPerMinute: 60,
      },
      payload: {
        scheduled_post_id,
        social_account_id,
        user_id,
      },
    },
    async () => processPublishJobInner({ scheduled_post_id, social_account_id, user_id, jobId }),
  );

  if (outcome.status === 'completed') return;

  if (outcome.status === 'tenant_invalid') {
    // The owning org is gone or suspended. Mark the job failed with a
    // terminal classification so BullMQ doesn't retry — the underlying
    // tenant cannot accept the publish.
    try {
      await updateQueueJobStatus(jobId as string, 'failed', {
        error_message: `Tenant invalid: ${outcome.reason}`,
        error_code:    'PUBLISH_BLOCKED_TENANT_INVALID',
      });
      await createQueueJobLog(
        jobId as string,
        'warn',
        `Publish blocked: tenant invalid (${outcome.reason})`,
        { social_account_id, scheduled_post_id, executionId: outcome.ctx.executionId }
      );
    } catch {
      /* fail-soft */
    }
    const blockedError: Error & { skipQueueStatusUpdate?: true } = new Error(
      `PUBLISH_BLOCKED_TENANT_INVALID:${outcome.reason}`,
    );
    blockedError.skipQueueStatusUpdate = true;
    throw blockedError;
  }

  if (outcome.status === 'dead_letter_skip') {
    // Operator must explicitly replay. Don't re-execute or re-retry.
    const skipError: Error & { skipQueueStatusUpdate?: true } = new Error(
      `PUBLISH_DEAD_LETTER_SKIP:${outcome.reason}`,
    );
    skipError.skipQueueStatusUpdate = true;
    throw skipError;
  }

  if (outcome.status === 'pressure_rejected') {
    // Governor refused — back off and let BullMQ's broker-level retry
    // handle this delivery again. Throw a real Error so BullMQ records
    // the failure and applies its retry/backoff. We do NOT mark the
    // queue_job 'failed' because the next delivery attempt is still
    // valid work; pressure is transient.
    throw new Error(`PUBLISH_PRESSURE_REJECTED:${outcome.reason}:key=${outcome.key}`);
  }

  // outcome.status === 'failed' — re-throw so BullMQ records the failure
  // and applies its own retry policy. The DLQ entry was already enriched
  // by the runner.
  if (outcome.status === 'failed') {
    if (outcome.error instanceof Error) throw outcome.error;
    throw new Error(String(outcome.error));
  }
}

/** Inner handler — original logic. Tenant-validated, attributed by the runner. */
async function processPublishJobInner(params: {
  scheduled_post_id: string;
  social_account_id: string;
  user_id: string;
  jobId: string | undefined;
}): Promise<void> {
  const { scheduled_post_id, social_account_id, user_id, jobId } = params;

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

    // Step 4b: Centralized publish-readiness gate (Round-4 item 1) — the
    // SAME validator the manual path uses (scheduled↔manual parity, no
    // duplicate logic). Runs AFTER the idempotency short-circuits (job
    // completed / platform_post_id present) so retries of an
    // already-published post are unaffected. Mode-gated (PUBLISH_GUARD_MODE).
    const pubReadiness = validatePublishReadiness({
      platform: String(scheduledPost.platform || ''),
      contentSignals: { contentType: String(scheduledPost.content_type || '') },
      hasText: !!(scheduledPost.content && String(scheduledPost.content).trim().length > 0),
      mediaUrls: scheduledPost.media_urls ?? [],
      skipSchedulingReadiness: true,
    });
    if (pubReadiness.ok === false) {
      logPipelineEvent('publish.scheduled_validation', 'warn', {
        scheduled_post_id, platform: scheduledPost.platform, code: pubReadiness.code,
      }, { dedupeKey: `${scheduledPost.platform}|${pubReadiness.code}` });
      await updateQueueJobStatus(jobId as string, 'failed', {
        error_message: pubReadiness.message,
        error_code: pubReadiness.code,
      });
      await updateScheduledPostOnFailure(scheduled_post_id, pubReadiness.message).catch(() => {});
      await createQueueJobLog(jobId as string, 'warn', 'Publish blocked: readiness validation failed', {
        code: pubReadiness.code, platform: scheduledPost.platform,
      });
      const blockedError: any = new Error(pubReadiness.code);
      blockedError.skipQueueStatusUpdate = true; // already persisted 'failed'; no BullMQ double-retry
      throw blockedError;
    }
    if (pubReadiness.warnings.length > 0) {
      logPipelineEvent('publish.scheduled_validation', 'info', {
        scheduled_post_id, platform: scheduledPost.platform,
        warnings: pubReadiness.warnings.map((w) => w.code),
      }, { dedupeKey: `${scheduledPost.platform}|warn` });
    }

    // Step 4c: Durable media refresh (Round-5 item 3) — parity with the
    // manual path. No-op unless DURABLE_MEDIA_REFS; fail-open.
    await refreshDurableMediaBeforePublish(scheduled_post_id);

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

      // Schedule analytics polls at +15min and +24h
      try {
        const { data: acct } = await supabase
          .from('social_accounts')
          .select('company_id')
          .eq('id', social_account_id)
          .single();
        if (acct?.company_id) {
          await schedulePostPolls({
            scheduledPostId:  scheduled_post_id,
            socialAccountId:  social_account_id,
            platform:         scheduledPost.platform,
            platformPostId:   result.platform_post_id,
            companyId:        String(acct.company_id),
            userId:           user_id,
          });
        }
      } catch (pollScheduleErr: any) {
        console.warn('[publishProcessor] schedulePostPolls failed:', pollScheduleErr?.message);
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

