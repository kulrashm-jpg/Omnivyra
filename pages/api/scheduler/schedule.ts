import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { title, content, hashtags, mediaType, scheduledFor, platform, accountId, userId } = req.body;

    // Validate required fields
    if (!content || !scheduledFor || !platform || !accountId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate scheduled time is in the future
    if (new Date(scheduledFor) <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    // Generate a simple ID for mock data
    const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // For now, just return success - in production this would save to database
    console.log('Post scheduled:', {
      id: postId,
      title,
      content,
      hashtags,
      mediaType,
      scheduledFor,
      platform,
      accountId,
      userId
    });

    res.status(201).json({
      id: postId,
      message: 'Post scheduled successfully',
    });

  } catch (error: any) {
    console.error('Error scheduling post:', error);
    res.status(500).json({ error: error.message });
  }
}
