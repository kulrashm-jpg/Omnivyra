import { ownedDbTable } from '../db/writeOwner';
import { safeEnqueue } from '../middleware/queueBackpressure';
// R2-IMPL B1 — the ONE publish-authorization predicate, shared with
// publishProcessor so cron eligibility and publish-time authorization agree.
import { authorizePostPublish } from '../../lib/campaign/publishAuthorization';
/**
 * Scheduler Service
 *
 * Queries database for scheduled posts that are due for publishing
 * and creates queue_jobs + enqueues them in BullMQ.
 *
 * Prevents duplicate jobs by checking if queue_job already exists
 * for a scheduled_post_id with status 'pending' or 'processing'.
 *
 * Module layout (Agent-B large-file modularization — behavior-preserving):
 *   schedulerPostQueueControl.ts  — precise-time enqueue + lock/cancel/atomic reschedule
 *   schedulerIntelligenceJobs.ts  — intelligence polling + engine runners + lead detection
 * Both are re-exported below, so importers keep using this path.
 */

import { getQueue, getEngagementPollingQueue } from '../queue/bullmqClient';
import { createQueueJob } from '../db/queries';
import { recordScheduler } from '../observability/metrics';

export {
  enqueueScheduledPostAt,
  tryAcquireScheduledPostQueueLock,
  atomicCancelAndReEnqueueScheduledPost,
  cancelScheduledPostQueueEntry,
} from './schedulerPostQueueControl';
export * from './schedulerIntelligenceJobs';

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
  // HARDEN-001/004: scheduler run timing (fail-safe, measurement only).
  const _obsStart = Date.now();
  try {
    const result = await findDuePostsAndEnqueueInner();
    try { recordScheduler({ job: 'publish_scheduler', durationMs: Date.now() - _obsStart, outcome: 'completed' }); } catch { /* fail-safe */ }
    return result;
  } catch (err) {
    try { recordScheduler({ job: 'publish_scheduler', durationMs: Date.now() - _obsStart, outcome: 'failed' }); } catch { /* fail-safe */ }
    throw err;
  }
}

async function findDuePostsAndEnqueueInner(): Promise<SchedulerResult> {
  const now = new Date().toISOString();

  console.log(`🔍 Finding scheduled posts due before ${now}...`);

  // Query due scheduled posts with priority sorting
  // Higher priority posts (priority > 0) are processed first
  const { data: duePosts, error } = await ownedDbTable('scheduled_posts')
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

  // ── Duplicate guard: which due posts ALREADY have a live queue job? ─────────
  // Three states exist here and MUST NOT be collapsed into two:
  //   A. lookup succeeded, no row  → post is eligible
  //   B. lookup succeeded, row     → post is protected from a second enqueue
  //   C. lookup FAILED             → queue state is UNKNOWN, and must NEVER be
  //                                  read as A.
  //
  // This error used to be discarded. On a failed round-trip `existingJobs` came
  // back null, `existingPostIds` became an EMPTY SET, and the cycle therefore
  // treated EVERY due post as un-enqueued — a mass duplicate enqueue that
  // double-publishes to public social platforms and cannot be undone. Unlike
  // the per-post guard in schedulerPostQueueControl, the blast radius here is
  // the entire cycle.
  //
  // We fail the cycle, exactly like the sibling scheduled_posts lookup above and
  // the campaigns lookup below. That is the option this architecture already
  // supports end to end: nothing has been written at this point (the guard runs
  // before the campaigns batch and before any insert/enqueue), the
  // findDuePostsAndEnqueue wrapper records the run as `outcome: 'failed'`,
  // cron.ts catches, logs and deliberately continues on the next interval, and
  // recovery is automatic — the posts are still `status='scheduled'` with
  // `scheduled_for <= now`, so the next healthy cycle re-selects and enqueues
  // them normally. Returning them as `skipped` instead would be silently
  // indistinguishable from "everything was already queued" and would lose the
  // failure signal. Refusing to act on unknown queue state is the only
  // behaviour that cannot double-publish.
  const { data: existingJobs, error: existingJobsError } = await ownedDbTable('queue_jobs')
    .select('scheduled_post_id, status')
    .in('scheduled_post_id', duePosts.map(p => p.id))
    .in('status', ['pending', 'processing']);

  if (existingJobsError || !existingJobs) {
    const reason = existingJobsError?.message ?? 'no rows returned';
    console.error(
      `❌ Duplicate-guard lookup failed (${reason}) — aborting cycle without enqueueing ` +
      `${found} due post(s); they remain scheduled and are retried next cycle`
    );
    throw new Error(`Failed to query queue_jobs: ${reason}`);
  }

  const existingPostIds = new Set(
    existingJobs.map(j => j.scheduled_post_id)
  );

  // ── HARDEN-004: batch the per-post campaign lookup ──────────────────────────
  // The loop below used to run a `campaigns` .single() query PER POST (repeated
  // even for posts sharing a campaign). One batched .in() query + an in-memory
  // map produces the same per-post decision: a campaign missing from the map ⇔
  // the old .single() error path (CAMPAIGN_NOT_ACTIVE).
  //
  // R2-IMPL B1: the parallel `campaign_readiness` batch is GONE. Campaign-global
  // readiness no longer authorizes enqueue — eligibility is decided per post by
  // lib/campaign/publishAuthorization, the same predicate the publish worker
  // uses. The due-post query above already filters `status = 'scheduled'`, so an
  // unreleased sibling week is never a candidate in the first place.
  const campaignIds = [...new Set(
    (duePosts || [])
      .filter((p) => !existingPostIds.has(p.id) && p.campaign_id)
      .map((p) => p.campaign_id as string)
  )];

  const campaignStatusById = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaignRows, error: campaignsError } = await ownedDbTable('campaigns')
      .select('id, status')
      .in('id', campaignIds);
    if (campaignsError) {
      // Old behavior: a failing campaign lookup threw out of the run.
      throw new Error(`Failed to query campaigns: ${campaignsError.message}`);
    }
    for (const row of campaignRows || []) {
      campaignStatusById.set(row.id, String(row.status ?? ''));
    }
  }

  let created = 0;
  let skipped = 0;

  const queue = getQueue();

  // ── Decide per post from the in-memory maps (identical decisions) ───────────
  type DuePost = NonNullable<typeof duePosts>[number];
  const eligible: DuePost[] = [];
  for (const post of duePosts || []) {
    // Skip if job already exists
    if (existingPostIds.has(post.id)) {
      console.log(`⏭️  Skipping ${post.id} - job already queued`);
      skipped++;
      continue;
    }

    // R2-IMPL B1 — ONE authorization predicate, shared with the publish worker,
    // so cron eligibility and publish-time authorization cannot diverge (and
    // BOLT and Strategic Mix obey identical semantics).
    const authorization = authorizePostPublish({
      campaign_id: post.campaign_id,
      campaign_status: post.campaign_id ? (campaignStatusById.get(post.campaign_id) ?? null) : null,
      post_status: (post as { status?: string | null }).status ?? null,
      // Cron already filters to due, unpublished posts; platform_post_id is not
      // selected here, so idempotency stays with the queue-job duplicate guard
      // above and the worker's own short-circuit.
      platform_post_id: null,
    });
    if (!authorization.authorized) {
      console.warn({
        campaign_id: post.campaign_id,
        scheduled_post_id: post.id,
        reason: authorization.code,
      });
      skipped++;
      continue;
    }

    eligible.push(post);
  }

  // ── HARDEN-004: bulk insert queue_jobs + BullMQ addBulk ─────────────────────
  // One INSERT and one pipelined enqueue replace 2×N sequential round-trips.
  // `eligible` keeps the due-post ORDER (priority desc, scheduled_for asc) and
  // addBulk preserves array order, so publish order is identical. Payloads,
  // jobIds (queue_jobs.id) and job options are byte-identical to the old
  // per-post path. On ANY bulk failure we fall back to the original per-post
  // loop for the same partial-failure semantics as before.
  if (eligible.length > 0) {
    let bulkDone = false;
    try {
      const { data: insertedRows, error: insertError } = await ownedDbTable('queue_jobs')
        .insert(eligible.map((post) => ({
          scheduled_post_id: post.id,
          job_type: 'publish',
          status: 'pending',
          scheduled_for: post.scheduled_for,
          priority: (post as any).priority || 0,
          attempts: 0,
          max_attempts: 3,
        })))
        .select('id, scheduled_post_id');
      if (insertError || !insertedRows || insertedRows.length !== eligible.length) {
        throw new Error(`bulk queue_jobs insert failed: ${insertError?.message ?? 'row count mismatch'}`);
      }
      const jobIdByPostId = new Map<string, string>(
        insertedRows.map((r: { id: string; scheduled_post_id: string }) => [r.scheduled_post_id, r.id])
      );

      await queue.addBulk(eligible.map((post) => ({
        name: 'publish',
        data: {
          scheduled_post_id: post.id,
          social_account_id: post.social_account_id,
          user_id: post.user_id,
        },
        opts: {
          jobId: jobIdByPostId.get(post.id), // DB UUID as BullMQ job ID (unchanged)
          removeOnComplete: true,
          removeOnFail: false, // Keep failed jobs for debugging
        },
      })));

      for (const post of eligible) {
        console.log(`✅ Enqueued job ${jobIdByPostId.get(post.id)} for post ${post.id}`);
      }
      created += eligible.length;
      bulkDone = true;
    } catch (bulkError: any) {
      console.warn(`[scheduler] bulk enqueue failed (${bulkError?.message}) — falling back to per-post enqueue`);
    }

    if (!bulkDone) {
      // Fallback: the original sequential per-post path (identical semantics,
      // incl. continuing past individual failures). The duplicate guard above
      // plus queue.add jobId idempotency make re-processing safe even if some
      // rows were inserted by the failed bulk attempt.
      for (const post of eligible) {
        try {
          const queueJobId = await createQueueJob({
            scheduled_post_id: post.id,
            job_type: 'publish',
            status: 'pending',
            scheduled_for: post.scheduled_for,
            priority: (post as any).priority || 0,
          });

          await safeEnqueue(
            queue,
            'publish',
            'publish',
            {
              scheduled_post_id: post.id,
              social_account_id: post.social_account_id,
              user_id: post.user_id,
            },
            {
              jobId: queueJobId,
              removeOnComplete: true,
              removeOnFail: false,
            }
          );

          console.log(`✅ Enqueued job ${queueJobId} for post ${post.id}`);
          created++;
        } catch (error: any) {
          console.error(`❌ Failed to enqueue post ${post.id}:`, error.message);
          // Continue with other posts
        }
      }
    }
  }

  return { found, created, skipped };
}

/**
 * Enqueue one engagement polling job.
 * Idempotent ingestion; no duplicate check. Call every 10 minutes (e.g. from cron).
 */
export async function enqueueEngagementPolling(): Promise<void> {
  const queue = getEngagementPollingQueue();
  await safeEnqueue(queue, 'engagement-polling', 'poll', {}, { jobId: `engagement-poll-${Date.now()}` });
  console.log('✅ Engagement polling job enqueued');
}
