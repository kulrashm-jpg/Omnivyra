import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Media Management API
 * GET    /api/media/[id] - Get media file    (owner or platform SUPER_ADMIN)
 * DELETE /api/media/[id] - Delete media file (owner or platform SUPER_ADMIN)
 *
 * MEDIA-SEC-001. Both methods previously ran with NO authentication and NO
 * ownership check, against the SERVICE-ROLE client. Anyone who knew or guessed
 * a media id could read any tenant's file metadata, and DELETE destroyed both
 * the storage object and the row — an unauthenticated, cross-tenant,
 * irreversible write. Both are now owner-scoped.
 *
 * Unauthorized access returns 404, not 403: a 403 would confirm that a given
 * media id exists, turning this route into an existence oracle for id
 * enumeration. "Not yours" and "not there" are deliberately indistinguishable.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getMediaFile, deleteMediaFile } from '../../../backend/services/mediaService';
import { requireMediaCaller, ownsRow } from '../../../backend/services/mediaAuthorization';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Media ID is required' });
  }

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await requireMediaCaller(req, res);
  if (!caller) return;

  // Resolve once, authorize once — both methods need the row's owner, and a
  // single fetch keeps the GET and DELETE decisions from drifting apart.
  let mediaFile;
  try {
    mediaFile = await getMediaFile(id);
  } catch (error: any) {
    console.error('Get media error:', error);
    return res.status(500).json({ error: 'Failed to get media file', message: error.message });
  }

  if (!mediaFile || !ownsRow(caller, mediaFile as { user_id?: string | null })) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: mediaFile });
  }

  try {
    await deleteMediaFile(id);
    return res.status(200).json({ success: true, message: 'Media file deleted successfully' });
  } catch (error: any) {
    console.error('Delete media error:', error);
    return res.status(500).json({ error: 'Failed to delete media file', message: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/media/:id' });
