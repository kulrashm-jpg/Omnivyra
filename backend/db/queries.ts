/**
 * Database Query Functions
 * 
 * Typed functions for common database operations.
 * All functions use Supabase client for queries.
 * 
 * Tables used:
 * - queue_jobs
 * - queue_job_logs
 * - scheduled_posts
 * - social_accounts
 */

import { supabase } from './supabaseClient';
import { isRetryStateColumnMissing, PUBLISH_OUTCOME_UNCERTAIN } from '../queue/publishRetryState';
import { PUBLISH_CALL_STARTED, publishClaimCode } from '../queue/publishOutcome';

export interface QueueJob {
  id: string;
  scheduled_post_id: string;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  /**
   * Present only once migration 20261202000000 is applied (select('*') omits
   * an absent column). See backend/queue/publishRetryState.ts.
   */
  retry_state?: 'awaiting_retry' | 'exhausted' | null;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  next_retry_at?: string;
  error_message?: string;
  error_code?: string;
  metadata?: any;
  result_data?: any;
  created_at: string;
  updated_at: string;
}

export interface ScheduledPost {
  id: string;
  user_id: string;
  social_account_id: string;
  campaign_id?: string;
  platform: string;
  content_type: string;
  title?: string;
  content: string;
  hashtags?: string[];
  media_urls?: string[];
  scheduled_for: string;
  status: string;
  platform_post_id?: string;
  post_url?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
  repurpose_index?: number;
  repurpose_total?: number;
  creator_attachment_metadata?: unknown;
  is_thread_start?: boolean;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string;
  platform_user_id: string;
  account_name: string;
  username?: string;
  access_token: string;
  refresh_token?: string;
  token_expires_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new queue job
 */
export async function createQueueJob(data: {
  scheduled_post_id: string;
  job_type: string;
  status: string;
  scheduled_for: string;
  priority?: number;
}): Promise<string> {
  const { data: job, error } = await supabase
    .from('queue_jobs')
    .insert({
      scheduled_post_id: data.scheduled_post_id,
      job_type: data.job_type,
      status: data.status,
      scheduled_for: data.scheduled_for,
      priority: data.priority || 0,
      attempts: 0,
      max_attempts: 3,
    })
    .select('id')
    .single();

  if (error || !job) {
    throw new Error(`Failed to create queue job: ${error?.message}`);
  }

  return job.id;
}

/**
 * Get queue job by ID
 */
export async function getQueueJob(jobId: string): Promise<QueueJob | null> {
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get queue job: ${error.message}`);
  }

  return data;
}

/**
 * Update queue job status
 */
export async function updateQueueJobStatus(
  jobId: string,
  status: string,
  updates?: {
    error_message?: string;
    error_code?: string;
    next_retry_at?: string;
    result_data?: any;
  }
): Promise<void> {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (updates?.error_message) {
    updateData.error_message = updates.error_message;
  }
  if (updates?.error_code) {
    updateData.error_code = updates.error_code;
  }
  if (updates?.next_retry_at) {
    updateData.next_retry_at = updates.next_retry_at;
  }
  if (updates?.result_data) {
    updateData.result_data = updates.result_data;
  }

  let query = supabase
    .from('queue_jobs')
    .update(updateData)
    .eq('id', jobId);

  // A 'failed' write only lands on a row that can still fail. It must never
  // overwrite a cancellation: a cancel that lands while a delivery is in flight
  // would otherwise be turned back into 'failed', and a 'failed' row is
  // runnable again on BullMQ's next delivery — the cancelled post would
  // publish. 'completed' stays unconditional: it records a publish that
  // actually happened, which is the truth even for a row cancelled meanwhile.
  if (status === 'failed') {
    query = query.in('status', QUEUE_JOB_FAILABLE_FROM_STATUSES);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to update queue job: ${error.message}`);
  }
}

/** The statuses a publish delivery can legitimately fail out of. */
const QUEUE_JOB_FAILABLE_FROM_STATUSES = ['pending', 'processing', 'failed'];

/**
 * Uncertain publish outcome (duplicate-publication guard).
 *
 * No platform adapter here can make post creation idempotent (none sends an
 * idempotency key or client request id), so a worker that dies AFTER the
 * platform request is sent leaves an outcome nobody can know from the database:
 * the post may already be live. Re-delivering and republishing then risks a
 * public duplicate; marking it plainly failed would hide that it may be live.
 *
 * The queue path therefore records, immediately before the platform call, a
 * per-attempt marker in queue_jobs.metadata (an existing jsonb column — no
 * migration). A re-delivery that finds the job still 'processing' past the
 * replay window, with that marker set and the post still 'publishing', does
 * NOT call the platform again: it records PUBLISH_OUTCOME_UNCERTAIN and stops,
 * so a person checks the platform before any retry.
 */
export { PUBLISH_OUTCOME_UNCERTAIN };
export const PLATFORM_CALL_MARKER_KEY = 'platform_call';

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

/** The metadata with the platform-call marker removed (other keys preserved). */
export function withoutPlatformCallMarker(metadata: unknown): Record<string, unknown> {
  const next = metadataObject(metadata);
  delete next[PLATFORM_CALL_MARKER_KEY];
  return next;
}

/** The platform-call marker on a queue_jobs row, if a call was started and not resolved. */
export function readPlatformCallMarker(metadata: unknown): { started_at: string } | null {
  const marker = metadataObject(metadata)[PLATFORM_CALL_MARKER_KEY];
  if (!marker || typeof marker !== 'object') return null;
  const startedAt = (marker as { started_at?: unknown }).started_at;
  return typeof startedAt === 'string' && startedAt ? { started_at: startedAt } : null;
}

/**
 * Record — immediately before the platform call — that this attempt is about
 * to call the platform. Lands only while the row is still 'processing'; zero
 * rows (cancelled or taken over meanwhile) means the caller must NOT call the
 * platform. A write error throws: without the marker, a death during the call
 * would be indistinguishable from one before it, so the call must not happen.
 */
export async function markQueueJobPlatformCallStarted(
  jobId: string,
  snapshotMetadata: unknown,
): Promise<boolean> {
  const metadata = withoutPlatformCallMarker(snapshotMetadata);
  metadata[PLATFORM_CALL_MARKER_KEY] = { started_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('queue_jobs')
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('id');
  if (error) throw new Error(`Failed to record platform-call start for queue job ${jobId}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Terminally record an uncertain outcome on the queue job: failed, never
 * retried automatically, with an explicit code. Compare-and-set on the exact
 * stale 'processing' row that was read, so two re-deliveries cannot both act.
 */
export async function markQueueJobOutcomeUncertain(
  jobId: string,
  snapshot: { status?: string | null; updated_at?: string | null; retry_state?: string | null },
  message: string,
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    status: 'failed',
    error_code: PUBLISH_OUTCOME_UNCERTAIN,
    error_message: message,
    updated_at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(snapshot, 'retry_state')) payload.retry_state = 'exhausted';
  // Compare-and-set on the status that was read ('processing' when the
  // snapshot does not say), pinned by updated_at below.
  const expectedStatus = snapshot.status ?? 'processing';
  let query = supabase.from('queue_jobs').update(payload).eq('id', jobId).eq('status', expectedStatus);
  query = snapshot.updated_at ? query.eq('updated_at', snapshot.updated_at) : query.is('updated_at', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`Failed to record uncertain outcome for queue job ${jobId}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Record an uncertain outcome on a queue job THIS delivery holds ('processing',
 * claimed by it — so no updated_at pin). Failed, never retried automatically:
 * the processor refuses a failed row carrying the code, and retry_state is set
 * to 'exhausted' where the column exists. Returns false when the row is no
 * longer 'processing' (a cancel landed); throws on a write error.
 */
export async function recordHeldQueueJobOutcomeUncertain(jobId: string, message: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('queue_jobs')
    .update({
      status: 'failed',
      error_code: PUBLISH_OUTCOME_UNCERTAIN,
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('id');
  if (error) throw new Error(`Failed to record uncertain outcome for queue job ${jobId}: ${error.message}`);
  const applied = Array.isArray(data) && data.length > 0;
  if (applied) await recordQueueJobRetryState(jobId, 'exhausted');
  return applied;
}

/**
 * Record — immediately before the platform call — that THIS attempt is calling
 * the platform for the post (durable per-row marker, see
 * backend/queue/publishOutcome.ts). Compare-and-set on 'publishing' AND on the
 * caller's own claim token: if the claim was taken over or swept meanwhile, the
 * token no longer matches, zero rows change, and the caller must NOT call the
 * platform. A write error throws for the same reason.
 */
export async function markScheduledPostPlatformCallStarted(postId: string, claimToken: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .update({ error_code: PUBLISH_CALL_STARTED, updated_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('status', 'publishing')
    .eq('error_code', publishClaimCode(claimToken))
    .select('id');
  if (error) throw new Error(`Failed to record platform-call start for scheduled post ${postId}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Record that a post's publish outcome is unknown: failed, with
 * PUBLISH_OUTCOME_UNCERTAIN. Only over a row whose outcome is still unrecorded
 * — never a 'published' row or one carrying a platform_post_id.
 */
export async function markScheduledPostOutcomeUncertain(postId: string, message: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .update({
      status: 'failed',
      error_code: PUBLISH_OUTCOME_UNCERTAIN,
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .in('status', ['publishing', 'failed'])
    .is('platform_post_id', null)
    .select('id');
  if (error) throw new Error(`Failed to record uncertain outcome for scheduled post ${postId}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export type QueueJobProcessingClaim =
  | { claimed: true }
  | { claimed: false; reason: 'not_runnable' | 'changed_since_read' };

/**
 * Compare-and-set a queue_jobs row into 'processing' for ONE delivery.
 *
 * The publish processor used to write 'processing' unconditionally, so a row
 * cancelled after the job was read (or before it, when job.remove() could not
 * delete a job BullMQ was already holding) was flipped back to live and
 * published anyway. The database is the authority: the UPDATE only lands when
 * the row is still in the exact state the caller read and judged runnable, and
 * zero affected rows means this delivery must not publish.
 *
 * Runnable snapshots:
 *   pending                       — first delivery.
 *   failed, retry_state NULL      — unknown; never treated as terminal.
 *   failed, 'awaiting_retry'      — BullMQ's backoff re-delivery.
 *   processing (stale)            — the caller has already applied the
 *                                   replay-suppression window; the CAS pins
 *                                   updated_at so two stale re-deliveries
 *                                   cannot both win.
 * Everything else — cancelled, completed, failed+'exhausted', poisoned, an
 * unknown status — is refused without a write.
 *
 * `retry_state` is only named when the snapshot carries it (the row was read
 * with select('*')), so this runs unchanged against a database where migration
 * 20261202000000 has not been applied.
 */
export async function claimQueueJobForProcessing(
  jobId: string,
  snapshot: {
    status?: string | null;
    updated_at?: string | null;
    retry_state?: string | null;
    error_code?: string | null;
    metadata?: unknown;
  },
): Promise<QueueJobProcessingClaim> {
  const status = snapshot.status ?? null;
  const hasRetryState = Object.prototype.hasOwnProperty.call(snapshot, 'retry_state');
  const retryState = hasRetryState ? (snapshot.retry_state ?? null) : null;

  const runnable =
    status === 'pending' ||
    status === 'processing' ||
    (status === 'failed' && retryState !== 'exhausted' && snapshot.error_code !== PUBLISH_OUTCOME_UNCERTAIN);
  if (!runnable) return { claimed: false, reason: 'not_runnable' };

  const payload: Record<string, unknown> = {
    status: 'processing',
    updated_at: new Date().toISOString(),
  };
  // A claimed row is no longer waiting for a retry — it is running one.
  if (hasRetryState) payload.retry_state = null;
  // A new attempt starts with no platform call recorded. A marker left by an
  // EARLIER attempt (which finished, or failed before calling) must not make
  // this attempt look like one that died mid-call.
  if (Object.prototype.hasOwnProperty.call(snapshot, 'metadata')) {
    payload.metadata = withoutPlatformCallMarker(snapshot.metadata);
  }

  let query = supabase.from('queue_jobs').update(payload).eq('id', jobId).eq('status', status);
  if (status === 'processing') {
    query = snapshot.updated_at
      ? query.eq('updated_at', snapshot.updated_at)
      : query.is('updated_at', null);
  }
  if (status === 'failed' && hasRetryState) {
    query = retryState === null ? query.is('retry_state', null) : query.eq('retry_state', retryState);
  }

  const { data, error } = await query.select('id');
  if (error) {
    throw new Error(`Failed to claim queue job ${jobId} for processing: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0
    ? { claimed: true }
    : { claimed: false, reason: 'changed_since_read' };
}

/**
 * Record whether BullMQ will deliver a failed job again.
 *
 * Lands only on a row that is still 'failed': a row cancelled or completed in
 * the meantime keeps its state. Never throws — it runs on the failure path,
 * where the original error must be the one that propagates.
 *
 *   'written'        — the state is durable.
 *   'not_failed'     — the row is not 'failed' (or does not exist); nothing
 *                      written.
 *   'column_missing' — migration 20261202000000 is not applied; the row stays
 *                      unknown (NULL semantics).
 *   'error'          — any other write failure; the row stays unknown.
 */
export async function recordQueueJobRetryState(
  jobId: string,
  retryState: 'awaiting_retry' | 'exhausted',
): Promise<'written' | 'not_failed' | 'column_missing' | 'error'> {
  try {
    const { data, error } = await supabase
      .from('queue_jobs')
      .update({ retry_state: retryState, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'failed')
      .select('id');
    if (error) {
      return isRetryStateColumnMissing(error) ? 'column_missing' : 'error';
    }
    return Array.isArray(data) && data.length > 0 ? 'written' : 'not_failed';
  } catch {
    return 'error';
  }
}

/**
 * Create queue job log entry
 */
export async function createQueueJobLog(
  jobId: string,
  logLevel: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  metadata?: any
): Promise<void> {
  const { error } = await supabase.from('queue_job_logs').insert({
    job_id: jobId,
    log_level: logLevel,
    message,
    metadata: metadata || {},
  });

  if (error) {
    console.error('Failed to create queue job log:', error);
    // Don't throw - logging is non-critical
  }
}

/**
 * Get scheduled post by ID
 */
export async function getScheduledPost(postId: string): Promise<ScheduledPost | null> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get scheduled post: ${error.message}`);
  }

  return data;
}

/**
 * Update scheduled post on successful publish.
 *
 * G12 — optional compare-and-set: when `expectedFromStatus` is provided, the
 * UPDATE only applies when the row's CURRENT status matches. Returns the
 * outcome so the caller can detect divergence (e.g. operator cancelled the
 * row mid-publish) and avoid silently overwriting an intervening state.
 *
 * Callers that omit `expectedFromStatus` get the original blind-update
 * behavior (used by single-row paths that don't carry a snapshot status).
 */
export type ScheduledPostTerminalWriteResult =
  | { applied: true }
  | { applied: false; reason: 'cas_mismatch' };

export async function updateScheduledPostOnPublish(
  postId: string,
  platformPostId: string,
  postUrl: string,
  publishedAt?: Date,
  expectedFromStatus?: string,
): Promise<ScheduledPostTerminalWriteResult> {
  const updatePayload = {
    status: 'published',
    platform_post_id: platformPostId,
    post_url: postUrl,
    published_at: publishedAt?.toISOString() || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // The outcome is now known: clear any attempt marker or earlier failure code.
    error_code: null,
  };

  let applied = true;
  if (expectedFromStatus) {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update(updatePayload)
      .eq('id', postId)
      .eq('status', expectedFromStatus)
      .select('id');
    if (error) {
      throw new Error(`Failed to update scheduled post: ${error.message}`);
    }
    applied = Array.isArray(data) && data.length > 0;
  } else {
    const { error } = await supabase
      .from('scheduled_posts')
      .update(updatePayload)
      .eq('id', postId);
    if (error) {
      throw new Error(`Failed to update scheduled post: ${error.message}`);
    }
  }

  if (!applied) {
    return { applied: false, reason: 'cas_mismatch' };
  }

  // Sync platform_post_id to daily_content_plans.external_post_id — single batch update
  const { data: plans } = await supabase
    .from('daily_content_plans')
    .select('id')
    .eq('scheduled_post_id', postId);

  if (plans?.length) {
    const planIds = (plans as { id: string }[]).map((p) => p.id);
    const { error: syncError } = await supabase
      .from('daily_content_plans')
      .update({ external_post_id: platformPostId })
      .in('id', planIds);
    if (syncError) {
      console.warn(`[queries] Could not batch-sync external_post_id: ${syncError.message}`);
    }
  }

  return { applied: true };
}

/**
 * Update scheduled post on failure. See updateScheduledPostOnPublish for
 * the `expectedFromStatus` CAS contract — same shape.
 */
export async function updateScheduledPostOnFailure(
  postId: string,
  errorMessage: string,
  expectedFromStatus?: string,
  errorCode?: string,
): Promise<ScheduledPostTerminalWriteResult> {
  const updatePayload: Record<string, unknown> = {
    status: 'failed',
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  };
  // Written in the SAME update as the status when given, so a failed row never
  // exists without its classification (a code-less failure reads as uncertain
  // on thread nodes — see backend/queue/publishOutcome.ts).
  if (errorCode) updatePayload.error_code = errorCode;

  if (expectedFromStatus) {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update(updatePayload)
      .eq('id', postId)
      .eq('status', expectedFromStatus)
      .select('id');
    if (error) {
      throw new Error(`Failed to update scheduled post: ${error.message}`);
    }
    const applied = Array.isArray(data) && data.length > 0;
    if (applied) await propagatePublishFailureToPlan(postId, errorMessage);
    return applied ? { applied: true } : { applied: false, reason: 'cas_mismatch' };
  }

  const { error } = await supabase
    .from('scheduled_posts')
    .update(updatePayload)
    .eq('id', postId);

  if (error) {
    throw new Error(`Failed to update scheduled post: ${error.message}`);
  }
  await propagatePublishFailureToPlan(postId, errorMessage);
  return { applied: true };
}

/**
 * Carry a publish failure back to the activity that planned it.
 *
 * Without this a failed publish left its `daily_content_plans` row reading
 * `status='planned', failure_reason=null, attempts=0` — indistinguishable from
 * an activity that simply has not run yet. Campaign 4ead230b showed exactly
 * that: the post carried "Your linkedin session has expired", the plan row
 * looked untouched, and the only way to see the failure was to open the
 * individual post.
 *
 * Placed in the canonical failure writer so every publish path inherits it
 * rather than each caller remembering. Non-fatal by construction: the post is
 * already correctly marked failed, and losing this annotation must never turn a
 * handled failure into a thrown one.
 */
async function propagatePublishFailureToPlan(postId: string, errorMessage: string): Promise<void> {
  try {
    await supabase
      .from('daily_content_plans')
      .update({
        failure_reason: String(errorMessage ?? '').slice(0, 500),
        failure_type: 'publish_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('scheduled_post_id', postId);
  } catch {
    /* annotation only — never mask the handled publish failure */
  }
}

/**
 * Get social account by ID
 */
export async function getSocialAccount(accountId: string): Promise<SocialAccount | null> {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get social account: ${error.message}`);
  }

  return data;
}

