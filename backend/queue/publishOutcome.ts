/**
 * Publish outcome evidence — when may a publish be attempted (again)?
 *
 * No platform adapter here can make post creation idempotent: none sends an
 * idempotency key or a client request id, so calling the platform twice for
 * one scheduled post can publish it twice. A retry is therefore only safe when
 * there is EVIDENCE that the previous attempt did not create a post. Absence of
 * evidence is not evidence: an attempt whose outcome cannot be shown to be a
 * rejection is recorded as PUBLISH_OUTCOME_UNCERTAIN and is never retried
 * automatically. A person reconciles it against the platform first (see
 * backend/services/publishOutcomeReconciliation.ts).
 *
 * Durable state lives in `scheduled_posts.error_code` (an existing column — no
 * migration), per row, so the queue worker, the thread orchestrator (queue
 * re-delivery AND operator resume), the stuck-publishing sweeper and the
 * blueprint guard all read the same fact:
 *
 *   PUBLISH_CLAIMED:<token>   — written WITH status 'publishing' by the claim
 *                               (single posts and thread nodes). No platform
 *                               call has started. The token fences the claim:
 *                               only the execution holding it can move the row
 *                               on to PUBLISH_CALL_STARTED.
 *   PUBLISH_CALL_STARTED      — written, compare-and-set FROM the holder's own
 *                               PUBLISH_CLAIMED:<token>, immediately before the
 *                               platform call. A row still carrying it was
 *                               interrupted at or after the call. It never
 *                               means "published", and it is never taken over.
 *   PUBLISH_OUTCOME_UNCERTAIN — the attempt may have created the post.
 *   PUBLISH_RECONCILED_NOT_PUBLISHED
 *                             — a person checked the platform and found no
 *                               post; the row may be retried.
 *   any other code            — a classified failure (retry follows the
 *                               ordinary policy).
 */

import { PUBLISH_OUTCOME_UNCERTAIN } from './publishRetryState';

export { PUBLISH_OUTCOME_UNCERTAIN };
export const PUBLISH_CALL_STARTED = 'PUBLISH_CALL_STARTED' as const;
export const PUBLISH_RECONCILED_NOT_PUBLISHED = 'PUBLISH_RECONCILED_NOT_PUBLISHED' as const;
/** A failure recorded before any platform request was sent — safe to retry. */
export const PUBLISH_NOT_ATTEMPTED = 'PUBLISH_NOT_ATTEMPTED' as const;
/** Prefix of the claim token stored in error_code while 'publishing', pre-call. */
export const PUBLISH_CLAIMED_PREFIX = 'PUBLISH_CLAIMED:' as const;

/** The error_code value that records a claim held under `token`. */
export function publishClaimCode(token: string): string {
  return `${PUBLISH_CLAIMED_PREFIX}${token}`;
}

/**
 * True when the row records a claim taken by the current protocol and NO
 * platform call has started under it. Only such a claim may ever be taken
 * over (by a stale-claim takeover or the sweeper): replacing its token fences
 * the previous holder out of the marker write, so that holder can never start
 * a call afterwards. Elapsed time alone proves nothing.
 */
export function isPreCallClaim(row: { status?: string | null; error_code?: string | null }): boolean {
  return String(row.status ?? '').toLowerCase() === 'publishing'
    && typeof row.error_code === 'string'
    && row.error_code.startsWith(PUBLISH_CLAIMED_PREFIX)
    && row.error_code.length > PUBLISH_CLAIMED_PREFIX.length;
}

/**
 * Adapter failure codes that PROVE no post was created: the failure happened
 * before the create-post request was sent, or the platform answered that
 * request with an explicit rejection (400/401/403/422/429, quota). Anything not
 * listed here — 5xx, network errors, the generic *_API_ERROR codes (which mix
 * 5xx, unmapped 4xx, network resets and malformed 2xx bodies), the generic
 * TikTok/Pinterest/Spotify codes (step unknown), an escaped throw — is
 * ambiguous. `retryable: true` is NOT evidence and is ignored here.
 */
const NO_POST_CREATED_CODES: ReadonlySet<string> = new Set([
  // Pre-send (before the create-post request).
  'MEDIA_WOULD_BE_STRIPPED',
  'LINKEDIN_NO_USER_ID',
  'LINKEDIN_MIXED_MEDIA_UNSUPPORTED',
  'LINKEDIN_MEDIA_CACHE_WRITE_FAILED',
  'LINKEDIN_MEDIA_FETCH_FAILED',
  'LINKEDIN_MEDIA_KIND_UNSUPPORTED',
  'LINKEDIN_MEDIA_PUT_FAILED',
  'LINKEDIN_MEDIA_REGISTER_FAILED',
  'LINKEDIN_MEDIA_TOO_LARGE',
  'LINKEDIN_VIDEO_FINALIZE_FAILED',
  'LINKEDIN_VIDEO_PROCESSING_FAILED',
  'FACEBOOK_NO_PAGE_TARGET',
  'FACEBOOK_NO_PAGE_TOKEN',
  'FACEBOOK_PAGE_SELECTION_REQUIRED',
  'YOUTUBE_NO_TITLE',
  'API_NOT_AVAILABLE',
  // Explicit HTTP rejection of the create-post request.
  'LINKEDIN_VERSION_EXPIRED',
  'LINKEDIN_UNAUTHORIZED',
  'LINKEDIN_FORBIDDEN',
  'LINKEDIN_VALIDATION',
  'LINKEDIN_RATE_LIMIT',
  'TWITTER_UNAUTHORIZED',
  'TWITTER_VALIDATION_ERROR',
  'TWITTER_RATE_LIMIT',
  'FACEBOOK_UNAUTHORIZED',
  'FACEBOOK_PERMISSION_DENIED',
  'FACEBOOK_VALIDATION_ERROR',
  'FACEBOOK_RATE_LIMIT',
  'INSTAGRAM_UNAUTHORIZED',
  'INSTAGRAM_PERMISSION_DENIED',
  'INSTAGRAM_VALIDATION_ERROR',
  'INSTAGRAM_RATE_LIMIT',
  'YOUTUBE_UNAUTHORIZED',
  'YOUTUBE_PERMISSION_DENIED',
  'YOUTUBE_VALIDATION_ERROR',
  'YOUTUBE_RATE_LIMIT',
  'YOUTUBE_QUOTA_EXCEEDED',
]);

export type PublishAttemptOutcome =
  /** Confirmed: the platform returned the new post's id. */
  | 'published'
  /** Confirmed: no post was created. Ordinary retry policy applies. */
  | 'not_created'
  /** The post may exist. Never retry automatically. */
  | 'ambiguous';

export type PublishAttemptResult = {
  success?: boolean;
  platform_post_id?: string | null;
  error?: { code?: string | null; delivery?: 'not_sent' } | null;
} | null | undefined;

/**
 * Classify one adapter result. A success WITHOUT a post id (Instagram and
 * Pinterest can return one) is ambiguous — the post may be live but cannot be
 * recorded — and so is a missing or malformed result.
 */
export function classifyPublishAttempt(result: PublishAttemptResult): PublishAttemptOutcome {
  if (!result || typeof result !== 'object') return 'ambiguous';
  if (result.success === true) {
    return typeof result.platform_post_id === 'string' && result.platform_post_id.trim() !== ''
      ? 'published'
      : 'ambiguous';
  }
  const error = result.error;
  if (!error || typeof error !== 'object') return 'ambiguous';
  if (error.delivery === 'not_sent') return 'not_created';
  return typeof error.code === 'string' && NO_POST_CREATED_CODES.has(error.code) ? 'not_created' : 'ambiguous';
}

export type PostOutcomeEvidence = {
  status?: string | null;
  error_code?: string | null;
  platform_post_id?: string | null;
};

/**
 * Does the row record that a previous attempt may have published it?
 * Decided by the error_code, NOT by the status: a writer that moves the row to
 * 'scheduled' (an edit, a re-schedule, a "publish now" that only re-queues)
 * without reconciling it does not make the post any less possibly-live. Only
 * a 'publishing' row (held — see publishOutcomeBlocksAttempt) and a row with a
 * platform_post_id (published) are excluded.
 */
export function hasUncertainOutcome(row: PostOutcomeEvidence): boolean {
  if (row.platform_post_id) return false;
  const status = String(row.status ?? '').toLowerCase();
  if (status === 'publishing' || status === 'published') return false;
  return row.error_code === PUBLISH_OUTCOME_UNCERTAIN || row.error_code === PUBLISH_CALL_STARTED;
}

/**
 * May a publish attempt start for this row, as far as its OWN durable evidence
 * goes? Refuses:
 *   - 'publishing' — another execution holds it, or one died holding it; the
 *     sweeper owns labelling a dead hold, never a re-run.
 *   - any status carrying PUBLISH_OUTCOME_UNCERTAIN or PUBLISH_CALL_STARTED
 *     (hasUncertainOutcome; the marker survives the previous sweeper, which set
 *     only status/message).
 *   - with `missingCodeIsUncertain`, 'failed' with no code at all. Thread nodes
 *     use this: before this change the orchestrator wrote node failures with no
 *     code, and the previous sweeper did too, so a code-less failed node cannot
 *     be told apart from one swept after its call reached the platform.
 * A row with a platform_post_id is published, not uncertain (callers skip it).
 */
export function publishOutcomeBlocksAttempt(
  row: PostOutcomeEvidence,
  options: { missingCodeIsUncertain?: boolean } = {},
): 'in_flight' | 'uncertain' | null {
  if (row.platform_post_id) return null;
  const status = String(row.status ?? '').toLowerCase();
  if (status === 'publishing') return 'in_flight';
  if (hasUncertainOutcome(row)) return 'uncertain';
  if (status === 'failed' && !row.error_code && options.missingCodeIsUncertain) return 'uncertain';
  return null;
}

/** A failed row whose outcome is recorded as possibly live (guard / UI use). */
export function isUncertainFailedPost(row: PostOutcomeEvidence): boolean {
  if (row.platform_post_id) return false;
  if (String(row.status ?? '').toLowerCase() !== 'failed') return false;
  return row.error_code === PUBLISH_OUTCOME_UNCERTAIN || row.error_code === PUBLISH_CALL_STARTED;
}

/** Operator-facing message stored with an uncertain outcome. */
export const PUBLISH_OUTCOME_UNCERTAIN_MESSAGE =
  'Publish outcome unknown: the request may have reached the platform but no result was saved. ' +
  'It may already be live — check the platform, then reconcile before retrying.';
