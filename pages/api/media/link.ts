
/**
 * Link Media to Post API
 * POST /api/media/link
 * 
 * Links a media file to a scheduled post.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { linkMediaToPost } from '../../../backend/services/mediaService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { scheduled_post_id, media_file_id, display_order } = req.body;

    if (!scheduled_post_id || !media_file_id) {
      return res.status(400).json({ error: 'scheduled_post_id and media_file_id are required' });
    }

    await linkMediaToPost(scheduled_post_id, media_file_id, display_order || 0);

    res.status(200).json({
      success: true,
      message: 'Media linked to post successfully',
    });
  } catch (error: any) {
    console.error('Link media error:', error);
    res.status(500).json({
      error: 'Failed to link media to post',
      message: error.message,
    });
  }
}
