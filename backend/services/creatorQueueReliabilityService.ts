/**
 * Creator Queue Reliability Service
 *
 * Enterprise reliability layer on top of the existing schedulerService +
 * BullMQ queue. Adds:
 *
 *   - dead-letter queue (`creator_dead_letter_jobs`)
 *   - poison-job detection (N consecutive failures → DLQ + alert)
 *   - exponential retry backoff w/ jitter
 *   - queue drift detection (BullMQ ↔ DB row divergence)
 *   - duplicate-job reconciliation (collapse multiple pending rows)
 *   - job lineage tracking via `lineage_chain` JSON on `queue_jobs`
 *
 * Does NOT replace `findDuePostsAndEnqueue` or `enqueueScheduledPostAt` —
 * complements them with reliability primitives the scheduler can call
 * before / after each enqueue.
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { getQueue } from '../queue/bullmqClient';
import { logger } from './logger';
import { emitCreatorEvent, CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { recordAuditEntry } from './creatorAuditTrailService';

const POISON_FAILURE_THRESHOLD = 5;

/**
 * `queue_jobs` error columns — DEPLOYED SCHEMA CONTRACT.
 *
 * This file used to write and read a `queue_jobs.last_error` column that does
 * not exist in the deployed database. PostgREST rejects the WHOLE statement
 * when an unknown column appears, so every cancellation/recovery UPDATE here
 * was a silent no-op (status never changed) and the stuck-recovery SELECT
 * returned an error that the code read as "no rows".
 *
 * The real columns are `error_message` (free-text reason) and `error_code`
 * (indexed classification):
 *   - canonical writer: backend/db/queries.ts :: updateQueueJobStatus
 *     (writes `error_message` / `error_code`, never `last_error`)
 *   - column contract:  db-utils/verify-columns.js :: queue_jobs
 *     (lists `error_message` + `error_code`; `last_error` is absent)
 *   - required-column probes: scripts/probe-required-columns.js and
 *     scripts/verify-schema-parity.js both track `error_code`, not `last_error`
 *
 * `error_code` is READ status-blind by
 * pages/api/super-admin/system-health-summary.ts :: aggregateQueueStatus,
 * which buckets `by_error_code` over every row in the window regardless of
 * status. Stamping a code from routine reliability housekeeping would report
 * ordinary duplicate/drift cancellations as publish errors on the super-admin
 * health surface. So this layer writes ONLY `error_message` and deliberately
 * leaves `error_code` untouched: the genuine classification is already written
 * by the failing writer (publishProcessor / updateQueueJobStatus) and is
 * preserved on `creator_dead_letter_jobs.last_error_code`.
 *
 * Nothing here writes `completed_at` / `processed_at`: those are not present
 * on the deployed table either, and adding them would reintroduce exactly the
 * whole-statement rejection this repair removes.
 */
const LIVE_QUEUE_STATUSES = ['pending', 'processing'] as const;

/** Statuses that prove a `queue_jobs` row no longer owns an executor. */
const TERMINAL_QUEUE_STATUSES = new Set(['cancelled', 'completed', 'failed']);

/**
 * Confirm — from the database, not from the caller's optimism — that the given
 * `queue_jobs` rows are no longer live.
 *
 * A row is "provably dead" ONLY when the row is still there AND its status is
 * terminal. That is the read-back proof that the cancel actually affected a
 * row: `ownedDbTable` is a passthrough to `supabase.from()`, PostgREST returns
 * `{ error }` rather than throwing, and a syntactically valid UPDATE that
 * matched zero rows also returns `error === null`. So `error === null` alone
 * proves nothing.
 *
 * Everything else — a lookup ERROR, a still-live status, or a row that is not
 * present at all — is reported as NOT dead. Callers therefore never destroy a
 * BullMQ executor while its DB authority may still be live. This is the guard
 * against the exact failure mode that stranded production rows: cancel-then-
 * remove where the cancel silently failed.
 */
async function confirmQueueJobsAreDead(
  ids: string[],
): Promise<{ dead: string[]; stillLive: string[]; absent: string[]; error: string | null }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { dead: [], stillLive: [], absent: [], error: null };

  const { data, error } = await supabase
    .from('queue_jobs')
    .select('id, status')
    .in('id', unique);

  if (error) return { dead: [], stillLive: [], absent: [], error: error.message };

  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; status: string | null }>;
  const statusById = new Map<string, string>();
  for (const row of rows) statusById.set(row.id, String(row.status ?? ''));

  const dead: string[] = [];
  const stillLive: string[] = [];
  const absent: string[] = [];
  for (const id of unique) {
    if (!statusById.has(id)) {
      // The row is gone. There is no authority to cancel — but equally no
      // read-back proof, so its executor is still NOT ours to destroy.
      absent.push(id);
    } else if (TERMINAL_QUEUE_STATUSES.has(statusById.get(id) as string)) {
      dead.push(id);
    } else {
      // Present and still live: the UPDATE reported no error yet changed
      // nothing. This is the silent-failure case, and it is a FAILURE.
      stillLive.push(id);
    }
  }
  return { dead, stillLive, absent, error: null };
}

/**
 * Read back which of `candidateIds` the database actually cancelled, then —
 * for those and ONLY those — destroy the BullMQ executor.
 *
 * This is the single place that turns an optimistic "I issued an UPDATE" into
 * a fact, and two rules follow from it:
 *
 *   1. Callers must report the size of `persisted`, NEVER the size of the set
 *      they merely attempted. Reporting the attempted count is exactly the
 *      production symptom: this service reported collapsing duplicates for
 *      months while the database recorded zero `cancelled` rows.
 *   2. An executor is destroyed only after its row is read back as terminal,
 *      so a silently zero-row UPDATE can never orphan a live authority.
 *
 * `error` is non-null when persistence could not be VERIFIED. Callers must
 * treat that as failure — not as "nothing persisted".
 */
async function confirmAndUnhook(
  candidateIds: string[],
  context: { surface: string; scheduledPostId?: string | null },
): Promise<{ persisted: string[]; stillLive: string[]; absent: string[]; removed: string[]; error: string | null }> {
  const { dead, stillLive, absent, error } = await confirmQueueJobsAreDead(candidateIds);
  if (error) {
    logger.warn('creatorQueueReliability.cancel_unverifiable', {
      surface: 'creatorQueueReliability',
      reason: context.surface,
      scheduled_post_id: context.scheduledPostId ?? null,
      error,
    });
    return { persisted: [], stillLive: [], absent: [], removed: [], error };
  }

  if (stillLive.length > 0 || absent.length > 0) {
    logger.warn('creatorQueueReliability.cancel_partially_persisted', {
      surface: 'creatorQueueReliability',
      reason: context.surface,
      scheduled_post_id: context.scheduledPostId ?? null,
      attempted: candidateIds.length,
      persisted: dead.length,
      still_live: stillLive.length,
      absent: absent.length,
    });
  }

  const removed: string[] = [];
  const queue = getQueue();
  for (const id of dead) {
    try {
      const job = await queue.getJob(id);
      if (job) {
        await job.remove();
        removed.push(id);
      }
    } catch {
      /* best effort — the DB authority is already dead, so a stale executor
         is drift the sweep will find again on the next tick. */
    }
  }
  return { persisted: dead, stillLive, absent, removed, error: null };
}

const BACKOFF_BASE_MS = 30_000;          // 30s
const BACKOFF_CAP_MS = 30 * 60 * 1000;   // 30 min
const BACKOFF_JITTER_MS = 5_000;

export function computeRetryDelayMs(attempt: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)));
  return exp + Math.floor(Math.random() * BACKOFF_JITTER_MS);
}

/**
 * Record a publish-job failure. If the failure count crosses the poison
 * threshold, the job is routed to the DLQ and an alert event is emitted.
 *
 * Returns `{ routed_to_dlq, retry_in_ms? }`.
 */
export async function recordPublishFailure(input: {
  scheduledPostId: string;
  queueJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  attemptCount?: number | null;
}): Promise<{ routed_to_dlq: boolean; retry_in_ms?: number }> {
  const attempt = Math.max(1, input.attemptCount ?? 1);
  if (attempt >= POISON_FAILURE_THRESHOLD) {
    const routed = await routeToDeadLetterQueue({
      scheduledPostId: input.scheduledPostId,
      queueJobId: input.queueJobId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      failureCount: attempt,
      reason: 'poison_threshold_exceeded',
    });
    // Report what actually happened. Claiming `routed_to_dlq: true` after a
    // failed route would hide a job that is still live in the queue.
    if (routed.ok) return { routed_to_dlq: true };
    return { routed_to_dlq: false, retry_in_ms: computeRetryDelayMs(attempt) };
  }
  const retry_in_ms = computeRetryDelayMs(attempt);
  return { routed_to_dlq: false, retry_in_ms };
}

/**
 * Route a poisoned job into the dead-letter queue and free the active slot.
 *
 * Never throws — but it now REPORTS its outcome instead of silently swallowing
 * it, so callers cannot count a failed route as a successful one.
 */
export async function routeToDeadLetterQueue(input: {
  scheduledPostId: string;
  queueJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failureCount: number;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  try {
    // Upsert into DLQ.
    const { data: existing, error: existingError } = await supabase
      .from('creator_dead_letter_jobs')
      .select('id, failure_count')
      .eq('scheduled_post_id', input.scheduledPostId)
      .maybeSingle();
    if (existingError) {
      throw new Error(`creator_dead_letter_jobs lookup failed: ${existingError.message}`);
    }
    if (existing) {
      const { error: dlqUpdateError } = await ownedDbTable('creator_dead_letter_jobs')
        .update({
          failure_count: input.failureCount,
          last_error_code: input.errorCode,
          last_error_message: input.errorMessage,
          last_failed_at: now,
          status: 'poisoned',
          poisoned_reason: input.reason,
        })
        .eq('id', (existing as any).id);
      if (dlqUpdateError) {
        throw new Error(`creator_dead_letter_jobs update failed: ${dlqUpdateError.message}`);
      }
    } else {
      const { error: dlqInsertError } = await ownedDbTable('creator_dead_letter_jobs').insert({
        scheduled_post_id: input.scheduledPostId,
        queue_job_id: input.queueJobId,
        failure_count: input.failureCount,
        last_error_code: input.errorCode,
        last_error_message: input.errorMessage,
        first_failed_at: now,
        last_failed_at: now,
        status: 'poisoned',
        poisoned_reason: input.reason,
      });
      if (dlqInsertError) {
        throw new Error(`creator_dead_letter_jobs insert failed: ${dlqInsertError.message}`);
      }
    }

    // Cancel the live queue_job row, then — and ONLY then — destroy its
    // BullMQ executor. The previous implementation removed the executor
    // unconditionally, so a failed cancel left a live DB authority with no
    // worker: exactly the shape that stranded rows in production.
    if (input.queueJobId) {
      const { error: cancelError } = await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          error_message: `poisoned:${input.reason}`,
          updated_at: now,
        })
        .eq('id', input.queueJobId);
      if (cancelError) {
        throw new Error(`queue_jobs cancel failed: ${cancelError.message}`);
      }
      const confirmed = await confirmAndUnhook([input.queueJobId], {
        surface: 'dlq_route',
        scheduledPostId: input.scheduledPostId,
      });
      if (confirmed.error) {
        throw new Error(`queue_jobs cancel unverifiable: ${confirmed.error}`);
      }
      if (confirmed.stillLive.length > 0) {
        // The UPDATE returned no error but the row is demonstrably still live.
        // Reporting success here is the exact lie that stranded production rows.
        throw new Error(`queue_jobs cancel did not persist for ${input.queueJobId}`);
      }
      // `absent` is not a failure: there is no authority left to cancel. The
      // DLQ record — the durable outcome — was written either way.
    }

    emitCreatorEvent({
      event: CREATOR_EVENTS.QUEUE_JOB_POISONED,
      severity: 'critical',
      scheduledPostId: input.scheduledPostId,
      queueJobId: input.queueJobId,
      retryCount: input.failureCount,
      metadata: { reason: input.reason, error_code: input.errorCode, error_message: input.errorMessage },
    });
    recordAuditEntry({
      action: 'queue_dlq_routed',
      actorKind: 'worker',
      source: 'worker',
      scheduledPostId: input.scheduledPostId,
      metadata: { queue_job_id: input.queueJobId, reason: input.reason, failure_count: input.failureCount },
    });
    return { ok: true };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    logger.warn('creatorQueueReliability.dlq_route_failed', {
      surface: 'creatorQueueReliability',
      scheduled_post_id: input.scheduledPostId,
      error: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Reconcile duplicate LIVE queue_jobs rows for the same scheduled_post.
 * Keeps the newest live row and cancels the older live ones.
 *
 * Returns the count of rows collapsed.
 *
 * FAILS CLOSED: a database lookup or update failure THROWS. It must never be
 * indistinguishable from "there was nothing to reconcile" — that conflation is
 * what let duplicate live rows accumulate unnoticed. Callers (currently the
 * cron lease wrapper's error path) record the failure and retry next tick.
 *
 * Terminal historical rows (completed / failed / cancelled) are never
 * candidates and are never touched: they are excluded by the SELECT, re-checked
 * in memory, and the UPDATE itself is status-guarded so a row that races to a
 * terminal state between SELECT and UPDATE is left alone.
 */
export async function reconcileDuplicateQueueJobs(scheduledPostId: string): Promise<number> {
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('id, status, updated_at, created_at')
    .eq('scheduled_post_id', scheduledPostId)
    .in('status', LIVE_QUEUE_STATUSES as unknown as string[])
    .order('updated_at', { ascending: false });

  if (error) {
    logger.warn('creatorQueueReliability.reconcile_lookup_failed', {
      surface: 'creatorQueueReliability',
      scheduled_post_id: scheduledPostId,
      error: error.message,
    });
    throw new Error(`queue_jobs duplicate lookup failed: ${error.message}`);
  }

  const raw = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    status: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  }>;

  // Defence in depth: only live rows are ever candidates, whatever came back.
  const live = raw.filter(
    (r) => r?.id && (LIVE_QUEUE_STATUSES as unknown as string[]).includes(String(r.status ?? '')),
  );
  if (live.length <= 1) return 0;

  // Newest wins. `updated_at` desc (matching the DB order), with deterministic
  // tie-breaks so two rows stamped in the same millisecond still converge to a
  // single, stable winner across repeated runs.
  const sorted = [...live].sort((a, b) => {
    const byUpdated = String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    if (byUpdated !== 0) return byUpdated;
    const byCreated = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    if (byCreated !== 0) return byCreated;
    return String(b.id).localeCompare(String(a.id));
  });

  const keep = sorted[0];
  // The winner is explicitly excluded — it can never appear in the cancel set.
  const toCancel = sorted.slice(1).map((r) => r.id).filter((id) => id !== keep.id);
  if (toCancel.length === 0) return 0;

  const { error: cancelError } = await ownedDbTable('queue_jobs')
    .update({
      status: 'cancelled',
      error_message: 'duplicate_job_reconciliation',
      updated_at: new Date().toISOString(),
    })
    .in('id', toCancel)
    .in('status', LIVE_QUEUE_STATUSES as unknown as string[]);

  if (cancelError) {
    logger.warn('creatorQueueReliability.reconcile_cancel_failed', {
      surface: 'creatorQueueReliability',
      scheduled_post_id: scheduledPostId,
      error: cancelError.message,
    });
    // No executor is touched: the DB authority may still be live.
    throw new Error(`queue_jobs duplicate cancel failed: ${cancelError.message}`);
  }

  // Read back what actually persisted, and destroy executors only for those.
  const { persisted, removed, error: confirmError } = await confirmAndUnhook(toCancel, {
    surface: 'duplicate_reconciliation',
    scheduledPostId,
  });
  if (confirmError) {
    // Cannot prove the cancel landed → must not report a collapse.
    throw new Error(`queue_jobs duplicate cancel unverifiable: ${confirmError}`);
  }

  if (persisted.length > 0) {
    emitCreatorEvent({
      event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
      severity: 'warning',
      scheduledPostId,
      metadata: {
        kept: keep.id,
        attempted: toCancel,
        cancelled: persisted,
        executors_removed: removed,
        kind: 'duplicate_pending_rows',
      },
    });
  }

  // The count reported is what the DATABASE did, not what we asked for.
  return persisted.length;
}

/**
 * Queue drift sweep — scans DB rows in `pending`/`processing` and checks
 * whether the BullMQ side has the matching job. Returns counts of drift
 * findings. Self-heals by cancelling DB rows whose BullMQ peers are gone.
 *
 * Bounded by `maxScan` — safe for cron.
 */
export async function sweepQueueDrift(options: { maxScan?: number } = {}): Promise<{
  scanned: number;
  drift_found: number;
  drift_cancelled: number;
  peer_unknown: number;
  duration_ms: number;
}> {
  const startedAt = Date.now();
  const maxScan = Math.max(1, Math.min(options.maxScan ?? 1000, 5000));
  let drift_found = 0;
  let drift_cancelled = 0;
  let peer_unknown = 0;

  try {
    const { data, error } = await supabase
      .from('queue_jobs')
      .select('id, scheduled_post_id, status, updated_at')
      .in('status', LIVE_QUEUE_STATUSES as unknown as string[])
      .order('updated_at', { ascending: true })
      .limit(maxScan);
    if (error) {
      // Fail closed: an unreadable queue is not an empty queue.
      throw new Error(`queue_jobs drift lookup failed: ${error.message}`);
    }
    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; scheduled_post_id: string }>;

    const queue = getQueue();
    const toCancel: string[] = [];
    for (const row of rows) {
      // TRI-STATE, and it matters. `getJob` returning null is a DEFINITIVE
      // "BullMQ has no such job" — that is drift. A THROW is UNKNOWN: Redis
      // was unreachable or errored, which says nothing about the job. The
      // previous code collapsed throw into "missing", so a single transient
      // Redis blip would mass-cancel up to `maxScan` live rows the moment
      // these writes started landing.
      //
      // Refusing to act on unknown queue state mirrors
      // backend/scheduler/schedulerService.ts::findDuePostsAndEnqueue, which
      // aborts its cycle rather than guess — the only behaviour here that
      // cannot destroy live work.
      let peer: unknown;
      try {
        peer = await queue.getJob(row.id);
      } catch (probeError) {
        peer_unknown++;
        logger.warn('creatorQueueReliability.drift_probe_unknown', {
          surface: 'creatorQueueReliability',
          queue_job_id: row.id,
          error: (probeError as Error)?.message ?? String(probeError),
        });
        continue; // UNKNOWN → never a cancellation candidate.
      }
      if (!peer) {
        drift_found++;
        toCancel.push(row.id);
      }
    }

    if (toCancel.length > 0) {
      const { error: cancelError } = await ownedDbTable('queue_jobs')
        .update({
          status: 'cancelled',
          error_message: 'drift_self_heal',
          updated_at: new Date().toISOString(),
        })
        .in('id', toCancel)
        .in('status', LIVE_QUEUE_STATUSES as unknown as string[]);
      if (cancelError) {
        // Do not report drift as healed when the heal did not persist.
        throw new Error(`queue_jobs drift cancel failed: ${cancelError.message}`);
      }
      // Report the cancellations the DATABASE made, not the ones we asked for.
      const { persisted, error: confirmError } = await confirmAndUnhook(toCancel, {
        surface: 'drift_self_heal',
      });
      if (confirmError) {
        throw new Error(`queue_jobs drift cancel unverifiable: ${confirmError}`);
      }
      drift_cancelled = persisted.length;
      if (drift_cancelled > 0) {
        emitCreatorEvent({
          event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
          severity: 'warning',
          metadata: {
            drift_count: drift_cancelled,
            attempted: toCancel.length,
            peer_unknown,
            kind: 'bullmq_missing',
          },
        });
      }
    }

    return {
      scanned: rows.length,
      drift_found,
      drift_cancelled,
      peer_unknown,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    logger.warn('creatorQueueReliability.drift_sweep_failed', {
      surface: 'creatorQueueReliability',
      error: (err as Error)?.message ?? String(err),
    });
    // Fail closed. Returning all-zero counts here previously made a broken
    // sweep indistinguishable from a clean one; the cron lease wrapper
    // records the throw as `cron_job_failed` instead.
    throw err;
  }
}

/**
 * Stuck-job recovery — releases the abandoned `processing` claims left behind
 * by workers that died mid-publish, so the scheduler can enqueue a fresh
 * attempt for the post.
 *
 * DISPOSITION: an abandoned claim is CANCELLED, not re-queued.
 *
 * The previous implementation wrote `status: 'pending'` with the comment
 * "safety-net will pick up". Nothing picks it up. `queue_jobs.status` has no
 * consumer: `backend/scheduler/schedulerService.ts::findDuePostsAndEnqueue`
 * selects due work from `scheduled_posts` and reads live `queue_jobs` rows
 * (`pending`/`processing`) purely as a SUPPRESSION set. So a row parked at
 * `pending` was never executed AND permanently blocked any replacement job
 * for that post.
 *
 * Worse, it destroyed a safety guard: `publishProcessor.ts` suppresses a
 * BullMQ stalled re-delivery by checking `queue_jobs.status === 'processing'`
 * inside a 5-minute window. Rewriting that row to `pending` removes the
 * suppression and lets a re-delivered job publish a duplicate.
 *
 * Cancelling instead is correct on both counts: it is terminal (so the
 * suppression set releases and `findDuePostsAndEnqueue` re-enqueues the post,
 * which is still `scheduled`, with a brand-new row and a brand-new BullMQ
 * job), and the abandoned executor is unhooked only after the DB cancel is
 * read back — so nothing can replay the old job.
 *
 * `attempts` is still incremented so the poison threshold keeps advancing;
 * `max_attempts` and `next_retry_at` are never written, leaving the existing
 * retry semantics exactly as the scheduler set them.
 */
export async function recoverStuckProcessingJobs(options: { staleMinutes?: number; dryRun?: boolean } = {}): Promise<{
  scanned: number;
  recovered: number;
  routed_to_dlq: number;
  skipped_live: number;
  errors: string[];
}> {
  const stale = Math.max(1, options.staleMinutes ?? 15);
  const threshold = new Date(Date.now() - stale * 60 * 1000).toISOString();

  let scanned = 0;
  let recovered = 0;
  let routed_to_dlq = 0;
  let skipped_live = 0;
  const errors: string[] = [];

  // Candidate set: `processing` rows whose last touch predates the staleness
  // threshold. Fresh `processing` rows are still owned by a live worker and
  // are excluded by the `.lt('updated_at', …)` bound — never recovered.
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('id, scheduled_post_id, attempts, error_message, updated_at, status')
    .eq('status', 'processing')
    .lt('updated_at', threshold)
    .order('updated_at', { ascending: true })
    .limit(500);

  if (error) {
    logger.warn('creatorQueueReliability.stuck_recovery_lookup_failed', {
      surface: 'creatorQueueReliability',
      error: error.message,
    });
    // FAILS CLOSED: an unreadable table must never be reported as "nothing
    // stuck". That conflation is why stranded rows survived 100+ days.
    throw new Error(`queue_jobs stuck lookup failed: ${error.message}`);
  }

  const rows = (Array.isArray(data) ? data : []) as Array<{
    id: string;
    scheduled_post_id: string;
    attempts: number | null;
    error_message: string | null;
    status?: string | null;
  }>;
  scanned = rows.length;

  // A stale `queue_jobs.processing` row is NOT by itself proof that the work
  // is dead. The owning `scheduled_posts` row carries the real claim: while it
  // is `publishing`, a publisher (thread orchestrator CAS, publish-now) holds
  // it. At 15 minutes a live long publish and a dead worker look identical
  // from `queue_jobs` alone — so read the post before touching anything.
  //
  // A LOOKUP ERROR fails closed (we cannot prove the claim is dead). A
  // successful lookup that returns no row is positive proof of an orphan and
  // is safe to release.
  const postIds = Array.from(new Set(rows.map((r) => r.scheduled_post_id).filter(Boolean)));
  const postById = new Map<string, { status: string; updated_at: string | null }>();
  if (postIds.length > 0) {
    const { data: posts, error: postsError } = await supabase
      .from('scheduled_posts')
      .select('id, status, updated_at')
      .in('id', postIds);
    if (postsError) {
      logger.warn('creatorQueueReliability.stuck_recovery_post_lookup_failed', {
        surface: 'creatorQueueReliability',
        error: postsError.message,
      });
      throw new Error(`scheduled_posts liveness lookup failed: ${postsError.message}`);
    }
    for (const post of (Array.isArray(posts) ? posts : []) as Array<Record<string, any>>) {
      if (post?.id) {
        postById.set(String(post.id), {
          status: String(post.status ?? ''),
          updated_at: post.updated_at ?? null,
        });
      }
    }
  }

  for (const row of rows) {
    // Live-claim guard: a post still `publishing` whose own claim is younger
    // than the staleness threshold is WORKING, not stuck. Leave it alone.
    const post = postById.get(row.scheduled_post_id);
    if (post && post.status === 'publishing') {
      const claimIsFresh = !post.updated_at || String(post.updated_at) >= threshold;
      if (claimIsFresh) {
        skipped_live++;
        continue;
      }
    }

    if (options.dryRun) continue;
    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= POISON_FAILURE_THRESHOLD) {
      const routed = await routeToDeadLetterQueue({
        scheduledPostId: row.scheduled_post_id,
        queueJobId: row.id,
        errorCode: 'STUCK_PROCESSING',
        errorMessage: row.error_message,
        failureCount: attempts,
        reason: 'stuck_processing_recovery',
      });
      if (routed.ok) routed_to_dlq++;
      else errors.push(`dlq ${row.id}: ${routed.error ?? 'unknown'}`);
      continue;
    }

    // Release the abandoned claim TERMINALLY (see the disposition note above:
    // `pending` has no consumer and would break publishProcessor's replay
    // suppression). The UPDATE is guarded on `status = 'processing'` so a row
    // a live worker has since finished is never clobbered — which is also
    // what makes a repeated recovery pass a no-op.
    //
    // `next_retry_at` / `max_attempts` are deliberately NOT written: the
    // existing retry semantics stay exactly as the scheduler set them.
    const { error: releaseError } = await ownedDbTable('queue_jobs')
      .update({
        status: 'cancelled',
        attempts,
        error_message: 'stuck_processing_recovered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing');

    if (releaseError) {
      // Not recovered. Never counted as recovered, and no executor touched.
      errors.push(`release ${row.id}: ${releaseError.message}`);
      logger.warn('creatorQueueReliability.stuck_recovery_release_failed', {
        surface: 'creatorQueueReliability',
        queue_job_id: row.id,
        error: releaseError.message,
      });
      continue;
    }

    // Read the release back before counting it or unhooking anything. A
    // zero-row UPDATE also returns `error === null`, so `error === null` alone
    // proves nothing — and an unproven release must never be reported.
    const { persisted, stillLive, error: confirmError } = await confirmAndUnhook([row.id], {
      surface: 'stuck_processing_recovery',
      scheduledPostId: row.scheduled_post_id,
    });
    if (confirmError) {
      errors.push(`release ${row.id}: unverifiable — ${confirmError}`);
      continue;
    }
    if (persisted.length === 0) {
      // Still live → a silent zero-row UPDATE, which is a failure. Absent →
      // the row vanished; nothing to release and nothing to report as done.
      if (stillLive.length > 0) {
        errors.push(`release ${row.id}: update reported success but did not persist`);
        logger.warn('creatorQueueReliability.stuck_recovery_release_not_persisted', {
          surface: 'creatorQueueReliability',
          queue_job_id: row.id,
        });
      }
      continue;
    }

    recovered++;
    emitCreatorEvent({
      event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
      severity: 'warning',
      scheduledPostId: row.scheduled_post_id,
      queueJobId: row.id,
      retryCount: attempts,
      metadata: { kind: 'stuck_processing_claim_released' },
    });
  }

  return { scanned, recovered, routed_to_dlq, skipped_live, errors };
}

/**
 * List active DLQ entries — used by the admin dashboard.
 */
export async function listDeadLetterJobs(options: { limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  try {
    // A failed query must not render as an empty dead-letter queue. This is the
    // one function in this file a human actually looks at (the super-admin
    // creator-operations page), so "nothing found" and "we could not look" have
    // to stay distinguishable — reporting an empty DLQ during an outage is how
    // an operator concludes there is nothing wrong.
    const { data, error } = await supabase
      .from('creator_dead_letter_jobs')
      .select('*')
      .eq('status', 'poisoned')
      .order('last_failed_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw new Error(`creator_dead_letter_jobs list failed: ${error.message}`);
    }
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Manual recovery API — admin marks a DLQ entry as recovered + reschedules. */
export async function markDeadLetterRecovered(id: string, actorUserId: string): Promise<void> {
  try {
    // Checked for the same reason every other write in this file is: this is a
    // passthrough to supabase.from(), which RETURNS `{error}` rather than
    // throwing, so the enclosing try/catch cannot see a PostgREST failure. Left
    // unchecked, an admin marking an entry recovered got a silent no-op AND an
    // audit entry recording the recovery as successful.
    const { error: recoverError } = await ownedDbTable('creator_dead_letter_jobs')
      .update({ status: 'recovered', metadata: { recovered_by: actorUserId, recovered_at: new Date().toISOString() } })
      .eq('id', id);
    if (recoverError) {
      throw new Error(`creator_dead_letter_jobs recovery failed: ${recoverError.message}`);
    }
    recordAuditEntry({
      action: 'queue_dlq_routed',
      actorUserId,
      actorKind: 'admin',
      source: 'admin',
      metadata: { dlq_id: id, transition: 'poisoned->recovered' },
    });
  } catch (err) {
    logger.warn('creatorQueueReliability.dlq_recovery_failed', {
      surface: 'creatorQueueReliability',
      dlq_id: id,
      error: (err as Error)?.message ?? String(err),
    });
  }
}
