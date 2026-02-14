import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';
import {
  getScheduledPostById,
  updatePostPublishStatus,
} from '../../../backend/db/scheduledPostsStore';
import { publishScheduledPost } from '../../../backend/services/socialPlatformPublisher';

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
    const post = await getScheduledPostById(post_id);
    if (!post) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }
    if (!post.campaign_id) {
      return res.status(400).json({ error: 'Scheduled post missing campaign_id' });
    }

    const result = await publishScheduledPost(
      {
        post_id: post.id,
        platform: post.platform as any,
        content: post.content,
        hashtags: post.hashtags || undefined,
        seo_meta: {
          title: (post as any).title || undefined,
          description: post.content?.slice(0, 200) || undefined,
        },
        scheduled_time: post.scheduled_for || new Date().toISOString(),
        campaign_id: post.campaign_id,
      },
      { dry_run: dry_run ?? true, admin_override: true }
    );

    await updatePostPublishStatus({
      post_id: post.id,
      status: result.status,
      external_post_id: result.external_post_id,
      last_error: result.status === 'PUBLISHED' ? undefined : result.message,
    });

    return res.status(200).json(result);
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
