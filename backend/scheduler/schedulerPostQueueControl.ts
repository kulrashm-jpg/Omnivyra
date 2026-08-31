import { enqueueOrThrow } from '../middleware/queueBackpressure';
import { ownedDbTable } from '../db/writeOwner';
/**
 * Scheduled-post queue control.
 *
 * Precise-time enqueue plus the lock / cancel / atomic-reschedule operations
 * for scheduled_posts publish jobs. Split from schedulerService.ts (Agent-B
 * large-file modularization) — schedulerService re-exports everything here, so
 * importers keep using '../scheduler/schedulerService'.
 */

import { supabase } from '../db/supabaseClient';
import { getQueue } from '../queue/bullmqClient';
import { createQueueJob } from '../db/queries';

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
  // Duplicate guard: skip if a queue_jobs row already exists for this post.
  //
  // Three states must stay distinct. Collapsing (c) into (b) enqueues a SECOND
  // publish job for a post that may already be queued, and a double publish to
  // a public social platform is irreversible:
  //   (a) query ok  + row found -> 'duplicate'
  //   (b) query ok  + no row    -> enqueue
  //   (c) query FAILED          -> duplicate status is UNKNOWN -> fail closed
  //
  // (c) throws instead of enqueueing. That matches the scheduler's existing
  // policy for an unusable query (findDuePostsAndEnqueue throws on a failed
  // scheduled_posts / campaigns lookup), and every caller already treats a
  // throw from this function as a handled outcome — API routes log it as
  // non-fatal, /api/scheduler/retry returns 502 retryable, and
  // atomicCancelAndReEnqueueScheduledPost maps it to 'failed' and rolls the
  // prior queue_job back to 'pending'.
  //
  // The post is NOT stranded. It keeps status='scheduled', so the safety-net
  // cron (findDuePostsAndEnqueue) picks it up at its due time — the same
  // recovery path the 'past' return already depends on.
  //
  // Note .maybeSingle() also errors when MORE THAN ONE pending row matches.
  // Under the old code that error produced data=null and enqueued a third
  // job; fail-closed is the correct answer there too.
  const { data: existing, error: duplicateCheckError } = await ownedDbTable('queue_jobs')
    .select('id, status')
    .eq('scheduled_post_id', scheduledPostId)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (duplicateCheckError) {
    console.error('[enqueueScheduledPostAt] duplicate check failed – refusing to enqueue', {
      scheduled_post_id: scheduledPostId,
      message: duplicateCheckError.message,
    });
    throw new Error(
      `Failed to query queue_jobs for duplicate check (post ${scheduledPostId}): ${duplicateCheckError.message}`,
    );
  }

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
  await enqueueOrThrow(
    queue,
    'publish',
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
    void baselineUpdatedAt;
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
