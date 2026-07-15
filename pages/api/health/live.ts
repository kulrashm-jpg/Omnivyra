import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/health/live
 * Liveness probe — returns 200 if the process is alive.
 * Used by Railway / load balancers to check if the app is running.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({ status: 'ok', ts: Date.now() });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/health/live' });
