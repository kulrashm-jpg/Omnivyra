import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * RETIRED (Phase E convergence). Provider webhooks now go through the single
 * orchestrator path: POST /api/webhooks/payments/:provider (verify + record +
 * idempotent fulfillment). This duplicate async allocator is disabled so only
 * one path ever allocates credits.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'gone',
    message: 'Retired. Razorpay webhooks now use /api/webhooks/payments/razorpay.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/webhooks/razorpay-staging' });
