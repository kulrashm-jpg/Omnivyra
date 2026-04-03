
/**
 * List Media Files API
 * GET /api/media/list
 * 
 * Query parameters:
 * - user_id (optional)
 * - campaign_id (optional)
 * - media_type (optional: image, video, audio, document)
 * - limit (optional, default: 50)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { listMediaFiles } from '../../../backend/services/mediaService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, campaign_id, media_type, limit } = req.query;

    const options: any = {};

    if (user_id && typeof user_id === 'string') {
      options.userId = user_id;
    }

    if (campaign_id && typeof campaign_id === 'string') {
      options.campaignId = campaign_id;
    }

    if (media_type && typeof media_type === 'string') {
      if (!['image', 'video', 'audio', 'document'].includes(media_type)) {
        return res.status(400).json({ error: 'Invalid media_type. Must be: image, video, audio, or document' });
      }
      options.mediaType = media_type as any;
    }

    if (limit && typeof limit === 'string') {
      options.limit = parseInt(limit, 10);
    } else {
      options.limit = 50; // Default limit
    }

    const mediaFiles = await listMediaFiles(options);

    res.status(200).json({
      success: true,
      data: mediaFiles,
      count: mediaFiles.length,
    });
  } catch (error: any) {
    console.error('List media error:', error);
    res.status(500).json({
      error: 'Failed to list media files',
      message: error.message,
    });
  }
}
