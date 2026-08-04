import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Link Media to Post API
 * POST /api/media/link
 *
 * Links a media file to a scheduled post. The caller must own BOTH sides.
 *
 * MEDIA-SEC-001. This route previously had NO authentication and NO ownership
 * check on either id, writing straight into `scheduled_post_media` on the
 * SERVICE-ROLE client. That allowed an anonymous caller to attach any tenant's
 * media to any tenant's scheduled post — a cross-tenant write that also
 * exfiltrates the media into someone else's outbound publication.
 *
 * Both sides are checked because owning one is not enough: owning the media
 * but not the post publishes your asset from a stranger's account, and owning
 * the post but not the media pulls a stranger's asset into your publication.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { linkMediaToPost } from '../../../backend/services/mediaService';
import {
  requireMediaCaller,
  ownsMediaFile,
  ownsScheduledPost,
} from '../../../backend/services/mediaAuthorization';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireMediaCaller(req, res);
  if (!caller) return;

  try {
    const { scheduled_post_id, media_file_id, display_order } = req.body ?? {};

    if (!scheduled_post_id || typeof scheduled_post_id !== 'string'
      || !media_file_id || typeof media_file_id !== 'string') {
      return res.status(400).json({ error: 'scheduled_post_id and media_file_id are required' });
    }

    const [ownsMedia, ownsPost] = await Promise.all([
      ownsMediaFile(caller, media_file_id),
      ownsScheduledPost(caller, scheduled_post_id),
    ]);

    // One response for both failure modes, so the route cannot be used to
    // probe which of the two ids exists.
    if (!ownsMedia || !ownsPost) {
      return res.status(404).json({ error: 'Media file or scheduled post not found' });
    }

    const order = Number(display_order);
    await linkMediaToPost(
      scheduled_post_id,
      media_file_id,
      Number.isFinite(order) && order >= 0 ? Math.floor(order) : 0,
    );

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/media/link' });
