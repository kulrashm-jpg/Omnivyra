// API Endpoints for Scheduling and Posting
import { NextApiRequest, NextApiResponse } from 'next';
import { SchedulingService } from '@/lib/services/scheduling';
import { PostingServiceFactory } from '@/lib/services/posting';
import { ScheduledPost } from '@/lib/types/scheduling';

const schedulingService = new SchedulingService();

// GET /api/schedule/posts - Get all scheduled posts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { platform, status, limit = '50', offset = '0' } = req.query;
      
      const posts = await schedulingService.getScheduledPosts(
        platform as string,
        status as string
      );
      
      // Apply pagination
      const start = parseInt(offset as string);
      const end = start + parseInt(limit as string);
      const paginatedPosts = posts.slice(start, end);
      
      res.status(200).json({
        success: true,
        data: paginatedPosts,
        pagination: {
          total: posts.length,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          hasMore: end < posts.length,
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
      const scheduledPost = await schedulingService.schedulePost({
        platform: postData.platform,
        contentType: postData.contentType || 'post',
        content: postData.content,
        mediaUrls: postData.mediaUrls || [],
        hashtags: postData.hashtags || [],
        scheduledFor: new Date(postData.scheduledFor),
        status: 'draft',
      });

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























