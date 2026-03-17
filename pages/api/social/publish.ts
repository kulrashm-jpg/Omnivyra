import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';
import { getScheduledPost } from '../../../backend/db/queries';
import { updatePostPublishStatus } from '../../../backend/db/scheduledPostsStore';
import { publishNow } from '../../../backend/services/publishNowService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    // Allow: post owner OR super-admin
    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin && post.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden: you do not own this post' });
    }

    // Resolve social_account_id — fall back to user's connected account for this platform
    let socialAccountId: string | null = post.social_account_id || null;
    if (!socialAccountId) {
      const platformNorm = post.platform === 'x' ? 'twitter' : post.platform;
      const { data: acct } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', post.user_id)
        .eq('is_active', true)
        .in('platform', [post.platform, platformNorm])
        .limit(1)
        .maybeSingle();
      socialAccountId = acct?.id ?? null;
    }

    if (!socialAccountId) {
      return res.status(422).json({
        error: `No connected ${post.platform} account found. Please connect your account in Settings → Social Accounts.`,
      });
    }

    // Patch the post row with the resolved account so publishNow and future jobs use it
    if (!post.social_account_id) {
      await supabase
        .from('scheduled_posts')
        .update({ social_account_id: socialAccountId })
        .eq('id', post.id);
    }

    if (dry_run) {
      return res.status(200).json({
        status: 'DRY_RUN',
        platform: post.platform,
        social_account_id: socialAccountId,
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
      social_account_id: socialAccountId,
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
      post_url: result.post_url,
      message: result.message,
      timestamp: result.timestamp,
    });
  } catch (error: any) {
    console.error('[publish] error:', error);
    try {
      await updatePostPublishStatus({
        post_id,
        status: 'FAILED',
        last_error: error?.message || 'Publish failed',
      });
    } catch (_) {}
    return res.status(500).json({ error: error?.message || 'Failed to publish scheduled post' });
  }
}
