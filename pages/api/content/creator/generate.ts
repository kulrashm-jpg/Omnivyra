import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Deprecated standalone Creator generation endpoint.
 *
 * Unified creator execution now only runs through the BOLT pipeline and
 * `daily_content_plans` using `campaign_mode: 'creator'`.
 */
async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Standalone creator generation has been deprecated.',
    message: 'Use BOLT Creator pipeline execution through daily_content_plans.',
    pipeline_only: true,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content/creator/generate' });
