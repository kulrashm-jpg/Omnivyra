// API Endpoint for Content Validation
import { NextApiRequest, NextApiResponse } from 'next';
import { PostingServiceFactory } from '@/lib/services/posting';
import { ScheduledPost } from '@/lib/types/scheduling';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, content, contentType = 'post', mediaUrls = [], hashtags = [] } = req.body;

    if (!platform || !content) {
      return res.status(400).json({
        success: false,
        error: 'Platform and content are required',
      });
    }

    // Get posting service for the platform
    const postingService = PostingServiceFactory.getService(platform);
    
    if (!postingService) {
      return res.status(400).json({
        success: false,
        error: `Platform ${platform} not supported`,
      });
    }

    // Create a mock scheduled post for validation
    const mockPost: ScheduledPost = {
      id: 'validation_post',
      platform,
      contentType,
      content,
      mediaUrls,
      hashtags,
      scheduledFor: new Date(),
      status: 'draft',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Validate the content
    const validation = await postingService.validate(mockPost);

    res.status(200).json({
      success: true,
      data: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        platform,
        contentType,
        characterCount: content.length,
        hashtagCount: hashtags.length,
        mediaCount: mediaUrls.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}























