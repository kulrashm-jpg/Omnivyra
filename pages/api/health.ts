import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/health
 * Cloudflare health probe + Railway healthcheck target for Vercel.
 * Must be unauthenticated and fast (<100ms).
 */
function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', ts: Date.now() });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/health' });
