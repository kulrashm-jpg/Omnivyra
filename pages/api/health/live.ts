import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/health/live
 * Liveness probe â€” returns 200 if the process is alive.
 * Used by Railway / load balancers to check if the app is running.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({ status: 'ok', ts: Date.now() });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

