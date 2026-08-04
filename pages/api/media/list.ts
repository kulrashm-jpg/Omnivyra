import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * List Media Files API
 * GET /api/media/list
 *
 * Auth: authenticated user. Results are ALWAYS scoped to the caller's own
 * media; a platform SUPER_ADMIN may target another owner via `user_id`.
 *
 * MEDIA-SEC-001. This route previously had NO authentication and treated
 * `user_id` as an OPTIONAL client-supplied filter. Omitting it made
 * `listMediaFiles` run `select('*')` with no predicate on the SERVICE-ROLE
 * client — so an anonymous request returned the most recent media rows across
 * every tenant, and supplying an arbitrary `user_id` enumerated that user.
 * The owner is now derived from the authenticated session, never from input.
 *
 * Query parameters:
 * - user_id (platform SUPER_ADMIN only; ignored for everyone else)
 * - campaign_id (optional, filters within the caller's own media)
 * - media_type (optional: image, video, audio, document)
 * - limit (optional, default: 50, max 200)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { listMediaFiles } from '../../../backend/services/mediaService';
import { requireMediaCaller, resolveListOwnerId } from '../../../backend/services/mediaAuthorization';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireMediaCaller(req, res);
  if (!caller) return;

  try {
    const { user_id, campaign_id, media_type, limit } = req.query;

    const options: any = {};

    // Never optional, never client-controlled: the tenant predicate is the
    // authenticated identity. This is what makes an unscoped read impossible.
    options.userId = resolveListOwnerId(caller, user_id);

    if (campaign_id && typeof campaign_id === 'string') {
      options.campaignId = campaign_id;
    }

    if (media_type && typeof media_type === 'string') {
      if (!['image', 'video', 'audio', 'document'].includes(media_type)) {
        return res.status(400).json({ error: 'Invalid media_type. Must be: image, video, audio, or document' });
      }
      options.mediaType = media_type as any;
    }

    // Bounded: an unbounded/NaN limit would either error or let one request
    // pull the entire owner's history.
    const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : NaN;
    options.limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 200)
      : 50;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/media/list' });
