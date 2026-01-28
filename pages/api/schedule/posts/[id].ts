// API Endpoint for Individual Post Management
import { NextApiRequest, NextApiResponse } from 'next';
import { SchedulingService } from '@/lib/services/scheduling';
import { PostingServiceFactory } from '@/lib/services/posting';

const schedulingService = new SchedulingService();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        const posts = await schedulingService.getScheduledPosts();
        const post = posts.find(p => p.id === id);
        
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
        if (updateData.scheduledFor) {
          updateData.scheduledFor = new Date(updateData.scheduledFor);
        }

        // Mock update - in production, update database
        console.log(`Updating post ${id}:`, updateData);
        
        res.status(200).json({
          success: true,
          message: 'Post updated successfully',
        });
        break;

      case 'DELETE':
        // Cancel/delete post
        await schedulingService.cancelPost(id);
        
        res.status(200).json({
          success: true,
          message: 'Post cancelled successfully',
        });
        break;

      case 'POST':
        // Publish post immediately
        const posts2 = await schedulingService.getScheduledPosts();
        const postToPublish = posts2.find(p => p.id === id);
        
        if (!postToPublish) {
          return res.status(404).json({
            success: false,
            error: 'Post not found',
          });
        }

        // Get posting service
        const postingService = PostingServiceFactory.getService(postToPublish.platform);
        if (!postingService) {
          return res.status(400).json({
            success: false,
            error: `No posting service available for ${postToPublish.platform}`,
          });
        }

        // Publish the post
        const result = await schedulingService.processPost(postToPublish);
        
        res.status(200).json({
          success: result.success,
          data: result,
          message: result.success ? 'Post published successfully' : 'Failed to publish post',
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























