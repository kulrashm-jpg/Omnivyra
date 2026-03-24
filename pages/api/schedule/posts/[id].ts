// LEGACY ENGINE - DO NOT EXTEND
// Scheduled for removal after DB-platform intelligence cutover.
// API Endpoint for Individual Post Management
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import {
  cancelLegacyScheduledPost,
  getLegacyScheduledPostById,
  publishLegacyScheduledPostNow,
  updateLegacyScheduledPost,
} from '@/backend/services/structuredPlanScheduler';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`[NEW SCHEDULER ACTIVE] invoked pages/api/schedule/posts/[id].ts handler (${req.method || 'unknown'})`);
  const userId = await requireUserId(req, res);
  if (!userId) return;

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Post ID is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        // Get specific post
        const post = await getLegacyScheduledPostById({ userId, id });
        
        if (!post) {
          return res.status(404).json({
            success: false,
            error: 'Post not found',
          });
        }

        res.status(200).json({
          success: true,
          data: post,
        });
        break;

      case 'PUT':
        // Update post
        const updateData = req.body;
        
        // Validate update data
        if (!(await getLegacyScheduledPostById({ userId, id }))) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        await updateLegacyScheduledPost({
          userId,
          id,
          patch: {
            content: updateData.content,
            title: updateData.title,
            hashtags: updateData.hashtags,
            mediaUrls: updateData.mediaUrls,
            scheduledFor: updateData.scheduledFor,
            status: updateData.status,
            contentType: updateData.contentType,
          },
        });
        
        res.status(200).json({
          success: true,
          message: 'Post updated successfully',
        });
        break;

      case 'DELETE':
        // Cancel/delete post
        if (!(await getLegacyScheduledPostById({ userId, id }))) {
          return res.status(404).json({ success: false, error: 'Post not found' });
        }

        await cancelLegacyScheduledPost({ userId, id });
        
        res.status(200).json({
          success: true,
          message: 'Post cancelled successfully',
        });
        break;

      case 'POST':
        // Publish post immediately
        const postToPublish = await getLegacyScheduledPostById({ userId, id });
        
        if (!postToPublish) {
          return res.status(404).json({
            success: false,
            error: 'Post not found',
          });
        }

        // Queue for immediate publishing (DB scheduler picks up due posts)
        await publishLegacyScheduledPostNow({ userId, id });
        const result = { success: true, queued: true, postId: id };
        
        res.status(200).json({
          success: true,
          data: result,
          message: 'Post published successfully',
        });
        break;

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE', 'POST']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}























