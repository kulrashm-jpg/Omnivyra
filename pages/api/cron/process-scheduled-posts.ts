/**
 * POST /api/cron/process-scheduled-posts
 *
 * Vercel Cron Job endpoint — called every minute via vercel.json.
 * Finds all scheduled posts whose scheduled_for time has passed,
 * resolves their social account, and publishes them directly.
 *
 * Protected by CRON_SECRET env var (set in Vercel dashboard).
 * Falls back to unauthenticated if CRON_SECRET is not set (dev only).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { publishNow } from '../../../backend/services/publishNowService';
import { updatePostPublishStatus } from '../../../backend/db/scheduledPostsStore';

const BATCH_SIZE = 20; // Max posts to process per invocation

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now = new Date().toISOString();
  const results = { processed: 0, published: 0, failed: 0, skipped: 0, errors: [] as string[] };

  try {
    // Fetch due posts — status=scheduled, scheduled_for <= now
    const { data: duePosts, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, social_account_id, platform, campaign_id, status')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw new Error(`DB fetch error: ${fetchErr.message}`);
    if (!duePosts?.length) {
      return res.status(200).json({ ...results, message: 'No due posts' });
    }

    results.processed = duePosts.length;

    for (const post of duePosts) {
      try {
        // Resolve social account — use stored one or look up by user+platform
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
          // No connected account — mark as failed so it doesn't retry endlessly
          await updatePostPublishStatus({
            post_id: post.id,
            status: 'FAILED',
            last_error: `No connected ${post.platform} account`,
          });
          results.skipped++;
          continue;
        }

        // Patch post row with resolved account if it was missing
        if (!post.social_account_id) {
          await supabase
            .from('scheduled_posts')
            .update({ social_account_id: socialAccountId })
            .eq('id', post.id);
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

        if (result.status === 'PUBLISHED') {
          results.published++;
        } else {
          results.failed++;
          if (result.message) results.errors.push(`[${post.id}] ${result.message}`);
        }
      } catch (postErr: any) {
        results.failed++;
        results.errors.push(`[${post.id}] ${postErr?.message}`);
        try {
          await updatePostPublishStatus({
            post_id: post.id,
            status: 'FAILED',
            last_error: postErr?.message || 'Unexpected error',
          });
        } catch (_) {}
      }
    }

    console.log('[cron/process-scheduled-posts]', results);
    return res.status(200).json(results);
  } catch (err: any) {
    console.error('[cron/process-scheduled-posts] fatal:', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
