/**
 * Durable publish-retry state — `queue_jobs.retry_state`.
 *
 * `queue_jobs.status = 'failed'` is written on EVERY failed delivery, final or
 * not, so on its own it cannot say whether BullMQ still holds a backoff retry
 * for the row. `retry_state` is the second half of that fact:
 *
 *   'awaiting_retry' — the delivery failed and BullMQ will deliver this job id
 *                      again. The row is still LIVE: duplicate guards count it
 *                      and cancellation retires it.
 *   'exhausted'      — the final delivery failed. Terminal. The processor
 *                      refuses to run the row again, so a re-delivery after a
 *                      crash between this write and BullMQ's own failure
 *                      record cannot publish.
 *   NULL             — unknown. Every row written before migration
 *                      20261202000000, and any row whose state write did not
 *                      land. NEVER read as terminal: cancellation still
 *                      retires a failed NULL row, and the processor still runs
 *                      one if it is delivered. It is not counted as live by the
 *                      duplicate guards, which is the behaviour those rows had
 *                      before this column existed.
 *
 * MIXED VERSIONS. Code here may run against a database where the migration has
 * not been applied. Every read or write that names `retry_state` treats an
 * unknown-column error as "column absent" and falls back to the pre-migration
 * behaviour instead of failing — see `isRetryStateColumnMissing`.
 */

import { ownedDbTable } from '../db/writeOwner';

export const RETRY_STATE_AWAITING = 'awaiting_retry' as const;
export const RETRY_STATE_EXHAUSTED = 'exhausted' as const;
export type PublishRetryState = typeof RETRY_STATE_AWAITING | typeof RETRY_STATE_EXHAUSTED;

/**
 * True when a PostgREST/Postgres error says `retry_state` does not exist.
 *
 *   42703    — Postgres undefined_column (a filter or select names it).
 *   PGRST204 — PostgREST schema cache has no such column (an update payload
 *              names it).
 *
 * Both codes are also raised for OTHER unknown columns, so the message must
 * name retry_state; an unrelated schema error keeps propagating as an error.
 */
export function isRetryStateColumnMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (code !== '42703' && code !== 'PGRST204') return false;
  return String(error.message ?? '').includes('retry_state');
}

/**
 * The retry state a failed delivery leaves behind. `attemptsMade` is BullMQ's
 * count BEFORE this delivery failed (it is incremented after the processor
 * throws), so this delivery was attempt `attemptsMade + 1`.
 */
export function retryStateAfterFailedDelivery(
  attemptsMade: number | null | undefined,
  maxAttempts: number | null | undefined,
): PublishRetryState {
  const thisAttempt = (attemptsMade ?? 0) + 1;
  return thisAttempt >= (maxAttempts ?? 1) ? RETRY_STATE_EXHAUSTED : RETRY_STATE_AWAITING;
}

/**
 * Whether the publish pipeline can still act on a post, judged from ALL of its
 * queue_jobs rows:
 *
 *   LIVE     — some row is pending or processing, or failed and awaiting a
 *              BullMQ retry: a delivery is coming.
 *   UNKNOWN  — no row is live, but the pipeline's intent cannot be shown to be
 *              over: there are no rows at all (a failed thread child rides its
 *              root's job and has none of its own), a failed row has a NULL
 *              retry_state (written before migration 20261202000000, or its
 *              state write was lost), or a status/state is not recognised.
 *   TERMINAL — at least one row, and every row is cancelled, completed, or
 *              failed with retry_state 'exhausted'.
 *
 * One exhausted row never makes a post terminal on its own: every row has to
 * agree. Rows read without the retry_state column (pre-migration) carry no
 * retry_state, so their failed rows are UNKNOWN. Pure: no I/O.
 */
export type PostRetryClass = 'LIVE' | 'UNKNOWN' | 'TERMINAL';

export function classifyPostQueueJobs(
  rows: ReadonlyArray<{ status?: unknown; retry_state?: unknown }>,
): PostRetryClass {
  if (rows.length === 0) return 'UNKNOWN';
  let unknown = false;
  for (const row of rows) {
    const status = row.status;
    if (status === 'pending' || status === 'processing') return 'LIVE';
    if (status === 'cancelled' || status === 'completed') continue;
    if (status === 'failed') {
      const state = row.retry_state;
      if (state === RETRY_STATE_AWAITING) return 'LIVE';
      if (state === RETRY_STATE_EXHAUSTED) continue;
      unknown = true; // NULL, absent, or an unrecognised value
      continue;
    }
    unknown = true; // unrecognised status
  }
  return unknown ? 'UNKNOWN' : 'TERMINAL';
}

/**
 * Failed queue_jobs rows whose BullMQ job is still waiting to retry
 * (`retry_state = 'awaiting_retry'`) for the given posts. These are LIVE for
 * duplicate purposes even though their status is 'failed'.
 *
 * Before migration 20261202000000 the column does not exist, no row can be
 * awaiting a recorded retry, and the answer is "none" — the behaviour the
 * guards had before the column existed. Any other error is returned so the
 * caller can fail closed.
 *
 * Used by the per-post guard (enqueueScheduledPostAt) and the atomic
 * reschedule's prior-job capture. The safety-net cron reads the same fact in
 * its existing batched lookup instead, to keep its round-trip budget.
 * Read-only: only the publish worker WRITES retry_state.
 */
export async function findAwaitingRetryQueueJobs(
  scheduledPostIds: string[],
): Promise<
  | { ok: true; rows: Array<{ id: string; scheduled_post_id: string }> }
  | { ok: false; message: string }
> {
  if (scheduledPostIds.length === 0) return { ok: true, rows: [] };
  const { data, error } = await ownedDbTable('queue_jobs')
    .select('id, scheduled_post_id')
    .in('scheduled_post_id', scheduledPostIds)
    .eq('status', 'failed')
    .eq('retry_state', RETRY_STATE_AWAITING);
  if (error) {
    if (isRetryStateColumnMissing(error)) return { ok: true, rows: [] };
    return { ok: false, message: error.message };
  }
  return {
    ok: true,
    rows: (Array.isArray(data) ? data : []).map((r: { id: string; scheduled_post_id: string }) => ({
      id: String(r.id),
      scheduled_post_id: String(r.scheduled_post_id),
    })),
  };
}
