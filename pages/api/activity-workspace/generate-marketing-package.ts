import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Deprecated standalone marketing-package endpoint.
 *
 * Creator packaging is now generated inside CreatorExecutionEngine as part of
 * the BOLT Creator pipeline and stored on `daily_content_plans.content`.
 */
async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'Standalone creator packaging has been deprecated.',
    message: 'Packaging is generated inside CreatorExecutionEngine during BOLT pipeline execution.',
    pipeline_only: true,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/activity-workspace/generate-marketing-package' });
