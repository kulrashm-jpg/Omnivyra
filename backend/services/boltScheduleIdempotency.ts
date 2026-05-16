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
    if (msg.includes('uidx_scheduled_posts_idempotency_key')) return true;
    if (msg.includes('duplicate key value') && msg.includes('idempotency_key')) return true;
  }
  return false;
}
