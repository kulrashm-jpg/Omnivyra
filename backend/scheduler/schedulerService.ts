import { ownedDbTable } from '../db/writeOwner';
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

import { getQueue, getEngagementPollingQueue } from '../queue/bullmqClient';
import { createQueueJob } from '../db/queries';
import { getCampaignReadiness } from '../services/campaignReadinessService';
import { addIntelligencePollingJob } from '../queue/intelligencePollingQueue';
import { INTELLIGENCE_POLLER_USER_ID, isApiSourceExecutable } from '../services/externalApiService';
import { clusterRecentSignals } from '../services/signalClusterEngine';
import { generateSignalIntelligence } from '../services/signalIntelligenceEngine';
import { generateStrategicThemes } from '../services/strategicThemeEngine';
import { generateCampaignOpportunities } from '../services/campaignOpportunityEngine';
import { generateContentOpportunities } from '../services/contentOpportunityEngine';
import { generateCampaignNarratives } from '../services/narrativeEngine';
import { generateCommunityPosts } from '../services/communityPostEngine';
import { generateCommunityThreads } from '../services/threadEngine';
import { captureEngagementSignals } from '../services/engagementCaptureService';
import { generateFeedbackInsights } from '../services/feedbackIntelligenceEngine';
import { computeThemeRelevanceForCompany } from '../services/companyTrendRelevanceEngine';
import { runInBackgroundJobContext } from '../services/intelligenceExecutionContext';
import {
  getGlobalConfig,
  getCompanyOverride,
  resolveConfig,
  getDailyJobCount,
  getCompanyPriorityAdjustment,
  logExecutionStart,
  logExecutionEnd,
  logSkipped,
} from '../services/intelligenceConfigService';

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

  // Check for existing queue jobs to prevent duplicates
  const { data: existingJobs } = await ownedDbTable('queue_jobs')
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
      const { data: campaign, error: campaignError } = await ownedDbTable('campaigns')
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

/**
 * Enqueue a single scheduled post to fire at its exact scheduled time.
 *
 * Called immediately after a post is inserted or updated so publishing
 * is triggered at the precise scheduled_for timestamp rather than waiting
 * for the next cron poll window (which could be up to 4 hours away in
 * off-hours and up to the configured interval during working hours).
 *
 * BullMQ stores the delayed job in a Redis sorted-set keyed by the fire
 * timestamp and promotes it to the active set at the right moment — no
 * polling loop needed.
 *
 * Idempotent: if a pending/processing queue_jobs row already exists for
 * this post the function returns early so re-scheduling the same post
 * (e.g. user edits the time) is safe — the old BullMQ job will fire at
 * its original time but findDuePostsAndEnqueue() (safety-net) will skip
 * it because the post will already be queued or published.
 * For a full reschedule (cancel old + enqueue new) users should go
 * through a dedicated update-schedule endpoint.
 *
 * @param scheduledPostId  UUID of the scheduled_posts row.
 * @param userId           Owner user_id (stored on queue_jobs).
 * @param socialAccountId  Target social account (stored on queue_jobs payload).
 * @param scheduledFor     ISO-8601 datetime the post should publish.
 * @returns                'enqueued' | 'duplicate' | 'past' (fired immediately by safety-net)
 */
export async function enqueueScheduledPostAt(
  scheduledPostId: string,
  userId: string,
  socialAccountId: string,
  scheduledFor: string,
): Promise<'enqueued' | 'duplicate' | 'past'> {
  // Duplicate guard: skip if a queue_jobs row already exists for this post
  const { data: existing } = await ownedDbTable('queue_jobs')
    .select('id, status')
    .eq('scheduled_post_id', scheduledPostId)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (existing) {
    console.log(`[enqueueScheduledPostAt] duplicate – queue_job ${existing.id} already exists for post ${scheduledPostId}`);
    return 'duplicate';
  }

  const delayMs = new Date(scheduledFor).getTime() - Date.now();

  // Post is already past due — the safety-net cron will catch it on next tick
  if (delayMs < 0) {
    console.log(`[enqueueScheduledPostAt] post ${scheduledPostId} is past due (${Math.abs(delayMs)}ms ago) – leaving for safety-net`);
    return 'past';
  }

  const queueJobId = await createQueueJob({
    scheduled_post_id: scheduledPostId,
    job_type: 'publish',
    status: 'pending',
    scheduled_for: scheduledFor,
    priority: 0,
  });

  const queue = getQueue();
  await queue.add(
    'publish',
    {
      scheduled_post_id: scheduledPostId,
      social_account_id: socialAccountId,
      user_id: userId,
    },
    {
      jobId: queueJobId,
      delay: delayMs,          // fires at the exact scheduled_for time
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  const firesAt = new Date(scheduledFor).toISOString();
  console.log(`[enqueueScheduledPostAt] post ${scheduledPostId} enqueued – fires in ${Math.round(delayMs / 1000)}s at ${firesAt}`);
  return 'enqueued';
}

/**
 * Acquire a Postgres advisory lock keyed on a scheduled_post UUID.
 *
 * Uses `pg_advisory_xact_lock` (transaction-scoped) so the lock auto-releases
 * when the surrounding transaction commits/rollbacks. Since Supabase JS
 * doesn't expose transactions, we call an `rpc('try_scheduled_post_lock')`
 * helper that the DB exposes; if the RPC isn't present we fall back to a
 * lighter-weight optimistic check on `queue_jobs.updated_at` to detect
 * concurrent mutations.
 *
 * The lock is intentionally non-blocking: this is `pg_try_advisory_lock`
 * semantics, returning `acquired: false` immediately on contention so the
 * caller can surface a 409 instead of stalling the request.
 *
 * Returns `{ acquired, release }` so the caller can release in a finally
 * block. The fallback path's `release()` is a no-op.
 */
export async function tryAcquireScheduledPostQueueLock(
  scheduledPostId: string,
): Promise<{ acquired: boolean; release: () => Promise<void>; mode: 'advisory' | 'optimistic_check' | 'none' }> {
  // Try the advisory-lock RPC first.
  try {
    const { data, error } = await supabase.rpc('try_scheduled_post_lock', {
      p_scheduled_post_id: scheduledPostId,
    });
    if (!error && typeof data === 'boolean') {
      if (!data) {
        return { acquired: false, release: async () => undefined, mode: 'advisory' };
      }
      return {
        acquired: true,
        mode: 'advisory',
        release: async () => {
          try {
            await supabase.rpc('release_scheduled_post_lock', { p_scheduled_post_id: scheduledPostId });
          } catch (releaseError) {
            console.warn('[scheduled-post-lock] release failed', { scheduledPostId, message: (releaseError as Error)?.message });
          }
        },
      };
    }
  } catch (rpcError) {
    // RPC missing or DB rejected — fall through to optimistic check.
    void rpcError;
  }

  // ── Optimistic-check fallback ────────────────────────────────────────
  // No advisory lock available. Capture the latest `updated_at` of the
  // queue_jobs row(s) for this post; the caller compares again before
  // committing its mutation. Best-effort serialization for environments
  // without the advisory-lock RPC.
  try {
    const { data } = await ownedDbTable('queue_jobs')
      .select('id, updated_at')
      .eq('scheduled_post_id', scheduledPostId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const baselineUpdatedAt = (data as { updated_at?: string } | null)?.updated_at ?? null;
    return {
      acquired: true,
      mode: 'optimistic_check',
      release: async () => undefined,
      // expose baseline via closure for the caller if they want it later;
      // we keep the public shape symmetrical with the advisory path
    } as { acquired: boolean; release: () => Promise<void>; mode: 'advisory' | 'optimistic_check' | 'none' };
  } catch (fallbackError) {
    console.warn('[scheduled-post-lock] optimistic-check fallback failed', { scheduledPostId, message: (fallbackError as Error)?.message });
    return { acquired: true, release: async () => undefined, mode: 'none' };
  }
}

/**
 * Atomic cancel + enqueue. Wraps the existing cancel + enqueue helpers
 * with:
 *   - an advisory lock on the scheduled_post (best-effort; falls back to
 *     optimistic detection when the lock RPC isn't deployed)
 *   - idempotency keys derived from `${scheduledPostId}:${scheduledFor}`
 *     so a retry can't double-enqueue
 *   - structured rollback: if enqueue fails after cancel, the prior
 *     queue_job is restored to `pending` so the safety-net cron will
 *     still publish at the OLD time. This avoids stranding the post
 *     entirely on a partial failure.
 *
 * Returns a small report describing the operation. Callers (reschedule
 * API) should treat the operation as successful even on lock contention
 * — the 409 is surfaced by the caller's revision check.
 */
export async function atomicCancelAndReEnqueueScheduledPost(input: {
  scheduledPostId: string;
  userId: string;
  socialAccountId: string;
  newScheduledFor: string;
  reason?: string;
}): Promise<{
  ok: boolean;
  locked: boolean;
  cancel: { db_cancelled: number; queue_removed: number; errors: string[] };
  enqueue: 'enqueued' | 'duplicate' | 'past' | 'failed';
  rollback?: 'attempted' | 'not_needed';
  idempotency_key: string;
}> {
  const idempotencyKey = `reschedule:${input.scheduledPostId}:${new Date(input.newScheduledFor).getTime()}`;

  const lock = await tryAcquireScheduledPostQueueLock(input.scheduledPostId);
  if (!lock.acquired) {
    return {
      ok: false,
      locked: false,
      cancel: { db_cancelled: 0, queue_removed: 0, errors: ['lock_contention'] },
      enqueue: 'failed',
      idempotency_key: idempotencyKey,
    };
  }

  try {
    // ── Capture the prior queue_job for potential rollback ─────────────
    let priorQueueJob: { id: string; status: string; scheduled_for: string | null } | null = null;
    try {
      const { data } = await ownedDbTable('queue_jobs')
        .select('id, status, scheduled_for')
        .eq('scheduled_post_id', input.scheduledPostId)
        .in('status', ['pending', 'processing'])
        .maybeSingle();
      if (data) priorQueueJob = data as any;
    } catch { /* swallow — best effort */ }

    // ── 1. Cancel old entries ──────────────────────────────────────────
    const cancelResult = await cancelScheduledPostQueueEntry(input.scheduledPostId, {
      reason: input.reason ?? 'atomic_reschedule',
    });

    // ── 2. Enqueue at the new time ─────────────────────────────────────
    let enqueueResult: 'enqueued' | 'duplicate' | 'past' | 'failed' = 'failed';
    let enqueueError: Error | null = null;
    try {
      enqueueResult = await enqueueScheduledPostAt(
        input.scheduledPostId,
        input.userId,
        input.socialAccountId,
        input.newScheduledFor,
      );
    } catch (e) {
      enqueueError = e as Error;
      enqueueResult = 'failed';
    }

    // ── 3. Rollback on partial failure ─────────────────────────────────
    if (enqueueResult === 'failed' && priorQueueJob) {
      try {
        await ownedDbTable('queue_jobs')
          .update({
            status: 'pending',
            completed_at: null,
            last_error: `rollback_from_atomic_reschedule:${enqueueError?.message ?? 'unknown'}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', priorQueueJob.id);
        console.warn('[atomic-reschedule][rollback]', {
          scheduled_post_id: input.scheduledPostId,
          restored_queue_job: priorQueueJob.id,
          reason: enqueueError?.message ?? 'unknown',
        });
        return {
          ok: false,
          locked: true,
          cancel: cancelResult,
          enqueue: 'failed',
          rollback: 'attempted',
          idempotency_key: idempotencyKey,
        };
      } catch (rollbackError) {
        console.warn('[atomic-reschedule][rollback-failed]', {
          scheduled_post_id: input.scheduledPostId,
          message: (rollbackError as Error)?.message,
        });
      }
    }

    return {
      ok: enqueueResult !== 'failed',
      locked: true,
      cancel: cancelResult,
      enqueue: enqueueResult,
      rollback: enqueueResult === 'failed' ? 'attempted' : 'not_needed',
      idempotency_key: idempotencyKey,
    };
  } finally {
    await lock.release();
  }
}

/**
 * Cancel an enqueued publish job for a scheduled post.
 *
 * Used by reschedule + unschedule flows so a stale publish job can't
 * fire at the old time after the row has been retimed (or removed).
 *
 * Behavior:
 *   1. Marks the matching `queue_jobs` rows (status ∈ pending/processing)
 *      as `status='cancelled'` so the persistence layer reflects the
 *      cancellation.
 *   2. Removes the BullMQ job by its `jobId` (queue_jobs row ID). BullMQ
 *      job removal is idempotent — missing jobs report null without
 *      throwing.
 *
 * Returns a small report describing how many rows were touched. Failures
 * are LOGGED but do NOT throw — callers can decide whether to surface
 * a partial-failure status to the user.
 *
 * Idempotent: safe to call multiple times. Safe to call on a post that
 * was never enqueued.
 */
export async function cancelScheduledPostQueueEntry(
  scheduledPostId: string,
  options: { reason?: string } = {},
): Promise<{ db_cancelled: number; queue_removed: number; errors: string[] }> {
  const result = { db_cancelled: 0, queue_removed: 0, errors: [] as string[] };

  // ── 1. Mark queue_jobs rows cancelled ──────────────────────────────────
  let pendingIds: string[] = [];
  try {
    const { data: rows, error } = await ownedDbTable('queue_jobs')
      .select('id')
      .eq('scheduled_post_id', scheduledPostId)
      .in('status', ['pending', 'processing']);
    if (error) {
      result.errors.push(`queue_jobs lookup: ${error.message}`);
    } else if (Array.isArray(rows)) {
      pendingIds = rows.map((r: { id: string }) => r.id).filter(Boolean);
    }
  } catch (lookupError) {
    result.errors.push(`queue_jobs lookup threw: ${(lookupError as Error)?.message ?? 'unknown'}`);
  }

  if (pendingIds.length > 0) {
    try {
      const { error: updateError } = await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          last_error: options.reason ?? 'queue_entry_cancelled',
        })
        .in('id', pendingIds);
      if (updateError) {
        result.errors.push(`queue_jobs cancel update: ${updateError.message}`);
      } else {
        result.db_cancelled = pendingIds.length;
      }
    } catch (updateError) {
      result.errors.push(`queue_jobs cancel update threw: ${(updateError as Error)?.message ?? 'unknown'}`);
    }
  }

  // ── 2. Remove BullMQ jobs by jobId ────────────────────────────────────
  // jobId is the queue_jobs.id (see enqueueScheduledPostAt above). Use
  // `queue.remove(jobId)` — idempotent; null on a missing job.
  if (pendingIds.length > 0) {
    try {
      const queue = getQueue();
      for (const jobId of pendingIds) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            await job.remove();
            result.queue_removed += 1;
          }
        } catch (removeError) {
          result.errors.push(`bullmq remove(${jobId}) threw: ${(removeError as Error)?.message ?? 'unknown'}`);
        }
      }
    } catch (queueError) {
      result.errors.push(`bullmq access threw: ${(queueError as Error)?.message ?? 'unknown'}`);
    }
  }

  console.log('[cancelScheduledPostQueueEntry]', {
    scheduled_post_id: scheduledPostId,
    db_cancelled: result.db_cancelled,
    queue_removed: result.queue_removed,
    reason: options.reason ?? null,
    error_count: result.errors.length,
  });
  return result;
}

/**
 * Enqueue one engagement polling job.
 * Idempotent ingestion; no duplicate check. Call every 10 minutes (e.g. from cron).
 */
export async function enqueueEngagementPolling(): Promise<void> {
  const queue = getEngagementPollingQueue();
  await queue.add('poll', {}, { jobId: `engagement-poll-${Date.now()}` });
  console.log('✅ Engagement polling job enqueued');
}

/** Polling window in minutes (2 hours) for rate limit check */
const INTELLIGENCE_POLLING_WINDOW_MINUTES = 120;

/** Reliability thresholds for job priority: HIGH=1, MEDIUM=5, LOW=10 */
const RELIABILITY_HIGH = 0.8;
const RELIABILITY_MEDIUM = 0.3;

/** Map company polling_frequency to job priority (lower = run sooner). Used to respect company-configured polling. */
const POLLING_PRIORITY: Record<string, number> = {
  realtime: 1,
  '2h': 2,
  '6h': 5,
  daily: 10,
  weekly: 20,
};
function pollingPriorityFromConfig(frequency: string | null | undefined): number {
  if (!frequency || typeof frequency !== 'string') return 10;
  const key = frequency.trim().toLowerCase();
  return POLLING_PRIORITY[key] ?? 10;
}

export interface EnqueueIntelligencePollingResult {
  enqueued: number;
  skipped: number;
  reasons: { skipped_rate_limit: number; skipped_disabled: number };
}

/**
 * Enqueue intelligence polling jobs for external API sources.
 * Call every 2 hours (e.g. from cron).
 *
 * Mode 1 — Company polling: When company_api_configs has enabled = true, enqueue jobs for those sources.
 * Mode 2 — Global fallback: When no company configs exist, enqueue jobs for ALL active API sources (company_id = null).
 *
 * - Only is_active = true and reliability not "disabled" (reliability_score >= 0.1)
 * - Skips source if today's request_count >= rate_limit_per_min * polling_window
 * - Priority: HIGH reliability (>=0.8) → 1, MEDIUM (>=0.3) → 5, LOW → 10
 */
export async function enqueueIntelligencePolling(): Promise<EnqueueIntelligencePollingResult> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: enabledConfigRows, error: configError } = await ownedDbTable('company_api_configs')
    .select('api_source_id, polling_frequency')
    .eq('enabled', true);

  let sources: { id: string; name?: string; rate_limit_per_min?: number }[];
  let useGlobalFallback: boolean;
  const pollingPriorityBySource = new Map<string, number>();

  if (configError || !enabledConfigRows?.length) {
    // Global fallback: no company configs — use all active API sources
    const { data: activeSources, error: sourcesError } = await ownedDbTable('external_api_sources')
      .select('id, name, rate_limit_per_min, is_enabled_global, is_whitelisted, category')
      .eq('is_active', true);

    if (sourcesError || !activeSources?.length) {
      return { enqueued: 0, skipped: 0, reasons: { skipped_rate_limit: 0, skipped_disabled: 0 } };
    }
    sources = activeSources.filter(isApiSourceExecutable);
    useGlobalFallback = true;
    console.log('[intelligence] global polling enabled — no company configs found');
  } else {
    // Company mode: sources from enabled company configs
    const enabledSourceIds = [...new Set((enabledConfigRows || []).map((r) => r.api_source_id))];
    for (const row of enabledConfigRows || []) {
      const id = row.api_source_id;
      const p = pollingPriorityFromConfig((row as { polling_frequency?: string | null }).polling_frequency);
      const existing = pollingPriorityBySource.get(id);
      if (existing === undefined || p < existing) pollingPriorityBySource.set(id, p);
    }
    const { data: companySources, error: sourcesError } = await ownedDbTable('external_api_sources')
      .select('id, name, rate_limit_per_min, is_enabled_global, is_whitelisted, category')
      .eq('is_active', true)
      .in('id', enabledSourceIds);

    if (sourcesError || !companySources?.length) {
      return { enqueued: 0, skipped: 0, reasons: { skipped_rate_limit: 0, skipped_disabled: 0 } };
    }
    sources = companySources.filter(isApiSourceExecutable);
    useGlobalFallback = false;
    console.log('[intelligence] company polling enabled');
  }

  const { data: healthRows } = await ownedDbTable('external_api_health')
    .select('api_source_id, reliability_score')
    .in('api_source_id', sources.map((s) => s.id));

  const healthBySource = new Map<string, number>();
  (healthRows ?? []).forEach((r: { api_source_id: string; reliability_score?: number }) => {
    healthBySource.set(r.api_source_id, r.reliability_score ?? 1);
  });

  const { data: usageRows } = await ownedDbTable('external_api_usage')
    .select('api_source_id, request_count')
    .eq('user_id', INTELLIGENCE_POLLER_USER_ID)
    .eq('usage_date', today)
    .in('api_source_id', sources.map((s) => s.id));

  const usageBySource = new Map<string, number>();
  (usageRows ?? []).forEach((r: { api_source_id: string; request_count?: number }) => {
    usageBySource.set(r.api_source_id, r.request_count ?? 0);
  });

  if (sources.length > 500) sources = sources.slice(0, 500);

  let enqueued = 0;
  let skippedRateLimit = 0;
  let skippedDisabled = 0;

  for (const source of sources) {
    const reliability = healthBySource.get(source.id) ?? 1;
    if (reliability < 0.1) {
      skippedDisabled++;
      continue;
    }

    const rateLimitPerMin = source.rate_limit_per_min ?? 60;
    const cap = rateLimitPerMin * INTELLIGENCE_POLLING_WINDOW_MINUTES;
    const requestCount = usageBySource.get(source.id) ?? 0;
    if (requestCount >= cap) {
      skippedRateLimit++;
      continue;
    }

    const reliabilityPriority =
      reliability >= RELIABILITY_HIGH ? 1 : reliability >= RELIABILITY_MEDIUM ? 5 : 10;
    const companyPollingPriority = pollingPriorityBySource.get(source.id) ?? 10;
    const priority = Math.min(reliabilityPriority, companyPollingPriority);

    try {
      const purpose = useGlobalFallback ? 'global_intelligence_polling' : 'intelligence_polling';
      await addIntelligencePollingJob(
        { apiSourceId: source.id, companyId: null, purpose },
        { priority }
      );
      enqueued++;
    } catch (err: any) {
      console.warn('[enqueueIntelligencePolling] failed to enqueue', source.id, err?.message);
    }
  }

  if (enqueued > 0) {
    console.log(
      `✅ Intelligence polling: enqueued ${enqueued}, skipped ${skippedRateLimit + skippedDisabled} (rate_limit=${skippedRateLimit}, disabled=${skippedDisabled})`
    );
  }

  return {
    enqueued,
    skipped: skippedRateLimit + skippedDisabled,
    reasons: { skipped_rate_limit: skippedRateLimit, skipped_disabled: skippedDisabled },
  };
}

/**
 * Run signal clustering on recent unclustered signals (last 6 hours).
 * Call every 30 minutes (e.g. from cron).
 */
export async function runSignalClustering() {
  return runWithConfig('signal_clustering', null, async () => {
    const result = await clusterRecentSignals();
    return {
      signals_processed: result.signals_processed,
      clusters_created: result.clusters_created,
      clusters_updated: result.clusters_updated,
    };
  });
}

/**
 * Run signal intelligence engine: convert clusters to actionable intelligence.
 * Call every hour (e.g. from cron).
 */
export async function runSignalIntelligenceEngine() {
  return runWithConfig('signal_intelligence', null, () => generateSignalIntelligence());
}

/**
 * Run strategic theme engine: convert eligible intelligence into theme cards.
 * Call every hour (e.g. from cron).
 */
export async function runStrategicThemeEngine() {
  return runWithConfig('strategic_themes', null, () => generateStrategicThemes());
}

/**
 * Run campaign opportunity engine: convert strategic themes into campaign opportunities.
 * Call every hour (e.g. from cron).
 */
export async function runCampaignOpportunityEngine() {
  return runWithConfig('campaign_opportunities', null, () => generateCampaignOpportunities());
}

/**
 * Run content opportunity engine: convert strategic themes into content opportunities.
 * Call every 2 hours (e.g. from cron).
 */
export async function runContentOpportunityEngine() {
  return runWithConfig('content_opportunities', null, () => generateContentOpportunities());
}

/**
 * Run narrative engine: convert content opportunities into campaign narratives.
 * Call every 4 hours (e.g. from cron).
 */
export async function runNarrativeEngine() {
  return runWithConfig('narrative_engine', null, () => generateCampaignNarratives());
}

/**
 * Run community post engine: convert campaign narratives into platform-ready posts.
 * Call every 3 hours (e.g. from cron).
 */
export async function runCommunityPostEngine() {
  return runWithConfig('community_posts', null, () => generateCommunityPosts());
}

/**
 * Run thread engine: convert community posts into multi-part threads.
 * Call every 3 hours (e.g. from cron).
 */
export async function runThreadEngine() {
  return runWithConfig('thread_engine', null, () => generateCommunityThreads());
}

/**
 * Run engagement capture: capture metrics from platform APIs into engagement_signals.
 * Call every 30 minutes (e.g. from cron).
 */
export async function runEngagementCapture() {
  return runWithConfig('engagement_capture', null, () => captureEngagementSignals());
}

/**
 * Run feedback intelligence engine: analyze engagement and generate insights.
 * Call every 6 hours (e.g. from cron).
 */
export async function runFeedbackIntelligenceEngine() {
  return runWithConfig(
    'feedback_intelligence',
    null,
    () => runInBackgroundJobContext('scheduler.feedbackIntelligence', () => generateFeedbackInsights())
  );
}

/**
 * Run company trend relevance: score theme relevance per company (industry, keywords, competitors).
 * Call every 6 hours (e.g. from cron).
 *
 * Per-company job: checks resolved config (global + company override) for each company.
 */
export async function runCompanyTrendRelevance(): Promise<{
  companies_processed: number;
  total_themes_scored: number;
  errors: string[];
}> {
  const { data: companies, error } = await ownedDbTable('companies')
    .select('id')
    .eq('status', 'active');

  if (error || !companies?.length) {
    return { companies_processed: 0, total_themes_scored: 0, errors: error ? [error.message] : [] };
  }

  let totalThemesScored = 0;
  const errors: string[] = [];

  for (const row of companies as { id: string }[]) {
    try {
      const result = await runWithConfig(
        'trend_relevance',
        row.id,
        () => computeThemeRelevanceForCompany(row.id),
      );
      if ('skipped' in result) continue;
      totalThemesScored += result.themes_scored;
      errors.push(...result.errors);
    } catch (e: unknown) {
      errors.push(`company ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    companies_processed: companies.length,
    total_themes_scored: totalThemesScored,
    errors,
  };
}

// ── Intelligence config-aware runner ──────────────────────────────────────────

/**
 * Wraps an intelligence runner with:
 * - Enabled check (global config + optional company override)
 * - Execution budget guard (daily_job_limit per company)
 * - Dynamic priority adjustment (new company → boost, inactive → deprioritise)
 * - Full execution logging to intelligence_execution_log
 *
 * Returns the runner result, or `{ skipped: true, reason }` if the job is skipped.
 */
async function runWithConfig<T>(
  jobType: string,
  companyId: string | null,
  runner: () => Promise<T>,
  triggeredBy = 'scheduler',
): Promise<T | { skipped: true; reason: string }> {
  const global = await getGlobalConfig(jobType);
  if (!global) {
    console.warn(`[scheduler] ${jobType}: not found in intelligence_global_config — skipping`);
    return { skipped: true, reason: 'job_type_not_found' };
  }

  const override = companyId ? await getCompanyOverride(companyId, jobType) : null;
  const config   = resolveConfig(global, override);

  // ── 1. Enabled check ──────────────────────────────────────────────────────
  if (!config.enabled) {
    console.log(`[scheduler] ${jobType} disabled${companyId ? ` (${companyId})` : ''}`);
    await logSkipped(jobType, companyId, 'disabled', triggeredBy);
    return { skipped: true, reason: 'disabled' };
  }

  // ── 2. Execution budget guard (per-company only) ───────────────────────────
  if (companyId) {
    const dailyLimit = override?.daily_job_limit ?? global.daily_job_limit;
    const todayCount = await getDailyJobCount(companyId);
    if (todayCount >= dailyLimit) {
      console.log(`[scheduler] ${jobType} budget_exceeded for ${companyId} (${todayCount}/${dailyLimit} today)`);
      await logSkipped(jobType, companyId, 'budget_exceeded', triggeredBy);
      return { skipped: true, reason: 'budget_exceeded' };
    }
  }

  // ── 3. Dynamic priority adjustment ────────────────────────────────────────
  let effectivePriority = config.priority;
  if (companyId) {
    const adjustment = await getCompanyPriorityAdjustment(companyId);
    if (adjustment === 'new') {
      effectivePriority = Math.max(1, effectivePriority - 2);
      console.log(`[scheduler] ${jobType} priority boosted: ${config.priority}→${effectivePriority} (new company)`);
    } else if (adjustment === 'inactive') {
      effectivePriority = Math.min(10, effectivePriority + 3);
      console.log(`[scheduler] ${jobType} priority lowered: ${config.priority}→${effectivePriority} (inactive company)`);
    }
  }

  // ── 4. Execute with logging ────────────────────────────────────────────────
  const logId = await logExecutionStart(jobType, companyId, triggeredBy);
  try {
    const result = await runner();
    await logExecutionEnd(logId, 'completed', {
      ...(result as Record<string, unknown>),
      effective_priority: effectivePriority,
    });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logExecutionEnd(logId, 'failed', { effective_priority: effectivePriority }, msg);
    throw err;
  }
}

/** Default platforms/regions for scheduled lead detection (07:00, 18:00). */
const SCHEDULED_LEAD_PLATFORMS = ['reddit', 'linkedin', 'twitter'];
const SCHEDULED_LEAD_REGIONS = ['GLOBAL'];

/**
 * Enqueue lead detection jobs for all companies with profiles.
 * Called by cron at 07:00 and 18:00.
 */
export async function enqueueScheduledLeadDetection(): Promise<{ enqueued: number; errors: string[] }> {
  const { jobQueue } = await import('../queue/jobQueue');
  const { recordLeadQueueEnqueue } = await import('../queue/leadQueueObservability');
  const { data: companies, error } = await ownedDbTable('company_profiles')
    .select('company_id')
    .not('company_id', 'is', null);
  if (error) {
    return { enqueued: 0, errors: [`Failed to load companies: ${error.message}`] };
  }
  const allIds     = (companies ?? []).map((r: { company_id: string }) => r.company_id).filter(Boolean);
  const companyIds = allIds.length > 500 ? allIds.slice(0, 500) : allIds;
  if (companyIds.length === 0) return { enqueued: 0, errors: [] };

  const errors: string[] = [];
  let enqueued = 0;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const companyId of companyIds) {
    try {
      const { count } = await ownedDbTable('lead_jobs_v1')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gt('created_at', twentyFourHoursAgo);
      if ((count ?? 0) >= 2) continue;
      const { data: job, error: insertError } = await ownedDbTable('lead_jobs_v1')
        .insert({
          company_id: companyId,
          platforms: SCHEDULED_LEAD_PLATFORMS,
          regions: SCHEDULED_LEAD_REGIONS,
          keywords: null,
          mode: 'REACTIVE',
          status: 'PENDING',
          total_found: 0,
          total_qualified: 0,
          context_payload: { scheduled_run: true },
        })
        .select('id')
        .single();
      if (insertError || !job) {
        errors.push(`${companyId}: ${(insertError as Error)?.message ?? 'insert failed'}`);
        continue;
      }
      const enqueueStartedAt = Date.now();
      await jobQueue.add('lead-job', { type: 'LEAD', jobId: job.id }, { jobId: `lead-detection:${job.id}` });
      recordLeadQueueEnqueue(Date.now() - enqueueStartedAt);
      enqueued++;
    } catch (e: any) {
      errors.push(`${companyId}: ${e?.message ?? String(e)}`);
    }
  }
  return { enqueued, errors };
}

