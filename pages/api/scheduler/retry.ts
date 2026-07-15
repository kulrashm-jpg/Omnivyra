import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';

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
    .select('id, user_id, social_account_id, status, platform')
    .eq('id', scheduledPostId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (postError || !post) {
    return res.status(404).json({ error: 'Scheduled post not found', code: 'NOT_FOUND' });
  }
  if (post.status !== 'failed') {
    return res.status(409).json({
      error: `Only failed posts can be retried (current status: ${post.status}).`,
      code: 'NOT_RETRYABLE',
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
  const { error: resetError } = await supabase
    .from('scheduled_posts')
    .update({ status: 'scheduled', error_message: null, error_code: null, scheduled_for: scheduledFor })
    .eq('id', scheduledPostId)
    .eq('user_id', user.id);
  if (resetError) {
    return res.status(500).json({ error: 'Failed to reset post for retry', code: 'RESET_FAILED' });
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
