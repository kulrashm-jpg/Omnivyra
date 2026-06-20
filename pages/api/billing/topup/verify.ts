/**
 * RETIRED (Phase E convergence). The single commercial top-up path is the
 * Payment Orchestrator: POST /api/billing/checkout/verify.
 * Disabled to guarantee one and only one allocating flow.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: 'gone',
    message: 'Retired. Use POST /api/billing/checkout/verify.',
  });
}
