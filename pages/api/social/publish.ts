import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';
import { getScheduledPost } from '../../../backend/db/queries';
import { updatePostPublishStatus } from '../../../backend/db/scheduledPostsStore';
import { publishNow } from '../../../backend/services/publishNowService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { post_id, dry_run } = req.body || {};
  if (!post_id) {
    return res.status(400).json({ error: 'post_id is required' });
  }

  try {
    const post = await getScheduledPost(post_id);
    if (!post) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }
    if (!post.campaign_id) {
      return res.status(400).json({ error: 'Scheduled post missing campaign_id' });
    }

    if (dry_run) {
      return res.status(200).json({
        status: 'DRY_RUN',
        platform: post.platform,
        payload_preview: {
          platform: post.platform,
          content: post.content?.slice(0, 200),
          scheduled_time: post.scheduled_for,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await publishNow({
      scheduled_post_id: post.id,
      social_account_id: post.social_account_id,
      user_id: post.user_id,
    });

    await updatePostPublishStatus({
      post_id: post.id,
      status: result.status,
      external_post_id: result.external_post_id,
      last_error: result.status === 'PUBLISHED' ? undefined : result.message,
    });

    return res.status(200).json({
      status: result.status,
      platform: post.platform,
      external_post_id: result.external_post_id,
      message: result.message,
      timestamp: result.timestamp,
    });
  } catch (error: any) {
    console.error('Error publishing scheduled post:', error);
    try {
      await updatePostPublishStatus({
        post_id,
        status: 'FAILED',
        last_error: 'Publish failed',
      });
    } catch (updateError) {
      console.error('Failed to update scheduled post status after error');
    }
    return res.status(500).json({ error: 'Failed to publish scheduled post' });
  }
}
