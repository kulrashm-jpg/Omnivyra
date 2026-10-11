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
import {
  RETRY_STATE_EXHAUSTED,
  findAwaitingRetryQueueJobs,
  isRetryStateColumnMissing,
} from '../queue/publishRetryState';

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

  // A job waiting in BullMQ backoff is live too: its status is 'failed', but
  // BullMQ will deliver it again and it will claim the post. Same three-state
  // contract as above — unreadable means unknown means fail closed.
  const awaitingRetry = await findAwaitingRetryQueueJobs([scheduledPostId]);
  if (awaitingRetry.ok === false) {
    console.error('[enqueueScheduledPostAt] awaiting-retry check failed – refusing to enqueue', {
      scheduled_post_id: scheduledPostId,
      message: awaitingRetry.message,
    });
    throw new Error(
      `Failed to query queue_jobs for awaiting-retry check (post ${scheduledPostId}): ${awaitingRetry.message}`,
    );
  }
  if (awaitingRetry.rows.length > 0) {
    console.log(
      `[enqueueScheduledPostAt] duplicate – queue_job ${awaitingRetry.rows[0].id} is awaiting a BullMQ retry for post ${scheduledPostId}`,
    );
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
  try {
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
  } catch (enqueueError) {
    // Closure-008 B1 — the row above is live ('pending') but nothing will
    // run it: left in place it blocks this post's re-enqueue and the
    // safety-net cron (both see a live row) until the drift sweep. Retire it,
    // compare-and-set on the state this call created. 'cancelled' is the
    // terminal, non-live state; if the add did reach Redis after all, the
    // worker refuses a cancelled row, and the post — still 'scheduled' — is
    // picked up by the safety-net. A retire that fails is left to the drift
    // sweep; the enqueue error is reported either way.
    try {
      await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          error_message: `enqueue_failed:${(enqueueError as Error)?.message ?? 'unknown'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', queueJobId)
        .eq('status', 'pending');
    } catch (retireError) {
      console.warn('[enqueueScheduledPostAt] could not retire the row of a failed enqueue', {
        queue_job_id: queueJobId,
        message: (retireError as Error)?.message,
      });
    }
    throw enqueueError;
  }

  const firesAt = new Date(scheduledFor).toISOString();
  console.log(`[enqueueScheduledPostAt] post ${scheduledPostId} enqueued – fires in ${Math.round(delayMs / 1000)}s at ${firesAt}`);
  return 'enqueued';
}

/**
 * Try to take the scheduled-post queue lock.
 *
 * NOT A MUTUAL-EXCLUSION GUARANTEE (Closure-008 B3). Read this before relying
 * on it:
 *   - the RPC (migration 20260657) is a SESSION-scoped pg_try_advisory_lock
 *     released by a separate RPC — not `pg_advisory_xact_lock` as this comment
 *     used to say — and migration 20261009000000 records that it was never
 *     applied. As written it also could not work through pooled PostgREST
 *     connections (acquire and release may land on different sessions), and
 *     its two-key call passes BIGINTs to a function whose two-key form takes
 *     int4 (code review; not verified against a live database). Do not
 *     deploy it as written.
 *   - so the fallback runs, and it ALWAYS reports acquired:true (its
 *     queue_jobs read is not compared with anything).
 * Making the fallback fail closed would turn every unschedule and reschedule
 * into a 409 (the RPC is never there). Callers must therefore be correct
 * WITHOUT exclusion — and are: the post-level compare-and-sets (owner, status,
 * error_code, platform_post_id, and updated_at for reschedule), the queue
 * cancel's status compare-and-set, the live-row unique index, the post-level
 * publish claim, and atomicCancelAndReEnqueueScheduledPost's check that a
 * 'duplicate' live job is at the requested time.
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
 * The scheduled_for of the post's live (pending/processing) queue row.
 * scheduledFor is null when there is no live row; ok:false when unreadable.
 */
async function liveQueueJobScheduledFor(
  scheduledPostId: string,
): Promise<{ ok: true; scheduledFor: string | null } | { ok: false; reason: string }> {
  try {
    const { data, error } = await ownedDbTable('queue_jobs')
      .select('id, scheduled_for')
      .eq('scheduled_post_id', scheduledPostId)
      .in('status', ['pending', 'processing'])
      .limit(1);
    if (error) return { ok: false, reason: error.message };
    const row = Array.isArray(data) && data.length > 0 ? (data[0] as { scheduled_for?: string | null }) : null;
    return { ok: true, scheduledFor: row?.scheduled_for ?? null };
  } catch (lookupError) {
    return { ok: false, reason: (lookupError as Error)?.message ?? 'unknown' };
  }
}

/**
 * Whether a queue_jobs.metadata value carries the platform-call marker — the
 * 'platform_call' key queries.markQueueJobPlatformCallStarted writes
 * (PLATFORM_CALL_MARKER_KEY), the same key the cancel's
 * `metadata->platform_call` predicate reads.
 */
function hasPlatformCallMarker(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const marker = (metadata as Record<string, unknown>).platform_call;
  return marker !== null && marker !== undefined;
}

export type QueueJobRollbackOutcome = 'restored' | 'skipped' | 'failed' | 'not_needed';

/** BullMQ states in which a job will still be delivered to the worker. */
const RUNNABLE_BULLMQ_STATES: ReadonlySet<string> = new Set(['delayed', 'waiting', 'prioritized']);

/**
 * Closure-008 B1 — restore the queue_job a reschedule cancelled, only when
 * doing so is TRUE:
 *   - never a row that was 'processing': a worker owned it, and it may already
 *     have started the platform call; re-arming it is not a rollback;
 *   - only when its BullMQ job still exists in a runnable state — a database
 *     row saying 'pending' is not evidence that anything will run it;
 *   - only while the row is still 'cancelled' (compare-and-set + read-back):
 *     a worker that since completed it, or any other newer state, is never
 *     overwritten, and terminal states are never reverted to 'pending'.
 */
async function restoreCancelledQueueJob(
  prior: { id: string; status: string },
  enqueueError: Error | null,
): Promise<{ outcome: QueueJobRollbackOutcome; reason?: string }> {
  if (prior.status === 'processing') {
    return { outcome: 'skipped', reason: 'prior_job_was_processing' };
  }
  try {
    const job = await getQueue().getJob(prior.id);
    if (!job) return { outcome: 'skipped', reason: 'bullmq_job_removed' };
    const state = typeof job.getState === 'function' ? String(await job.getState()) : 'unknown';
    if (!RUNNABLE_BULLMQ_STATES.has(state)) {
      return { outcome: 'skipped', reason: `bullmq_job_not_runnable:${state}` };
    }
  } catch (queueError) {
    return { outcome: 'skipped', reason: `bullmq_unverifiable:${(queueError as Error)?.message ?? 'unknown'}` };
  }
  try {
    // `ownedDbTable` RETURNS `{error}` rather than throwing: the result and
    // the affected rows are both inspected, never assumed.
    const { data: restoredRows, error: rollbackError } = await ownedDbTable('queue_jobs')
      .update({
        // A job captured while awaiting a BullMQ retry goes back to 'failed' —
        // the state its retry_state (left untouched by the cancel) describes.
        status: prior.status === 'failed' ? 'failed' : 'pending',
        error_message: `rollback_from_atomic_reschedule:${enqueueError?.message ?? 'unknown'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prior.id)
      .eq('status', 'cancelled')
      .select('id');
    if (rollbackError) return { outcome: 'failed', reason: `queue_jobs rollback update: ${rollbackError.message}` };
    if (!Array.isArray(restoredRows) || restoredRows.length === 0) {
      return { outcome: 'skipped', reason: 'queue_job_state_changed' };
    }
    console.warn('[atomic-reschedule][rollback]', {
      restored_queue_job: prior.id,
      reason: enqueueError?.message ?? 'unknown',
    });
    return { outcome: 'restored' };
  } catch (rollbackError) {
    return { outcome: 'failed', reason: (rollbackError as Error)?.message ?? 'unknown' };
  }
}

/**
 * Atomic cancel + enqueue. Wraps the existing cancel + enqueue helpers
 * with:
 *   - the scheduled-post queue lock — NOT an exclusion guarantee (see
 *     tryAcquireScheduledPostQueueLock); correctness rests on the
 *     compare-and-sets and on step 2a below
 *   - idempotency keys derived from `${scheduledPostId}:${scheduledFor}`
 *     so a retry can't double-enqueue
 *   - guarded rollback (Closure-008): if enqueue fails after cancel, the
 *     prior queue_job is restored ONLY when its BullMQ job demonstrably still
 *     exists in a runnable state AND the row is still the 'cancelled' row this
 *     cancel left (compare-and-set). The cancel normally REMOVES the BullMQ
 *     job, so the usual outcome is 'skipped': restoring the row then would
 *     create a live 'pending' row with nothing to run it, which blocks
 *     re-enqueue and the safety-net cron until the drift sweep. The post
 *     already carries the new time; the caller records the failure and the
 *     safety-net cron / a repeated reschedule enqueues it.
 *
 * Returns a small report describing the operation; ok:false whenever the
 * post's live queue job is not demonstrably the one requested here.
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
  rollback?: QueueJobRollbackOutcome;
  /** Why a rollback was skipped or failed (absent when restored / not needed). */
  rollback_reason?: string;
  /** Set when enqueue said 'duplicate' but the live job is not at the requested time (ok:false). */
  duplicate_conflict?: string;
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
      // Copied, not referenced: the restore below decides on the state seen
      // HERE (before the cancel), never on whatever the row says afterwards.
      if (data) {
        const row = data as { id: string; status: string; scheduled_for: string | null };
        priorQueueJob = { id: String(row.id), status: String(row.status), scheduled_for: row.scheduled_for ?? null };
      }
    } catch { /* swallow — best effort */ }
    // A job waiting in BullMQ backoff is the live job for the gate below just
    // as a pending one is: if the cancel cannot retire it, it will still fire.
    if (!priorQueueJob) {
      try {
        const awaiting = await findAwaitingRetryQueueJobs([input.scheduledPostId]);
        if (awaiting.ok === true && awaiting.rows.length > 0) {
          priorQueueJob = { id: awaiting.rows[0].id, status: 'failed', scheduled_for: null };
        }
      } catch { /* swallow — best effort, same as the capture above */ }
    }

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

    // ── 2a. A 'duplicate' after OUR cancel is success only if it is OUR time ─
    // Closure-008 B3. The queue lock is not a mutual-exclusion guarantee (its
    // fallback always acquires), so a concurrent reschedule of the same post
    // can insert its live row between our cancel and our insert. The unique
    // index then rejects ours as 'duplicate' — which used to be reported as
    // ok:true while the only live job fires at the OTHER request's time. A
    // duplicate is accepted only when the live row is for exactly the time
    // requested here (an identical concurrent reschedule); otherwise it is a
    // reported failure, and the caller's repeat-reschedule recovery applies.
    if (enqueueResult === 'duplicate') {
      const live = await liveQueueJobScheduledFor(input.scheduledPostId);
      const requestedAt = new Date(input.newScheduledFor).getTime();
      const sameTime = live.ok === true && live.scheduledFor !== null
        && new Date(live.scheduledFor).getTime() === requestedAt;
      if (!sameTime) {
        return {
          ok: false,
          locked: true,
          cancel: cancelResult,
          enqueue: 'duplicate',
          rollback: 'not_needed',
          duplicate_conflict: live.ok === true
            ? (live.scheduledFor === null ? 'no_live_job_at_requested_time' : 'live_job_for_another_time')
            : `live_job_unverifiable:${live.reason}`,
          idempotency_key: idempotencyKey,
        };
      }
    }

    // ── 3. Guarded rollback on partial failure ─────────────────────────
    if (enqueueResult === 'failed' && priorQueueJob) {
      const rollback = await restoreCancelledQueueJob(priorQueueJob, enqueueError);
      return {
        ok: false,
        locked: true,
        cancel: cancelResult,
        enqueue: 'failed',
        rollback: rollback.outcome,
        ...(rollback.reason ? { rollback_reason: rollback.reason } : {}),
        idempotency_key: idempotencyKey,
      };
    }

    return {
      ok: enqueueResult !== 'failed',
      locked: true,
      cancel: cancelResult,
      enqueue: enqueueResult,
      // Nothing was captured to restore (or nothing failed): never report an
      // 'attempted' rollback that did not happen.
      rollback: 'not_needed',
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
 *   1. Marks the matching `queue_jobs` rows as `status='cancelled'`: every
 *      pending row, and every processing row whose platform call has NOT
 *      started (Closure-008 B4). A processing row whose call started stays
 *      with its worker and is listed in `call_started_not_cancelled`.
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
): Promise<{ db_cancelled: number; queue_removed: number; errors: string[]; call_started_not_cancelled?: string[] }> {
  const result: { db_cancelled: number; queue_removed: number; errors: string[]; call_started_not_cancelled?: string[] } =
    { db_cancelled: 0, queue_removed: 0, errors: [] };

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
      //
      // Closure-008 B4 — two compare-and-sets, not one. A 'pending' row is
      // always cancellable. A 'processing' row is cancellable ONLY while its
      // platform-call marker (queue_jobs.metadata.platform_call, written by
      // markQueueJobPlatformCallStarted under status='processing') is absent:
      // once the call has started, marking the row cancelled would make the
      // queue record claim nothing happened while the worker's outcome — a
      // publish, a failure, or an UNCERTAIN result — is still being written.
      // Such a row is left to its worker (and reported below); the race is
      // closed in both orders, because the marker write itself requires
      // status='processing'.
      const cancelPatch = {
        status: 'cancelled',
        error_message: options.reason ?? 'queue_entry_cancelled',
        updated_at: new Date().toISOString(),
      };
      const pendingCancel = await ownedDbTable('queue_jobs')
        .update(cancelPatch)
        .in('id', pendingIds)
        .eq('status', 'pending')
        .select('id');
      const processingCancel = pendingCancel.error
        ? null
        : await ownedDbTable('queue_jobs')
          .update(cancelPatch)
          .in('id', pendingIds)
          .eq('status', 'processing')
          .is('metadata->platform_call', null)
          .select('id');
      const updateError = pendingCancel.error ?? processingCancel?.error ?? null;
      const cancelledRows = [
        ...(Array.isArray(pendingCancel.data) ? pendingCancel.data : []),
        ...(Array.isArray(processingCancel?.data) ? processingCancel!.data : []),
      ];
      cancelledIds = cancelledRows
        .map((r) => String((r as { id: string }).id))
        .filter(Boolean);
      result.db_cancelled = cancelledIds.length;
      if (updateError) {
        result.errors.push(`queue_jobs cancel update: ${updateError.message}`);
      } else {
        // Rows still live after both writes: a processing row whose platform
        // call has started (or one a worker moved meanwhile). Re-read so the
        // report names only rows that are genuinely call-started.
        const leftover = pendingIds.filter((id) => !cancelledIds.includes(id));
        if (leftover.length > 0) {
          const { data: still } = await ownedDbTable('queue_jobs')
            .select('id, status, metadata')
            .in('id', leftover)
            .eq('status', 'processing');
          const callStarted = (Array.isArray(still) ? still : [])
            .filter((r) => hasPlatformCallMarker((r as { metadata?: unknown }).metadata))
            .map((r) => String((r as { id: string }).id));
          if (callStarted.length > 0) result.call_started_not_cancelled = callStarted;
        }
      }
    } catch (updateError) {
      result.errors.push(`queue_jobs cancel update threw: ${(updateError as Error)?.message ?? 'unknown'}`);
    }
  }

  // ── 1b. Retire failed rows that may still be retried ───────────────────
  // A failed delivery leaves status='failed' while BullMQ holds the job in
  // backoff and WILL deliver it again — at which point it claims the post and
  // publishes at the old time. Such a row is live, and is retired here exactly
  // like a pending one.
  //
  // Which failed rows: every one not recorded as 'exhausted'. 'awaiting_retry'
  // is a known pending retry; NULL is UNKNOWN (every row older than migration
  // 20261202000000, or one whose state write did not land) and is never
  // treated as terminal. Before the migration nothing can be shown terminal,
  // so every failed row is retired.
  //
  // error_message is left as written: it is the record of the failure that
  // happened, and retry_state is left as written too (the worker owns it).
  // The status predicate is load-bearing for the same reason as above — a row
  // a re-delivery has claimed back into 'processing' meanwhile is not touched
  // here (it was not in the set this SELECT saw), so its executor is not
  // destroyed.
  let failedIds: string[] = [];
  try {
    const withState = await ownedDbTable('queue_jobs')
      .select('id, retry_state')
      .eq('scheduled_post_id', scheduledPostId)
      .eq('status', 'failed');
    const lookup: {
      data: Array<{ id: string; retry_state?: string | null }> | null;
      error: { message: string } | null;
    } = withState.error && isRetryStateColumnMissing(withState.error)
      ? await ownedDbTable('queue_jobs')
        .select('id')
        .eq('scheduled_post_id', scheduledPostId)
        .eq('status', 'failed')
      : withState;
    if (lookup.error) {
      result.errors.push(`queue_jobs failed-row lookup: ${lookup.error.message}`);
    } else if (Array.isArray(lookup.data)) {
      failedIds = lookup.data
        .filter((r) => (r.retry_state ?? null) !== RETRY_STATE_EXHAUSTED)
        .map((r) => r.id)
        .filter(Boolean);
    }
  } catch (lookupError) {
    result.errors.push(`queue_jobs failed-row lookup threw: ${(lookupError as Error)?.message ?? 'unknown'}`);
  }

  if (failedIds.length > 0) {
    try {
      const { data: cancelledRows, error: updateError } = await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .in('id', failedIds)
        .eq('status', 'failed')
        .select('id');
      if (updateError) {
        result.errors.push(`queue_jobs failed-row cancel update: ${updateError.message}`);
      } else {
        const ids = (Array.isArray(cancelledRows) ? cancelledRows : [])
          .map((r) => String((r as { id: string }).id))
          .filter(Boolean);
        cancelledIds = cancelledIds.concat(ids);
        result.db_cancelled = cancelledIds.length;
      }
    } catch (updateError) {
      result.errors.push(`queue_jobs failed-row cancel update threw: ${(updateError as Error)?.message ?? 'unknown'}`);
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
