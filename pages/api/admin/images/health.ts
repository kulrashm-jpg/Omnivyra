import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/admin/images/health
 * Returns image service metrics: cache stats, rate limit state, counters.
 * Super-admin only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '@/backend/middleware/requireSuperAdmin';
import { getImageServiceMetrics } from '@/backend/services/imageService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await requireSuperAdmin(req, res);
  if (!isAdmin) return;

  return res.status(200).json(getImageServiceMetrics());
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/images/health' });
