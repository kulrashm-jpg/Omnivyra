import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/health
 * Cloudflare health probe + Railway healthcheck target for Vercel.
 * Must be unauthenticated and fast (<100ms).
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', ts: Date.now() });
}
