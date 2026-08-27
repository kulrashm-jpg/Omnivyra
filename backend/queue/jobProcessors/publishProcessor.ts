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
import { publishThread } from '../../services/threadRuntime/threadPublishOrchestrator';
import { validatePublishReadiness } from '../../services/publishReadinessValidator';
import { refreshDurableMediaBeforePublish } from '../../services/mediaReferenceResolver';
import { refreshScheduledPostMediaFromRefs } from '../../services/publishNowService';
import { resolvePublishingOrganization } from '../../services/creator/publishingOrganizationResolver';
import { logPipelineEvent } from '../../../lib/shared/observability';
import { categorizeError } from '../../services/errorRecoveryService';
import { recordPostAnalytics } from '../../services/analyticsService';
import { schedulePostPolls } from '../../services/analyticsNormalizationService';
import { logActivity } from '../../services/activityLogger';
import { createUserNotification } from '../../services/userNotificationService';
// R2-IMPL B1 — campaign readiness is no longer a publish authorization input.
// It remains a planning/diagnostic metric (Campaign Board, growth guidance,
// campaign health); publication is authorized per post by this predicate.
import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';
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
  // Canonical organization identity (the single resolver) — social_accounts.company_id
  // is the owning tenant; never a caller-supplied id, never userId-as-companyId.
  const resolvedOrgId: string | null = await resolvePublishingOrganization({ socialAccountId: social_account_id });

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
    async () => processPublishJobInner({
      scheduled_post_id, social_account_id, user_id, jobId,
      // Only the LAST BullMQ attempt notifies the user (avoids 3x retry spam — RULE 5).
      isFinalAttempt: ((job.attemptsMade ?? 0) + 1) >= (job.opts?.attempts ?? 1),
    }),
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
  isFinalAttempt?: boolean;
}): Promise<void> {
  const { scheduled_post_id, social_account_id, user_id, jobId, isFinalAttempt } = params;

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

    // Replay-window suppression. If the queue_job is already 'processing'
    // and that status was set recently, a previous worker is either still
    // alive OR died between the platform-call success and the scheduled_post
    // status write. In either case, re-running the platform call risks
    // duplicate posts (LinkedIn/X both accept identical content twice). We
    // suppress for a 5-minute window — longer than any healthy publish
    // takes — after which the lock is presumed stale and the retry can
    // proceed. updated_at is maintained by updateQueueJobStatus so this
    // uses already-tracked state (zero new persistence). On terminal
    // failure paths, status flips to 'failed' before the suppression
    // window closes, so legitimate retries are unaffected.
    if (queueJob.status === 'processing' && queueJob.updated_at) {
      const PUBLISH_SUPPRESSION_WINDOW_MS = 5 * 60 * 1000;
      const ageMs = Date.now() - new Date(queueJob.updated_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < PUBLISH_SUPPRESSION_WINDOW_MS) {
        console.warn(
          `⚠️ Job ${jobId} is already 'processing' from a recent attempt ` +
          `(${Math.round(ageMs / 1000)}s ago, suppression window ${PUBLISH_SUPPRESSION_WINDOW_MS / 1000}s). ` +
          `Suppressing duplicate publish — platform-side duplicate posts are the higher risk than a missed retry. ` +
          `If the prior attempt died mid-publish, the next retry after the window expires will proceed.`,
        );
        return;
      }
    }

    // Step 2: Check if scheduled_post already published (additional idempotency check)
    const scheduledPost = await getScheduledPost(scheduled_post_id);
    if (!scheduledPost) {
      throw new Error(`Scheduled post ${scheduled_post_id} not found`);
    }

    // G12 — single-row idempotency short-circuit. For THREAD roots, a set
    // platform_post_id only means the root published; children may still be
    // pending. The thread delegation at Step 5 (below) handles per-row
    // idempotency via the orchestrator's publishOneNode, which safely skips
    // already-published nodes and resumes from the failed/blocked row.
    if (scheduledPost.platform_post_id && scheduledPost.is_thread_start !== true) {
      console.log(`✅ Post ${scheduled_post_id} already published (platform_post_id: ${scheduledPost.platform_post_id}), skipping`);
      await updateQueueJobStatus(jobId as string, 'completed', {
        result_data: { message: 'Already published (idempotency check)' },
      });
      return;
    }

    // ── Step 3: PER-POST publish authorization (R2-IMPL B1) ────────────────
    //
    // Was: campaign active AND campaign_readiness.readiness_state === 'ready'.
    // That second condition is CAMPAIGN-GLOBAL — it demands the entire campaign
    // be 100% planned and 100% scheduled — so releasing weeks 1-2 of a six-week
    // campaign blocked the released weeks along with the unreleased ones. In
    // production it was satisfied by zero campaigns, so nothing published
    // through this worker at all.
    //
    // Now: authorization is a property of THIS post — see
    // lib/campaign/publishAuthorization for the full safety mapping. The
    // campaign-active requirement is unchanged; campaign readiness is no longer
    // an authorization input (it remains a planning/diagnostic metric).
    //
    // The release gate (`post_status` releasable) is what keeps an unreleased
    // week blocked: the release seam never schedules draft/review content, so
    // an unreleased slot has no scheduled_posts row to authorize.
    {
      let campaignStatus: string | null = null;
      if (scheduledPost.campaign_id) {
        const { data: campaign, error: campaignError } = await supabase
          .from('campaigns')
          .select('status')
          .eq('id', scheduledPost.campaign_id)
          .single();
        // A missing/unreadable campaign leaves status null ⇒ not active ⇒ denied,
        // exactly as the previous `campaignError || !campaign` branch did.
        campaignStatus = campaignError || !campaign ? null : ((campaign as { status?: string }).status ?? null);
      }

      const authorization = authorizePostPublish({
        campaign_id: scheduledPost.campaign_id,
        campaign_status: campaignStatus,
        post_status: (scheduledPost as { status?: string | null }).status ?? null,
        // platform_post_id is handled by the Step-2 idempotency short-circuit
        // above; passing it here would double-report the same condition.
        platform_post_id: null,
        is_thread_start: scheduledPost.is_thread_start === true,
        has_content: Boolean(
          scheduledPost.content && String(scheduledPost.content).trim().length > 0,
        ),
      });

      if (!authorization.authorized) {
        await updateQueueJobStatus(jobId as string, 'failed', {
          error_message: `Publish blocked: ${authorization.reason}`,
          error_code: authorization.code,
        });
        await createQueueJobLog(
          jobId as string,
          'warn',
          `Publish blocked: ${authorization.reason}`,
          { campaign_id: scheduledPost.campaign_id, code: authorization.code },
        );
        const blockedError: any = new Error(authorization.code);
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
      content: typeof scheduledPost.content === 'string' ? scheduledPost.content : '',
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

    // Step 4c.2: Creator asset re-resolution — re-resolve CreatorAssetRef through
    // the SAME shared path the sync entrypoints use and refresh the row's media
    // snapshot, so the adapter uploads the CURRENT rendering payload (not the
    // schedule-time snapshot) and retries stay deterministic. No-op/fallback when
    // refs are unavailable; fail-open. Telemetry comes from the shared path only.
    await refreshScheduledPostMediaFromRefs({ scheduledPostId: scheduled_post_id, userId: user_id, post: scheduledPost as unknown as Record<string, unknown> });

    // Step 5: Publish to platform.
    //
    // Phase 1B.2A.1 — thread orchestrator delegation (queue side).
    // Mirrors publishNowService.publishNow's delegation block. If this row is
    // the root of a multi-row thread (is_thread_start=true), hand off to the
    // thread publish orchestrator instead of running the single-row adapter
    // path below. The orchestrator manages per-node state transitions,
    // sequential publish, native reply-chain (Twitter) / sequential standalone
    // (LinkedIn/IG/FB), and per-row updateScheduledPostOn{Publish,Failure}
    // writes. On BullMQ retry, the orchestrator's per-row platform_post_id
    // idempotency check (publishOneNode) skips already-published nodes and
    // resumes from the failed/blocked row (transitions failed→publishing and
    // blocked→publishing are valid per the state machine).
    if (scheduledPost.is_thread_start === true) {
      console.log(`🧵 Delegating to thread orchestrator (root=${scheduled_post_id})...`);
      const threadResult = await publishThread({
        root_scheduled_post_id: scheduled_post_id,
        social_account_id,
        user_id,
      });

      if (threadResult.status === 'PUBLISHED') {
        // Per-row scheduled_posts updates were performed inside the
        // orchestrator (updateScheduledPostOnPublish on each node). Only the
        // queue_jobs row needs to be marked completed here.
        await updateQueueJobStatus(jobId as string, 'completed', {
          result_data: {
            thread:           true,
            root_id:          threadResult.root_id,
            total_nodes:      threadResult.total_nodes,
            published_count:  threadResult.published_count,
          },
        });
        await createQueueJobLog(
          jobId as string,
          'info',
          `Thread published (${threadResult.published_count}/${threadResult.total_nodes} nodes)`,
          { root_id: threadResult.root_id, total_nodes: threadResult.total_nodes },
        );
        console.log(`✅ Thread published successfully (${threadResult.published_count}/${threadResult.total_nodes} nodes)`);
        return;
      }

      // FAILED — orchestrator already set the failed row to status='failed'
      // and marked downstream rows as 'blocked'. Bridge into the queue's
      // retry semantics: mark queue_job 'failed' with the same exponential
      // backoff the single-row failure path uses, then throw so BullMQ
      // applies its retry policy. On retry, the orchestrator's idempotency
      // (platform_post_id short-circuit) skips already-published nodes.
      const threadErrorMessage = threadResult.message || 'Thread publish failed';
      const threadAttempts = queueJob.attempts || 0;
      const threadBackoffDelay = Math.pow(2, threadAttempts) * 60000;
      const threadNextRetryAt = new Date(Date.now() + threadBackoffDelay);
      await updateQueueJobStatus(jobId as string, 'failed', {
        error_message: threadErrorMessage,
        error_code:    'THREAD_PUBLISH_FAILED',
        next_retry_at: threadNextRetryAt.toISOString(),
      });
      await createQueueJobLog(
        jobId as string,
        'error',
        `Thread publish failed at position ${threadResult.failed_at_position ?? '?'}: ${threadErrorMessage}`,
        {
          root_id:             threadResult.root_id,
          total_nodes:         threadResult.total_nodes,
          published_count:     threadResult.published_count,
          failed_count:        threadResult.failed_count,
          blocked_count:       threadResult.blocked_count,
          failed_at_position:  threadResult.failed_at_position,
        },
      );
      console.error(`❌ Thread publish failed: ${threadErrorMessage}`);
      throw new Error(threadErrorMessage);
    }

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
      // P1-B — advance variant experiment tracker. Mirrors the pattern
      // used in publishNowService. Best-effort; failures never block
      // publish success.
      try {
        const { resolveStrategyAttributionForScheduledPost } = await import('../../services/creator/strategyAttributionResolver');
        const { notifyExperimentAssetPublished } = await import('../../services/creator/variantExperimentLifecycle');
        const attribution = await resolveStrategyAttributionForScheduledPost(scheduled_post_id);
        if (attribution?.variantId && attribution.companyId) {
          notifyExperimentAssetPublished({
            companyId: attribution.companyId,
            variantId: attribution.variantId,
            scheduledPostId: scheduled_post_id,
          });
        }
      } catch (err) {
        console.warn('[publishProcessor] experiment publish-notify failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }

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
        const pollOrgId = await resolvePublishingOrganization({ socialAccountId: social_account_id });
        if (pollOrgId) {
          await schedulePostPolls({
            scheduledPostId:  scheduled_post_id,
            socialAccountId:  social_account_id,
            platform:         scheduledPost.platform,
            platformPostId:   result.platform_post_id,
            companyId:        pollOrgId,
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
      // BETA-004 (RULE 9): record the failure to the user-visible activity feed too,
      // mirroring the success 'post_published' event — so failed publishes are never
      // invisible to operators/customers (status + reason already land on scheduled_posts).
      try {
        await logActivity(user_id, 'post_publish_failed', 'post', scheduled_post_id, {
          platform: scheduledPost?.platform,
          error_code: platformError.code,
          error_message: platformError.user_message,
        });
      } catch (activityError: any) {
        console.warn('Failed to log publish-failure activity:', activityError?.message);
      }
      // BETA-007 (RULE 5): on the FINAL failed attempt, push a user notification so a
      // failed publish reaches the NotificationBell (retries don't spam). Best-effort.
      if (isFinalAttempt) {
        await createUserNotification({
          userId: user_id,
          type: 'post_publish_failed',
          title: 'Post failed to publish',
          message: `Your ${scheduledPost?.platform ?? 'social'} post couldn't be published: ${platformError.user_message}`,
          metadata: { scheduled_post_id, platform: scheduledPost?.platform, error_code: platformError.code },
        });
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}

