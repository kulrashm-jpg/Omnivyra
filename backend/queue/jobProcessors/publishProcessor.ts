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
 * Idempotency — TWO boundaries, at two different identities:
 *
 *   1. JOB identity (re-delivery of ONE job). queue_jobs.status === 'completed'
 *      plus the 'processing' replay-suppression window. This collapses broker
 *      re-deliveries of the same BullMQ job id.
 *
 *   2. POST identity (two DIFFERENT executions for ONE scheduled post). A
 *      durable, database-decided claim: a conditional UPDATE that moves
 *      scheduled_posts.status into 'publishing' only when the row is still in
 *      the status this execution observed. Implemented as
 *      `claimScheduledPostForPublish` in backend/services/publishNowService.ts
 *      and SHARED with the direct publish path, so the queue worker, the cron
 *      safety net and the manual publish route all contend for one boundary.
 *
 * Boundary 1 alone is NOT sufficient. Two queue jobs for one scheduled post
 * have two distinct queue_jobs rows and two distinct BullMQ job ids, so each
 * one's job-level checks pass independently; both then read
 * `platform_post_id IS NULL` and both publish. Worse, the cron safety net
 * publishes with no queue_jobs row at all, so boundary 1 cannot see it.
 * Boundary 2 is the fix, and it lives in the database (the UPDATE's
 * affected-row count decides the winner) rather than in worker memory,
 * because these paths run in more than one runtime.
 */

import { Job } from 'bullmq';
import { supabase } from '../../db/supabaseClient';
import {
  getQueueJob,
  updateQueueJobStatus,
  claimQueueJobForProcessing,
  recordQueueJobRetryState,
  markQueueJobPlatformCallStarted,
  markQueueJobOutcomeUncertain,
  readPlatformCallMarker,
  PUBLISH_OUTCOME_UNCERTAIN,
  createQueueJobLog,
  getScheduledPost,
  updateScheduledPostOnPublish,
  updateScheduledPostOnFailure,
} from '../../db/queries';
import { publishToPlatform } from '../../adapters/platformAdapter';
import { publishThread } from '../../services/threadRuntime/threadPublishOrchestrator';
import { validatePublishReadiness } from '../../services/publishReadinessValidator';
import { refreshDurableMediaBeforePublish } from '../../services/mediaReferenceResolver';
import {
  refreshScheduledPostMediaFromRefs,
  // The post-level publish claim. Defined ONCE in publishNowService and shared
  // with this worker, so the queue path and the direct path (cron safety net +
  // manual publish) contend for the SAME boundary rather than two parallel
  // mechanisms that cannot see each other. See the block comment there.
  claimScheduledPostForPublish,
  releaseScheduledPostPublishClaim,
} from '../../services/publishNowService';
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
import { RETRY_STATE_EXHAUSTED, retryStateAfterFailedDelivery } from '../publishRetryState';

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

  // Every branch below ends this delivery with a throw, which BullMQ records
  // as a failed attempt. Record whether that attempt leaves a retry pending
  // BEFORE the throw reaches BullMQ (see recordRetryStateForFailedDelivery).
  try {
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
  } catch (deliveryError) {
    await recordRetryStateForFailedDelivery(jobId as string, job);
    throw deliveryError;
  }
}

/**
 * Durable retry state for a delivery that is about to fail (Step 2).
 *
 * `queue_jobs.status = 'failed'` is written on every failed delivery, final or
 * not; whether BullMQ will deliver the job again lives only in Redis. This
 * writes that fact next to the status, from the same numbers BullMQ itself
 * uses (attemptsMade before this delivery, opts.attempts), so cancellation and
 * the duplicate guards can see a job waiting in backoff.
 *
 * Lands only while the row is 'failed' — a path that did not mark the row
 * failed (pressure rejection leaves it 'pending'), or a row cancelled
 * meanwhile, is left alone. Best-effort by design: a lost write leaves the row
 * NULL (unknown), which is never treated as terminal, and the original error
 * still propagates.
 */
async function recordRetryStateForFailedDelivery(
  jobId: string,
  job: Pick<Job<PublishJobData>, 'attemptsMade' | 'opts'>,
): Promise<void> {
  const retryState = retryStateAfterFailedDelivery(job.attemptsMade, job.opts?.attempts);
  let outcome: Awaited<ReturnType<typeof recordQueueJobRetryState>>;
  try {
    outcome = await recordQueueJobRetryState(jobId, retryState);
  } catch {
    // Must never replace the delivery's own error with its own.
    outcome = 'error';
  }
  if (outcome === 'error') {
    console.warn(`[publishProcessor] retry_state '${retryState}' not recorded for job ${jobId}; row stays unknown`);
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

  // Set once this execution owns the post-level claim, so the catch block
  // knows whether it has anything to give back.
  let heldClaimFromStatus: string | null = null;

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

    // Cancellation is decided by the DATABASE, not by whether job.remove()
    // managed to delete the BullMQ job. remove() cannot delete a job BullMQ is
    // already holding (active/locked), and a Redis hiccup can defeat it too —
    // either way the job is still delivered. A row the cancel helper (or the
    // reliability sweeps) marked 'cancelled' is never published.
    if (queueJob.status === 'cancelled') {
      console.log(`⏹️ Job ${jobId} was cancelled, skipping (database cancellation is authoritative)`);
      return;
    }

    // The final delivery already failed and was recorded as such. A delivery
    // arriving after that (a stalled re-delivery after a crash between the
    // state write and BullMQ's own failure record) must not publish.
    if (queueJob.status === 'failed' && queueJob.retry_state === RETRY_STATE_EXHAUSTED) {
      console.log(`⏹️ Job ${jobId} exhausted its retries, skipping`);
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

    // Uncertain outcome — a previous attempt of THIS job died after it started
    // the platform call. Reaching here means the job is 'processing' and older
    // than the replay window (a fresh one returned above), the attempt recorded
    // that it was calling the platform, and no platform_post_id was saved (the
    // short-circuit above returned otherwise). The post may already be live. No
    // adapter can make the call idempotent, so calling again risks a public
    // duplicate: record the uncertainty, stop, and leave the retry to a person
    // who has checked the platform. A death BEFORE the marker (no call started)
    // still retries normally below.
    //
    // The post is usually NOT 'publishing' any more by the time BullMQ
    // re-delivers a stalled job (30–60 min): /api/cron/sweep-stuck-publishing
    // turns rows stuck in 'publishing' for >10 min into 'failed' — older sweeper
    // builds without any error_code, newer ones with PUBLISH_OUTCOME_UNCERTAIN.
    // A handled platform failure always records its own error_code, so a
    // 'failed' post with no code (or the uncertain code) is the swept, unknown
    // case — never a known failure.
    const postStatus = (scheduledPost as { status?: string | null }).status ?? null;
    const postErrorCode = (scheduledPost as { error_code?: string | null }).error_code ?? null;
    const outcomeUnresolvedPost =
      postStatus === 'publishing' ||
      (postStatus === 'failed' && (!postErrorCode || postErrorCode === PUBLISH_OUTCOME_UNCERTAIN));
    if (
      queueJob.status === 'processing' &&
      scheduledPost.is_thread_start !== true &&
      outcomeUnresolvedPost &&
      readPlatformCallMarker(queueJob.metadata)
    ) {
      const uncertainMessage =
        'Publish outcome unknown: the worker stopped after sending this post to the platform and before ' +
        'the result was saved. It may already be live — check the platform before retrying.';
      const marked = await markQueueJobOutcomeUncertain(jobId as string, queueJob, uncertainMessage);
      if (!marked) {
        console.warn(`⚠️ Job ${jobId}: uncertain-outcome transition lost to a concurrent change — not publishing`);
        return;
      }
      const { error: postUncertainError } = await supabase
        .from('scheduled_posts')
        .update({
          status: 'failed',
          error_code: PUBLISH_OUTCOME_UNCERTAIN,
          error_message: uncertainMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduled_post_id)
        // Only a row whose outcome is still unrecorded: never over a
        // 'published' row or one carrying a platform_post_id.
        .in('status', ['publishing', 'failed'])
        .is('platform_post_id', null);
      if (postUncertainError) {
        console.error(`[publishProcessor] uncertain-outcome post write failed for ${scheduled_post_id}:`, postUncertainError.message);
      }
      await createQueueJobLog(jobId as string, 'warn', 'Publish outcome uncertain — not republishing', {
        scheduled_post_id,
        platform_call: readPlatformCallMarker(queueJob.metadata),
      });
      console.warn(`⚠️ Job ${jobId}: ${PUBLISH_OUTCOME_UNCERTAIN} for scheduled_post ${scheduled_post_id} — not republishing`);
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

    // Step 4: Claim the job row — compare-and-set into 'processing'.
    //
    // Was an unconditional write, which re-animated a row cancelled after the
    // Step-1 read: 'cancelled' became 'processing' and the post published. The
    // claim only lands while the row is still in the state read at Step 1, so a
    // cancellation (or a competing delivery) in between leaves zero affected
    // rows and this delivery stops here without touching the platform.
    const jobClaim = await claimQueueJobForProcessing(jobId as string, queueJob);
    if (jobClaim.claimed === false) {
      console.warn(
        `⚠️ Job ${jobId}: queue_job claim refused (${jobClaim.reason}, read status '${queueJob.status}') — not publishing`,
      );
      return;
    }
    await createQueueJobLog(jobId as string, 'info', `Started processing scheduled_post ${scheduled_post_id}`);

    // ── Step 4a: POST-LEVEL PUBLISH CLAIM ────────────────────────────────
    //
    // Everything above this line is keyed on the JOB. Two queue jobs for one
    // scheduled post reach here independently, and the cron safety net reaches
    // the platform without any job at all. This claim is the first thing that
    // is keyed on the POST, and the database decides who wins it. It is the
    // SAME helper the direct path calls (publishNowService), so a queue
    // execution and a cron execution contend with each other, not past each
    // other.
    //
    // Placed BEFORE the readiness gate and the media refreshes because those
    // steps mutate the scheduled_posts row; the claim must cover them, not
    // just the platform call.
    //
    // THREAD ROOTS ARE EXEMPT — deliberately, and for the same reason they
    // are exempt from the Step-2 platform_post_id short-circuit. A thread root
    // is not published by this function: Step 5 delegates to
    // threadPublishOrchestrator, which runs its OWN per-node claim
    // (`transitionRowStatus(row.id, fromStatus, 'publishing')`) starting from
    // the root's current status. Pre-claiming the root here would move it to
    // 'publishing' and the orchestrator's `assertCanTransition('publishing',
    // 'publishing')` would throw — breaking every thread. The orchestrator's
    // node-level claim is the same mechanism at finer granularity, so thread
    // publishes are already covered; adding a second claim would only remove
    // the coverage they have.
    if (scheduledPost.is_thread_start !== true) {
      const claim = await claimScheduledPostForPublish({
        scheduledPostId:   scheduled_post_id,
        snapshotStatus:    (scheduledPost as { status?: string | null }).status ?? null,
        snapshotUpdatedAt: (scheduledPost as { updated_at?: string | null }).updated_at ?? null,
      });

      if (!claim.claimed) {
        // Another execution owns this post. Do NOT call the platform: that is
        // exactly the duplicate publish this boundary exists to prevent.
        // Complete this job rather than throwing — the holder owns the retry,
        // so a BullMQ retry here would only re-contend.
        const message = claim.reason === 'already_published'
          ? 'Already published (post-level claim: another execution completed it)'
          : 'Duplicate publish suppressed (post-level claim held by another execution)';
        console.warn(`⚠️ Job ${jobId}: ${message} — scheduled_post ${scheduled_post_id}`);
        await updateQueueJobStatus(jobId as string, 'completed', {
          result_data: { message, suppressed: true, reason: claim.reason },
        });
        await createQueueJobLog(jobId as string, 'warn', message, {
          scheduled_post_id, reason: claim.reason,
        });
        return;
      }

      heldClaimFromStatus = claim.fromStatus;
    }

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

    // Record that THIS attempt is about to call the platform (see the
    // uncertain-outcome check above). If the row is no longer 'processing' — a
    // cancel landed after the claim — do not call the platform; the throw
    // releases the post claim in the catch below.
    const platformCallRecorded = await markQueueJobPlatformCallStarted(jobId as string, queueJob.metadata);
    if (!platformCallRecorded) {
      const abortError: Error & { skipQueueStatusUpdate?: true } = new Error('PUBLISH_ABORTED_JOB_NOT_PROCESSING');
      abortError.skipQueueStatusUpdate = true;
      throw abortError;
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

    // Give the post-level claim back before anything else. A compare-and-set
    // on 'publishing', so it is a no-op when a terminal status was already
    // written (success wrote 'published'; the handled-failure and readiness
    // paths wrote 'failed'). It only fires on an UNEXPECTED throw, where it
    // restores the exact status this execution claimed from — leaving the row
    // as retryable as it was before, never more blocked.
    if (heldClaimFromStatus) {
      const restoreStatus = heldClaimFromStatus;
      heldClaimFromStatus = null;
      try {
        await releaseScheduledPostPublishClaim(scheduled_post_id, restoreStatus);
      } catch (releaseError) {
        console.warn(
          '[publishProcessor] publish-claim release threw (non-fatal):',
          releaseError instanceof Error ? releaseError.message : String(releaseError),
        );
      }
    }

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

