
/**
 * GET /api/admin/images/health
 * Returns image service metrics: cache stats, rate limit state, counters.
 * Super-admin only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { getImageServiceMetrics } from '@/backend/services/imageService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'health:images');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/images/health', 'health:images');
  }

  return res.status(200).json(getImageServiceMetrics());
}
