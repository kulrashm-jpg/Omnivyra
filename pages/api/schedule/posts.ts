
// LEGACY ENGINE - DO NOT EXTEND
// Scheduled for removal after DB-platform intelligence cutover.
// API Endpoints for Scheduling and Posting
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { createLegacyScheduledPost, listLegacyScheduledPosts } from '@/backend/services/structuredPlanScheduler';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enqueueScheduledPostAt } from '@/backend/scheduler/schedulerService';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

// GET /api/schedule/posts - Get all scheduled posts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`[NEW SCHEDULER ACTIVE] invoked pages/api/schedule/posts.ts handler (${req.method || 'unknown'})`);
  const userId = await requireUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    try {
      const { platform, status, limit = '50', offset = '0' } = req.query;

      const limitNum = parseInt(String(limit), 10) || 50;
      const offsetNum = parseInt(String(offset), 10) || 0;

      const result = await listLegacyScheduledPosts({
        userId,
        platform: platform as string,
        status: status as string,
        limit: limitNum,
        offset: offsetNum,
      });

      res.status(200).json({
        success: true,
        data: result.posts,
        pagination: {
          total: result.total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < result.total,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  } else if (req.method === 'POST') {
    try {
      const postData = req.body;
      
      // Validate required fields
      if (!postData.platform || !postData.content || !postData.scheduledFor) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: platform, content, scheduledFor',
        });
      }

      // Create scheduled post
      const scheduledPost = await createLegacyScheduledPost({
        userId,
        platform: postData.platform,
        contentType: postData.contentType || 'post',
        content: postData.content,
        mediaUrls: postData.mediaUrls || [],
        hashtags: postData.hashtags || [],
        scheduledFor: postData.scheduledFor,
        title: postData.title,
      });

      try {
        const { data: row } = await supabase
          .from('scheduled_posts')
          .select('id, social_account_id, scheduled_for')
          .eq('id', scheduledPost.id)
          .eq('user_id', userId)
          .maybeSingle();

        if (row?.id && row.social_account_id && row.scheduled_for) {
          await enqueueScheduledPostAt(row.id, userId, String(row.social_account_id), String(row.scheduled_for));
        }
      } catch (enqueueError: any) {
        console.warn('[schedule/posts] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
      }

      res.status(201).json({
        success: true,
        data: scheduledPost,
        message: 'Post scheduled successfully',
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ error: 'Method not allowed' });
  }
}
