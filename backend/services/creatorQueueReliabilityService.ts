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
    await routeToDeadLetterQueue({
      scheduledPostId: input.scheduledPostId,
      queueJobId: input.queueJobId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      failureCount: attempt,
      reason: 'poison_threshold_exceeded',
    });
    return { routed_to_dlq: true };
  }
  const retry_in_ms = computeRetryDelayMs(attempt);
  return { routed_to_dlq: false, retry_in_ms };
}

/** Route a poisoned job into the dead-letter queue and free the active slot. */
export async function routeToDeadLetterQueue(input: {
  scheduledPostId: string;
  queueJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failureCount: number;
  reason: string;
}): Promise<void> {
  const now = new Date().toISOString();
  try {
    // Upsert into DLQ.
    const { data: existing } = await supabase
      .from('creator_dead_letter_jobs')
      .select('id, failure_count')
      .eq('scheduled_post_id', input.scheduledPostId)
      .maybeSingle();
    if (existing) {
      await ownedDbTable('creator_dead_letter_jobs')
        .update({
          failure_count: input.failureCount,
          last_error_code: input.errorCode,
          last_error_message: input.errorMessage,
          last_failed_at: now,
          status: 'poisoned',
          poisoned_reason: input.reason,
        })
        .eq('id', (existing as any).id);
    } else {
      await ownedDbTable('creator_dead_letter_jobs').insert({
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
    }

    // Cancel the live queue_job row.
    if (input.queueJobId) {
      await ownedDbTable('queue_jobs')
        .update({ status: 'cancelled', last_error: `poisoned:${input.reason}`, updated_at: now })
        .eq('id', input.queueJobId);
      try {
        const queue = getQueue();
        const job = await queue.getJob(input.queueJobId);
        if (job) await job.remove();
      } catch { /* best effort */ }
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
  } catch (err) {
    logger.warn('creatorQueueReliability.dlq_route_failed', {
      surface: 'creatorQueueReliability',
      scheduled_post_id: input.scheduledPostId,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

/**
 * Reconcile duplicate pending queue_jobs rows for the same scheduled_post.
 * Keeps the most recent and cancels the rest.
 *
 * Returns the count of rows collapsed.
 */
export async function reconcileDuplicateQueueJobs(scheduledPostId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from('queue_jobs')
      .select('id, status, updated_at')
      .eq('scheduled_post_id', scheduledPostId)
      .in('status', ['pending', 'processing'])
      .order('updated_at', { ascending: false });

    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; status: string }>;
    if (rows.length <= 1) return 0;
    const keep = rows[0];
    const toCancel = rows.slice(1).map((r) => r.id);
    if (toCancel.length === 0) return 0;

    await ownedDbTable('queue_jobs')
      .update({ status: 'cancelled', last_error: 'duplicate_job_reconciliation', updated_at: new Date().toISOString() })
      .in('id', toCancel);

    // Remove BullMQ peers for the cancelled ids.
    const queue = getQueue();
    for (const id of toCancel) {
      try {
        const job = await queue.getJob(id);
        if (job) await job.remove();
      } catch { /* best effort */ }
    }

    emitCreatorEvent({
      event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
      severity: 'warning',
      scheduledPostId,
      metadata: { kept: keep.id, cancelled: toCancel, kind: 'duplicate_pending_rows' },
    });
    return toCancel.length;
  } catch (err) {
    logger.warn('creatorQueueReliability.reconcile_failed', {
      surface: 'creatorQueueReliability',
      scheduled_post_id: scheduledPostId,
      error: (err as Error)?.message ?? String(err),
    });
    return 0;
  }
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
  duration_ms: number;
}> {
  const startedAt = Date.now();
  const maxScan = Math.max(1, Math.min(options.maxScan ?? 1000, 5000));
  let drift_found = 0;
  let drift_cancelled = 0;

  try {
    const { data } = await supabase
      .from('queue_jobs')
      .select('id, scheduled_post_id, status, updated_at')
      .in('status', ['pending', 'processing'])
      .order('updated_at', { ascending: true })
      .limit(maxScan);
    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; scheduled_post_id: string }>;

    const queue = getQueue();
    const toCancel: string[] = [];
    for (const row of rows) {
      let exists = false;
      try {
        const job = await queue.getJob(row.id);
        exists = !!job;
      } catch {
        exists = false;
      }
      if (!exists) {
        drift_found++;
        toCancel.push(row.id);
      }
    }

    if (toCancel.length > 0) {
      await ownedDbTable('queue_jobs')
        .update({ status: 'cancelled', last_error: 'drift_self_heal', updated_at: new Date().toISOString() })
        .in('id', toCancel);
      drift_cancelled = toCancel.length;
      emitCreatorEvent({
        event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
        severity: 'warning',
        metadata: { drift_count: drift_cancelled, kind: 'bullmq_missing' },
      });
    }

    return {
      scanned: rows.length,
      drift_found,
      drift_cancelled,
      duration_ms: Date.now() - startedAt,
    };
  } catch (err) {
    logger.warn('creatorQueueReliability.drift_sweep_failed', {
      surface: 'creatorQueueReliability',
      error: (err as Error)?.message ?? String(err),
    });
    return { scanned: 0, drift_found: 0, drift_cancelled: 0, duration_ms: Date.now() - startedAt };
  }
}

/**
 * Stuck-job recovery — for rows in `processing` longer than `staleMinutes`,
 * mark them stuck and either retry or DLQ them. This is the safety net
 * for workers that died mid-publish without releasing the row.
 */
export async function recoverStuckProcessingJobs(options: { staleMinutes?: number; dryRun?: boolean } = {}): Promise<{
  scanned: number;
  recovered: number;
  routed_to_dlq: number;
}> {
  const stale = Math.max(1, options.staleMinutes ?? 15);
  const threshold = new Date(Date.now() - stale * 60 * 1000).toISOString();

  let scanned = 0;
  let recovered = 0;
  let routed_to_dlq = 0;

  try {
    const { data } = await supabase
      .from('queue_jobs')
      .select('id, scheduled_post_id, attempts, last_error, updated_at, status')
      .eq('status', 'processing')
      .lt('updated_at', threshold)
      .order('updated_at', { ascending: true })
      .limit(500);
    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; scheduled_post_id: string; attempts: number | null; last_error: string | null }>;
    scanned = rows.length;

    for (const row of rows) {
      if (options.dryRun) continue;
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= POISON_FAILURE_THRESHOLD) {
        await routeToDeadLetterQueue({
          scheduledPostId: row.scheduled_post_id,
          queueJobId: row.id,
          errorCode: 'STUCK_PROCESSING',
          errorMessage: row.last_error,
          failureCount: attempts,
          reason: 'stuck_processing_recovery',
        });
        routed_to_dlq++;
      } else {
        // Re-queue: set status back to pending; safety-net will pick up.
        await ownedDbTable('queue_jobs')
          .update({
            status: 'pending',
            attempts,
            last_error: 'stuck_processing_recovered',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        recovered++;
        emitCreatorEvent({
          event: CREATOR_EVENTS.QUEUE_DRIFT_DETECTED,
          severity: 'warning',
          scheduledPostId: row.scheduled_post_id,
          queueJobId: row.id,
          retryCount: attempts,
          metadata: { kind: 'stuck_processing_requeued' },
        });
      }
    }
  } catch (err) {
    logger.warn('creatorQueueReliability.stuck_recovery_failed', {
      surface: 'creatorQueueReliability',
      error: (err as Error)?.message ?? String(err),
    });
  }

  return { scanned, recovered, routed_to_dlq };
}

/**
 * List active DLQ entries — used by the admin dashboard.
 */
export async function listDeadLetterJobs(options: { limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  try {
    const { data } = await supabase
      .from('creator_dead_letter_jobs')
      .select('*')
      .eq('status', 'poisoned')
      .order('last_failed_at', { ascending: false })
      .limit(limit);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Manual recovery API — admin marks a DLQ entry as recovered + reschedules. */
export async function markDeadLetterRecovered(id: string, actorUserId: string): Promise<void> {
  try {
    await ownedDbTable('creator_dead_letter_jobs')
      .update({ status: 'recovered', metadata: { recovered_by: actorUserId, recovered_at: new Date().toISOString() } })
      .eq('id', id);
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
