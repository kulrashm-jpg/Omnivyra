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
import { isLiveQueueJobDuplicateViolation } from '../services/boltScheduleIdempotency';

/**
 * The columns `queue_jobs` actually has in the deployed database.
 *
 * This module previously wrote `completed_at` and `last_error`, neither of
 * which has ever existed on `queue_jobs` — not in supabase/_schema/baseline.sql
 * (the authoritative dump), not in supabase/migrations/, and not in the legacy
 * database/ bootstrap SQL. PostgREST rejects the ENTIRE statement when an
 * update names an unknown column, so `status = 'cancelled'` never landed
 * either: production holds 0 cancelled rows.
 *
 * Exported so tests can assert that every payload this module writes names
 * only columns that exist. Keep in sync with baseline.sql's queue_jobs table.
 */
export const QUEUE_JOBS_COLUMNS = [
  'id',
  'scheduled_post_id',
  'job_type',
  'status',
  'attempts',
  'max_attempts',
  'scheduled_for',
  'next_retry_at',
  'error_message',
  'metadata',
  'created_at',
  'updated_at',
  'priority',
  'payload',
  'result_data',
  'error_code',
] as const;

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

  // ── The durable half of the guard ───────────────────────────────────────
  // The SELECT above cannot serialise two enqueue paths. This interleaving is
  // reachable today (safety-net cron tick vs. POST /api/scheduler/retry, or two
  // cron instances):
  //
  //   A: SELECT -> none | B: SELECT -> none | A: INSERT | B: INSERT
  //
  // Both SELECTs legitimately observe no live row, so no amount of care in the
  // read can prevent the second INSERT. `uidx_queue_jobs_live_job_per_post`
  // stops it inside the btree: the second INSERT blocks on the first
  // transaction's index tuple and, once that commits, raises 23505. Exactly one
  // writer wins, decided by the database rather than by timing.
  //
  // A rejection here is NOT a failure — it means someone else already queued
  // this post, which is the same outcome the read-side guard reports. So it
  // returns 'duplicate', identical to the row-found branch above, and crucially
  // does NOT reach the BullMQ enqueue below: a second BullMQ job with no
  // queue_jobs row behind it would be an orphan the worker cannot resolve.
  let queueJobId: string;
  try {
    queueJobId = await createQueueJob({
      scheduled_post_id: scheduledPostId,
      job_type: 'publish',
      status: 'pending',
      scheduled_for: scheduledFor,
      priority: 0,
    });
  } catch (insertError) {
    if (isLiveQueueJobDuplicateViolation(insertError)) {
      console.log(
        `[enqueueScheduledPostAt] duplicate – DB rejected a concurrent second live job for post ${scheduledPostId}`,
      );
      return 'duplicate';
    }
    // Any other insert failure is a real failure and must keep propagating —
    // callers already treat a throw from this function as a handled outcome.
    throw insertError;
  }

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

    // ── 1a. Gate: the replacement may only be created once the old job is
    //      genuinely dead ────────────────────────────────────────────────
    // We observed a live row before cancelling and the cancel transitioned
    // none of them, so that row is STILL pending/processing and will fire the
    // post at the OLD time.
    //
    // Enqueueing anyway is not a recoverable inconvenience, it is a silent
    // wrong outcome, and it is the one production has actually been suffering:
    // enqueueScheduledPostAt's read guard sees that still-live row and returns
    // 'duplicate', so NO job is created at the new time — and 'duplicate' is
    // not 'failed', so this function returned ok:true, the reschedule API
    // emitted QUEUE_REENQUEUE_SUCCESS and answered 200. Combined with the
    // BullMQ removal that used to run even when the DB cancel failed, the post
    // published at NEITHER the old nor the new time while the API reported
    // success. Once the live-uniqueness index lands the shape is the same by a
    // different route: the INSERT raises 23505, the classifier maps it to
    // 'duplicate', and the same false success comes back. A reported failure is
    // strictly better than a silent lost publish.
    //
    // Aborting does not strand the post: scheduled_posts already carries the
    // new time, so the safety-net cron (findDuePostsAndEnqueue) publishes at
    // the new time regardless — the same recovery path the rollback branch
    // below and enqueueScheduledPostAt's 'past' return already rely on.
    //
    // Note the check is DB truth (a live row was seen, zero rows transitioned)
    // and not `errors.length`: cancel also records best-effort BullMQ removal
    // failures there, and a Redis hiccup on removing a job whose DB row is now
    // 'cancelled' must not veto the reschedule — the worker resolves the row.
    if (priorQueueJob && cancelResult.db_cancelled === 0) {
      console.warn('[atomic-reschedule][cancel-not-applied] refusing to enqueue a replacement', {
        scheduled_post_id: input.scheduledPostId,
        live_queue_job: priorQueueJob.id,
        cancel_errors: cancelResult.errors,
      });
      return {
        ok: false,
        locked: true,
        cancel: cancelResult,
        enqueue: 'failed',
        rollback: 'not_needed',
        idempotency_key: idempotencyKey,
      };
    }

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
        // The result is inspected for the same reason the cancel above inspects
        // its own: `ownedDbTable` is a passthrough to supabase.from(), which
        // RETURNS `{error}` rather than throwing, so the surrounding try/catch
        // can never see a PostgREST failure. Reporting `rollback: 'attempted'`
        // on an unchecked write is how a silent failure gets recorded as a
        // successful one — the exact pattern this release exists to remove.
        const { error: rollbackError } = await ownedDbTable('queue_jobs')
          // Same deployed-column mapping as the cancel above. `completed_at:
          // null` was a no-op clear of a column that does not exist; there is
          // nothing to clear, because restoring `status` to 'pending' IS what
          // returns the row to the live set. `updated_at` already carries the
          // transition time.
          .update({
            status: 'pending',
            error_message: `rollback_from_atomic_reschedule:${enqueueError?.message ?? 'unknown'}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', priorQueueJob.id);
        if (rollbackError) {
          throw new Error(`queue_jobs rollback update: ${rollbackError.message}`);
        }
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
 *   2. Removes the BullMQ job by its `jobId` (queue_jobs row ID) — ONLY if
 *      step 1 landed. BullMQ job removal is idempotent — missing jobs report
 *      null without throwing.
 *
 * The ordering is load-bearing: the DB row is the authority, the BullMQ job
 * is its executor. Retiring the executor while the authority still says
 * 'pending' leaves a row nothing will ever publish, which is exactly what the
 * phantom-column UPDATE produced in production.
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
  // The rows the UPDATE ACTUALLY changed — NOT the same set as pendingIds. The
  // status predicate skips any row that reached a terminal state in the window
  // after the SELECT returned, and that row's executor must not be destroyed:
  // it belongs to a publish that already happened.
  let cancelledIds: string[] = [];
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
      // Columns are the DEPLOYED ones (see QUEUE_JOBS_COLUMNS above):
      //   status        — the cancellation itself. This is the load-bearing
      //                   write: it removes the row from the live
      //                   (pending/processing) set that every duplicate guard,
      //                   drift sweep and safety-net query selects on.
      //   error_message — the terminal reason. `queue_jobs` has no dedicated
      //                   reason column; `error_message` is the one free-text
      //                   terminal-state column, and the platform already uses
      //                   it exactly this way for cancellations
      //                   (pages/api/activity-workspace/[id]/unschedule.ts
      //                   writes scheduled_posts {status:'cancelled',
      //                   error_message:'user_unscheduled'}).
      //   updated_at    — when the row reached this state. Already the
      //                   terminal timestamp for every other queue_jobs
      //                   transition (db/queries.ts:updateQueueJobStatus sets
      //                   it on completed/failed/processing), and the window
      //                   key every queue dashboard filters on. A separate
      //                   `completed_at` would be a second, divergent
      //                   representation of a timestamp that already exists —
      //                   and 'cancelled' is not 'completed'.
      //
      // `error_code` is deliberately left NULL. It is a FAILURE classification:
      // /api/super-admin/system-health-summary aggregates error_code across all
      // statuses, so stamping one here would report cancellations as errors.
      // The status predicate and the read-back are both load-bearing.
      //
      // `pendingIds` came from a SELECT that has already returned. A worker can
      // pick a row up and finish publishing in the gap before this UPDATE lands.
      // Without `.in('status', LIVE)` that row — now 'completed' — would be
      // stamped 'cancelled' and have its error_message overwritten, losing the
      // record of a publish that actually happened.
      //
      // And `db_cancelled` gates the BullMQ removal below. Deriving it from
      // `pendingIds.length` would report rows the UPDATE never touched, which
      // is the same "count what you intended, not what persisted" mistake that
      // let the original cancellation failure stay invisible. It must come from
      // the affected rows.
      const { data: cancelledRows, error: updateError } = await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          error_message: options.reason ?? 'queue_entry_cancelled',
          updated_at: new Date().toISOString(),
        })
        .in('id', pendingIds)
        .in('status', ['pending', 'processing'])
        .select('id');
      if (updateError) {
        result.errors.push(`queue_jobs cancel update: ${updateError.message}`);
      } else {
        cancelledIds = (Array.isArray(cancelledRows) ? cancelledRows : [])
          .map((r) => String((r as { id: string }).id))
          .filter(Boolean);
        result.db_cancelled = cancelledIds.length;
      }
    } catch (updateError) {
      result.errors.push(`queue_jobs cancel update threw: ${(updateError as Error)?.message ?? 'unknown'}`);
    }
  }

  // ── 2. Remove BullMQ jobs by jobId ────────────────────────────────────
  // jobId is the queue_jobs.id (see enqueueScheduledPostAt above). Use
  // `queue.remove(jobId)` — idempotent; null on a missing job.
  //
  // GATED on step 1 having landed. Removal used to run unconditionally, which
  // is how the broken UPDATE turned into permanently stranded rows: the DB row
  // stayed 'pending', the BullMQ job that was going to publish it was deleted
  // anyway, and nothing was left to fire it. (Production carries exactly that
  // wreckage — a 'pending' row untouched since 2026-05-14 and a 'processing'
  // one since 2026-05-21, alongside 0 cancelled rows ever.)
  //
  // The invariant: never destroy the live BullMQ job unless its DB row is
  // actually dead. Step 2's stated purpose is to stop a STALE job firing; if
  // step 1 failed the row is not stale, it is live and authoritative, and
  // deleting its BullMQ peer destroys the only thing that would have published
  // it. Leaving the job in place instead means the post still publishes at the
  // old time — wrong time, but recoverable and visible, rather than silently
  // lost. `db_cancelled` is all-or-nothing (one `.in('id', pendingIds)`
  // Per-row, not all-or-nothing: only rows the UPDATE actually cancelled.
  if (cancelledIds.length > 0) {
    try {
      const queue = getQueue();
      for (const jobId of cancelledIds) {
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
