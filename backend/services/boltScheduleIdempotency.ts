/**
 * BOLT scheduled-post idempotency keys.
 *
 * A deterministic key built from the (campaign, week, day, platform,
 * content_type, sequence) tuple lets the scheduler INSERT … with the
 * unique index `uidx_scheduled_posts_idempotency_key` as a hard
 * duplicate guard. Retries / resumes / partial-recoveries can replay
 * inserts without producing duplicate scheduled posts — the unique
 * index throws on collision, and the caller handles it as
 * "already created, skip".
 *
 * Format: SHA-256 hex prefix (32 chars) of the canonical key string.
 * Reasons for SHA-256 over UUIDv5:
 *   - No external deps; node's crypto module covers it.
 *   - The hex string is greppable in DB rows for ops debugging.
 *   - Collisions are statistically impossible at our scale (2^128
 *     space at 32-hex prefix; we will never produce 2^64 keys).
 *
 * Key inputs are intentionally normalized:
 *   - platform: lowercased
 *   - content_type: lowercased
 *   - day_of_week: as supplied (the planner already normalizes it)
 *   - sequence: integer, defaults to 0; lets multi-post-per-day
 *     campaigns disambiguate within the same (week, day, platform).
 */

import { createHash } from 'crypto';

export interface ScheduledPostIdempotencyInput {
  campaignId: string;
  weekNumber: number | string;
  dayOfWeek: string;
  platform: string;
  contentType: string;
  /** Defaults to 0. Distinguishes multiple posts for the same
   *  (week, day, platform, content_type) tuple. */
  sequence?: number;
}

/**
 * Produce the canonical 32-character idempotency key for a scheduled
 * post. Stable across processes: same inputs ALWAYS produce the same
 * key. That stability is what makes retries safe.
 */
export function makeScheduledPostIdempotencyKey(input: ScheduledPostIdempotencyInput): string {
  const canonical = [
    String(input.campaignId).trim(),
    `w${Number(input.weekNumber)}`,
    `d${String(input.dayOfWeek).trim().toLowerCase()}`,
    `p${String(input.platform).trim().toLowerCase()}`,
    `c${String(input.contentType).trim().toLowerCase()}`,
    `s${Number(input.sequence ?? 0)}`,
  ].join('::');

  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Name of the partial unique index on scheduled_posts.idempotency_key. Named
 * once so `isIdempotencyCollision` (which treats it as ITS violation) and
 * `isLiveQueueJobDuplicateViolation` below (which must treat it as NOT its
 * violation) can never drift onto different spellings of the same index.
 */
export const SCHEDULED_POSTS_IDEMPOTENCY_INDEX = 'uidx_scheduled_posts_idempotency_key';

/**
 * Classify a Postgres error to detect the unique-violation thrown by
 * our partial index when a retry tries to re-insert a row with an
 * existing idempotency_key.
 *
 * Supabase / postgrest-js exposes the SQLSTATE as `code`. PG's
 * unique_violation is '23505'. Some PostgREST surfaces don't include
 * the code, so we also string-match the message as a fallback.
 */
export function isIdempotencyCollision(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && e.code === '23505') return true;
  if (typeof e.message === 'string') {
    const msg = e.message.toLowerCase();
    if (msg.includes(SCHEDULED_POSTS_IDEMPOTENCY_INDEX)) return true;
    if (msg.includes('duplicate key value') && msg.includes('idempotency_key')) return true;
  }
  return false;
}

/**
 * Name of the partial unique index created by
 * supabase/migrations/20261009000000_queue_jobs_live_publish_uniqueness.sql:
 *
 *   UNIQUE (scheduled_post_id, job_type) WHERE status IN ('pending','processing')
 *
 * It is the DURABLE half of the scheduler's publish-job duplicate guard. The
 * read-before-insert checks in backend/scheduler/ are an optimisation that
 * avoids a pointless INSERT; this index is what actually makes "at most one
 * live publish job per scheduled post" true when two enqueue paths interleave.
 */
export const QUEUE_JOBS_LIVE_UNIQUE_INDEX = 'uidx_queue_jobs_live_job_per_post';

/**
 * Classify an insert failure as "the database rejected this row because a LIVE
 * queue_job already exists for this post", i.e. another writer got there first.
 *
 * WHY IT LIVES HERE
 * -----------------
 * This module already owns unique-violation classification for our partial
 * unique indexes, and it is a leaf module (crypto only) that no suite stubs.
 * Both scheduler insert paths — findDuePostsAndEnqueue in schedulerService.ts
 * and enqueueScheduledPostAt in schedulerPostQueueControl.ts — must agree on
 * this predicate even when one of those modules has the other mocked out. A
 * guard that disappears when a neighbouring module is mocked is not a guard.
 *
 * WHY THE MESSAGE FALLBACK IS NOT OPTIONAL
 * ----------------------------------------
 * `createQueueJob()` (backend/db/queries.ts) re-wraps the PostgREST error as
 * `new Error('Failed to create queue job: <message>')` and DROPS the structured
 * `code`. After that wrap the index name inside the message is the only
 * surviving evidence that this was a unique violation, so a code-only
 * classifier would misread every raced insert as an outage.
 *
 * WHY IT DOES NOT SIMPLY DELEGATE TO isIdempotencyCollision
 * ---------------------------------------------------------
 * That predicate answers a different question — "did SOME partial unique index
 * reject this?" — and answers it TRUE for a message naming
 * `uidx_scheduled_posts_idempotency_key`, which is an index on a different
 * table (scheduled_posts). Reusing it wholesale therefore made a
 * scheduled-posts collision read as "a live queue_job already exists", which is
 * not what happened. Unreachable at today's call sites, since the scheduler
 * INSERTs into queue_jobs and cannot raise that index's violation — but a
 * predicate exported for other modules to import must not be right only by
 * accident of where it is called.
 *
 * Evidence is therefore weighed in order of specificity:
 *   1. the message names THIS index                  -> duplicate
 *   2. the message names a DIFFERENT known index     -> NOT this duplicate,
 *      whatever the SQLSTATE says (the constraint name is the authority)
 *   3. the message is the generic violation text AND names queue_jobs
 *                                                    -> duplicate
 *   4. SQLSTATE 23505 with nothing more specific     -> duplicate
 *
 * Step 4 is correct at these call sites and is a deliberate consequence of the
 * table's shape, not an oversight: public.queue_jobs carries exactly two unique
 * constraints — queue_jobs_pkey on `id`, whose value comes from
 * gen_random_uuid(), and this index. An INSERT into queue_jobs has no other
 * reachable source of 23505.
 *
 * Everything else a failing insert can raise — 23503 foreign key, 23502
 * not-null, 23514 check, 57014 statement timeout, a dropped connection — is
 * left to surface as a failure, because swallowing one of those as "already
 * queued" would silently drop the post instead of publishing it.
 */
export function isLiveQueueJobDuplicateViolation(err: unknown): boolean {
  if (!err) return false;

  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === 'string'
        ? (err as { message: string }).message
        : '';
  const lowered = message.toLowerCase();

  if (lowered.includes(QUEUE_JOBS_LIVE_UNIQUE_INDEX)) return true;
  if (lowered.includes(SCHEDULED_POSTS_IDEMPOTENCY_INDEX)) return false;
  // PostgREST does not always name the constraint; pair the generic violation
  // text with the table so an unrelated 23505 is not read as "already queued".
  if (lowered.includes('duplicate key value') && lowered.includes('queue_jobs')) return true;

  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && code === '23505';
}
