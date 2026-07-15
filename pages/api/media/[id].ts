import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Media Management API
 * GET /api/media/[id] - Get media file
 * DELETE /api/media/[id] - Delete media file
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getMediaFile, deleteMediaFile, getPostMedia } from '../../../backend/services/mediaService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Media ID is required' });
  }

  if (req.method === 'GET') {
    try {
      const mediaFile = await getMediaFile(id);
      
      if (!mediaFile) {
        return res.status(404).json({ error: 'Media file not found' });
      }

      res.status(200).json({
        success: true,
        data: mediaFile,
      });
    } catch (error: any) {
      console.error('Get media error:', error);
      res.status(500).json({
        error: 'Failed to get media file',
        message: error.message,
      });
    }
  } else if (req.method === 'DELETE') {
    try {
      await deleteMediaFile(id);

      res.status(200).json({
        success: true,
        message: 'Media file deleted successfully',
      });
    } catch (error: any) {
      console.error('Delete media error:', error);
      res.status(500).json({
        error: 'Failed to delete media file',
        message: error.message,
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/media/:id' });
