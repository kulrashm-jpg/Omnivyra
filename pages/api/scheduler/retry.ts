import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { cancelScheduledPostQueueEntry, enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { randomUUID } from 'crypto';
import {
  hasUncertainOutcome,
  PUBLISH_OUTCOME_UNCERTAIN,
  retryClaimState,
  retryPreparingCode,
} from '@/backend/queue/publishOutcome';

/**
 * POST /api/scheduler/retry   (BETA-007 · RULE 3)
 *
 * Manually retry a FAILED scheduled post after automatic BullMQ retries are exhausted.
 * Resets it to 'scheduled', clears the error, and re-enqueues a fresh publish job (which
 * gets its own attempts+backoff). Ownership is the same user_id scoping as
 * /api/scheduler/posts. Reuses the existing scheduler — no new queue/worker.
 *
 * Body: { scheduled_post_id: string }
 *
 * TENANT authority (Closure-010, owner decision): this is the post OWNER's
 * retry of their own definitely-failed post — deliberately NOT a platform
 * recovery route (those need publish.recovery.manage + step-up + an active
 * platform SUPER_ADMIN). Identity is the authenticated session only; every
 * read and write is pinned to `user_id = session user`, so another member of
 * the same company and another tenant both get the same 404. Retryable means
 * status 'failed', no published identity (platform_post_id), no uncertain or
 * call-started outcome, not a thread child; everything else is refused before
 * anything is cancelled or reset.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const scheduledPostId =
    typeof req.body?.scheduled_post_id === 'string' ? req.body.scheduled_post_id : null;
  if (!scheduledPostId) {
    return res.status(400).json({ error: 'scheduled_post_id is required', code: 'POST_ID_REQUIRED' });
  }

  // Ownership: a user can only retry their own posts (same scoping as the list endpoint).
  const { data: post, error: postError } = await supabase
    .from('scheduled_posts')
    .select('id, user_id, social_account_id, status, platform, error_code, error_message, scheduled_for, platform_post_id, parent_post_id')
    .eq('id', scheduledPostId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (postError || !post) {
    return res.status(404).json({ error: 'Scheduled post not found', code: 'NOT_FOUND' });
  }
  // The state this retry read — what every compare-and-set below pins, and
  // what a failed retry restores. Copied: later writes must not change it.
  const read = {
    error_code: (post.error_code ?? null) as string | null,
    error_message: (post.error_message ?? null) as string | null,
    scheduled_for: (post.scheduled_for ?? null) as string | null,
  };
  // A thread child is published only by its thread (as a reply, once). Retried
  // on its own it would be re-queued as a standalone post.
  if (post.parent_post_id) {
    return res.status(409).json({
      error: 'This post is part of a thread. Retry the thread from its first post instead.',
      code: 'THREAD_CHILD_NOT_RETRYABLE',
    });
  }
  // A published identity is never "definitely failed": a failure write that
  // landed on a row a concurrent execution had just published (the unguarded
  // updateScheduledPostOnFailure branch) leaves status 'failed' beside a
  // platform_post_id. Refused, not reset (Closure-010).
  if (post.platform_post_id) {
    return res.status(409).json({
      error: 'This post is already published on the platform; there is nothing to retry.',
      code: 'POST_ALREADY_PUBLISHED',
    });
  }
  if (post.status !== 'failed') {
    return res.status(409).json({
      error: `Only failed posts can be retried (current status: ${post.status}).`,
      code: 'NOT_RETRYABLE',
    });
  }
  // A failure whose outcome is uncertain may already be LIVE on the platform.
  // A retry would publish it again, so it is refused here — before anything is
  // cancelled or reset — until an authorized operator has reconciled it
  // (POST /api/super-admin/publish/reconcile). Reconciled as 'not_published',
  // the post carries PUBLISH_RECONCILED_NOT_PUBLISHED and this retry is the
  // deliberate next step.
  if (hasUncertainOutcome(post)) {
    return res.status(409).json({
      error:
        'This post may already have been published: the last attempt reached the platform but its result ' +
        'was not saved. Check the platform and have the outcome reconciled before retrying.',
      code: PUBLISH_OUTCOME_UNCERTAIN,
      requires: 'reconciliation',
    });
  }
  if (!post.social_account_id) {
    return res.status(409).json({
      error: 'This post has no connected account to publish from. Reconnect the account, then retry.',
      code: 'NO_SOCIAL_ACCOUNT',
    });
  }

  // A retry already holds this post. While it may still be acting (cancelling
  // jobs, resetting, enqueueing) a second retry must not act too: its cancel
  // could retire the job the first one is about to create (Closure-014C). Only
  // a claim older than any request can live is taken over (crash recovery).
  if (retryClaimState(read.error_code, Date.now()) === 'live') {
    return res.status(409).json({
      error: 'A retry of this post is already in progress. Wait a moment, then refresh.',
      code: 'RETRY_IN_PROGRESS',
    });
  }

  // ── 1. Claim the post, compare-and-set on what was read ─────────────────
  // The checks above were a read. The claim pins 'failed', no published
  // identity and the exact error_code read, so a delivery that claimed the post
  // since, an outcome that became uncertain since, or a concurrent retry that
  // claimed first all make it match nothing — and then NOTHING is touched.
  // Before Closure-014C the prior jobs were cancelled first and the
  // compare-and-set came last, so a losing concurrent retry could cancel the
  // job the winning retry had just queued, stranding a 'scheduled' post with
  // no live job. The post stays 'failed' while claimed: no publisher claims a
  // failed post, so the job being retired cannot pick it up meanwhile.
  const claimCode = retryPreparingCode(Date.now(), randomUUID());
  const pinRead = <Q extends { is: (c: string, v: null) => Q; eq: (c: string, v: string) => Q }>(q: Q): Q =>
    (read.error_code == null ? q.is('error_code', null) : q.eq('error_code', read.error_code));
  const { data: claimRows, error: claimError } = await pinRead(
    supabase
      .from('scheduled_posts')
      .update({ error_code: claimCode })
      .eq('id', scheduledPostId)
      .eq('user_id', user.id)
      .eq('status', 'failed')
      .is('platform_post_id', null),
  ).select('id');
  if (claimError) {
    return res.status(500).json({ error: 'Failed to prepare the post for retry. Nothing was changed.', code: 'RETRY_CLAIM_FAILED' });
  }
  if (!Array.isArray(claimRows) || claimRows.length === 0) {
    return res.status(409).json({
      error: 'The post changed while the retry was being prepared. Refresh and try again.',
      code: 'NOT_RETRYABLE',
    });
  }

  // Give the claim back (compare-and-set on it) after a step that changed nothing.
  const releaseClaim = async (): Promise<boolean> => {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update({ error_code: read.error_code })
      .eq('id', scheduledPostId)
      .eq('user_id', user.id)
      .eq('status', 'failed')
      .eq('error_code', claimCode)
      .select('id');
    return !error && Array.isArray(data) && data.length > 0;
  };

  // ── 2. Retire the job this retry supersedes (claim holder only) ─────────
  // A post can be 'failed' while its last job still sits in BullMQ backoff (its
  // queue_jobs row 'failed' too, retry pending): left alone, that job is
  // delivered again, claims the post once it is reset, and the new job
  // publishes it a second time. The cancel is database-first — the worker
  // refuses a cancelled row even if removing the BullMQ job fails.
  //
  // A DATABASE error here means the old job's state is unknown, so nothing is
  // reset and nothing is enqueued; the claim is released. A BullMQ removal
  // error alone does not block: the row is already 'cancelled', which is what
  // the worker obeys.
  const cancel = await cancelScheduledPostQueueEntry(scheduledPostId, { reason: 'superseded_by_manual_retry' });
  if (cancel.errors.some((e) => e.startsWith('queue_jobs'))) {
    const released = await releaseClaim();
    return res.status(503).json({
      status: 'failed',
      error: released
        ? 'Could not retire the previous publish job. Nothing was changed; please retry.'
        : 'Could not retire the previous publish job. The post was not re-queued; please retry.',
      code: 'PRIOR_JOB_CANCEL_FAILED',
      retryable: true,
    });
  }

  // ── 3. Reset, compare-and-set on this retry's own claim ─────────────────
  // Fire almost immediately (delay > 0 so it enqueues directly rather than
  // deferring to the safety-net cron); computed after the cancel so the
  // margin is not spent on it.
  const scheduledFor = new Date(Date.now() + 3000).toISOString();
  const { data: resetRows, error: resetError } = await supabase
    .from('scheduled_posts')
    .update({ status: 'scheduled', error_message: null, error_code: null, scheduled_for: scheduledFor })
    .eq('id', scheduledPostId)
    .eq('user_id', user.id)
    .eq('status', 'failed')
    .is('platform_post_id', null)
    .eq('error_code', claimCode)
    .select('id');
  if (resetError) {
    const released = await releaseClaim();
    return res.status(500).json({
      error: 'Failed to reset post for retry. It was not re-queued.',
      code: 'RESET_FAILED',
      ...(released ? {} : { recovery: 'retry_again' }),
    });
  }
  if (!Array.isArray(resetRows) || resetRows.length === 0) {
    return res.status(409).json({
      error: 'The post changed while the retry was being prepared. Refresh and try again.',
      code: 'NOT_RETRYABLE',
    });
  }

  // ── 4. Queue the replacement ────────────────────────────────────────────
  // If nothing ends up queued, the post goes back to exactly the failed state
  // it had (compare-and-set on the reset this retry wrote), so it is never
  // left 'scheduled' with no live job and the retry can simply be repeated.
  const restoreFailed = async (): Promise<boolean> => {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .update({ status: 'failed', error_code: read.error_code, error_message: read.error_message, scheduled_for: read.scheduled_for })
      .eq('id', scheduledPostId)
      .eq('user_id', user.id)
      .eq('status', 'scheduled')
      .is('error_code', null)
      .eq('scheduled_for', scheduledFor)
      .select('id');
    return !error && Array.isArray(data) && data.length > 0;
  };
  let result: Awaited<ReturnType<typeof enqueueScheduledPostAt>>;
  try {
    result = await enqueueScheduledPostAt(
      scheduledPostId,
      user.id,
      post.social_account_id,
      scheduledFor,
    );
  } catch (err: any) {
    const restored = await restoreFailed();
    return res.status(502).json({
      status: 'failed',
      error: `Failed to re-queue post: ${err?.message || 'unknown error'}`,
      code: 'ENQUEUE_FAILED',
      retryable: true,
      post_restored: restored,
    });
  }
  if (result === 'past') {
    // The fire time passed before the job could be queued, so none was.
    const restored = await restoreFailed();
    return res.status(503).json({
      status: 'failed',
      error: 'The retry took too long to queue and was not queued. Please retry.',
      code: 'RETRY_NOT_QUEUED',
      retryable: true,
      post_restored: restored,
    });
  }
  return res.status(200).json({
    status: 'requeued',
    enqueue: result, // 'enqueued' | 'duplicate'
    message:
      result === 'duplicate'
        ? 'A publish job is already in progress for this post.'
        : 'Post re-queued for publishing.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/scheduler/retry' });
