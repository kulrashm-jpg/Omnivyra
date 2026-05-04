import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
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

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

