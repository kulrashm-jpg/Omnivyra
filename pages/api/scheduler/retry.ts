import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { cancelScheduledPostQueueEntry, enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';
import { hasUncertainOutcome, PUBLISH_OUTCOME_UNCERTAIN } from '@/backend/queue/publishOutcome';

/**
 * POST /api/scheduler/retry   (BETA-007 · RULE 3)
 *
 * Manually retry a FAILED scheduled post after automatic BullMQ retries are exhausted.
 * Resets it to 'scheduled', clears the error, and re-enqueues a fresh publish job (which
 * gets its own attempts+backoff). Ownership is the same user_id scoping as
 * /api/scheduler/posts. Reuses the existing scheduler — no new queue/worker.
 *
 * Body: { scheduled_post_id: string }
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
    .select('id, user_id, social_account_id, status, platform, error_code, platform_post_id, parent_post_id')
    .eq('id', scheduledPostId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (postError || !post) {
    return res.status(404).json({ error: 'Scheduled post not found', code: 'NOT_FOUND' });
  }
  // A thread child is published only by its thread (as a reply, once). Retried
  // on its own it would be re-queued as a standalone post.
  if (post.parent_post_id) {
    return res.status(409).json({
      error: 'This post is part of a thread. Retry the thread from its first post instead.',
      code: 'THREAD_CHILD_NOT_RETRYABLE',
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

  // Reset for a clean re-run and fire almost immediately (delay > 0 so it enqueues
  // directly rather than deferring to the safety-net cron).
  const scheduledFor = new Date(Date.now() + 3000).toISOString();

  // Retire the job this retry supersedes BEFORE creating its replacement. A
  // post can be 'failed' while its last job still sits in BullMQ backoff (its
  // queue_jobs row 'failed' too, retry pending): left alone, that job is
  // delivered again, claims the post this route is about to make claimable,
  // and the new job publishes it a second time. The cancel is database-first —
  // the worker refuses a cancelled row even if removing the BullMQ job fails.
  //
  // A DATABASE error here means the old job's state is unknown, so nothing is
  // reset and nothing is enqueued. A BullMQ removal error alone does not block:
  // the row is already 'cancelled', which is what the worker obeys.
  const cancel = await cancelScheduledPostQueueEntry(scheduledPostId, { reason: 'superseded_by_manual_retry' });
  if (cancel.errors.some((e) => e.startsWith('queue_jobs'))) {
    return res.status(503).json({
      status: 'failed',
      error: 'Could not retire the previous publish job. Nothing was changed; please retry.',
      code: 'PRIOR_JOB_CANCEL_FAILED',
      retryable: true,
    });
  }

  // Compare-and-set on 'failed' AND the error_code read: the checks above were
  // a read. A delivery that claimed the post since then must not have its
  // claim overwritten back to 'scheduled', and a post whose outcome became
  // uncertain since then must not be cleared.
  let reset = supabase
    .from('scheduled_posts')
    .update({ status: 'scheduled', error_message: null, error_code: null, scheduled_for: scheduledFor })
    .eq('id', scheduledPostId)
    .eq('user_id', user.id)
    .eq('status', 'failed');
  reset = post.error_code == null ? reset.is('error_code', null) : reset.eq('error_code', post.error_code);
  const { data: resetRows, error: resetError } = await reset.select('id');
  if (resetError) {
    return res.status(500).json({ error: 'Failed to reset post for retry', code: 'RESET_FAILED' });
  }
  if (!Array.isArray(resetRows) || resetRows.length === 0) {
    return res.status(409).json({
      error: 'The post changed while the retry was being prepared. Refresh and try again.',
      code: 'NOT_RETRYABLE',
    });
  }

  try {
    const result = await enqueueScheduledPostAt(
      scheduledPostId,
      user.id,
      post.social_account_id,
      scheduledFor,
    );
    return res.status(200).json({
      status: 'requeued',
      enqueue: result, // 'enqueued' | 'duplicate' | 'past'
      message:
        result === 'duplicate'
          ? 'A publish job is already in progress for this post.'
          : 'Post re-queued for publishing.',
    });
  } catch (err: any) {
    return res.status(502).json({
      status: 'failed',
      error: `Failed to re-queue post: ${err?.message || 'unknown error'}`,
      code: 'ENQUEUE_FAILED',
      retryable: true,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/scheduler/retry' });
