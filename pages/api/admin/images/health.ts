/**
 * GET /api/admin/images/health
 * Returns image service metrics: cache stats, rate limit state, counters.
 * Super-admin only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '@/backend/middleware/requireSuperAdmin';
import { getImageServiceMetrics } from '@/backend/services/imageService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await requireSuperAdmin(req, res);
  if (!isAdmin) return;

  return res.status(200).json(getImageServiceMetrics());
}
