import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/engagement/capabilities
 *
 * Returns the current (platform, action) capability matrix so any client
 * can gate its UI without duplicating the map. Static response in this
 * version â€” no per-org variance yet.
 *
 * Shape:
 *   {
 *     engagement_platforms: string[],  // inbox-surface platforms
 *     publish_platforms:    string[],  // post_create-verified platforms
 *     matrix: {
 *       [platform]: {
 *         reply:       { status, mode?, account_type?, reason? },
 *         like:        { ... },
 *         dm:          { ... },
 *         post_create: { ... }
 *       }
 *     }
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  ENGAGEMENT_CAPABILITY_MATRIX,
  VERIFIED_ENGAGEMENT_PLATFORMS,
  VERIFIED_PUBLISH_PLATFORMS,
} from '../../../backend/services/engagementCapabilityMap';

function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cache for 5 minutes; the matrix is static between deploys.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json({
    engagement_platforms: [...VERIFIED_ENGAGEMENT_PLATFORMS],
    publish_platforms: [...VERIFIED_PUBLISH_PLATFORMS],
    matrix: ENGAGEMENT_CAPABILITY_MATRIX,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

