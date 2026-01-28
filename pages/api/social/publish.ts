import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getScheduledPostById,
  updatePostPublishStatus,
} from '../../../backend/db/scheduledPostsStore';
import { publishScheduledPost } from '../../../backend/services/socialPlatformPublisher';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const userId = 'current-user-id';
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can publish scheduled posts.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAdmin = await ensureSuperAdmin(req, res);
  if (!isAdmin) return;

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
