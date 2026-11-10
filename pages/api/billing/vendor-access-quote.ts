import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { quoteCentralVendorAccess, STANDARD_CREDIT_RATE_USD } from '@/backend/services/enrichment/centralVendorAccess';

/**
 * GET /api/billing/vendor-access-quote. PUBLIC, read-only, like /api/billing/fx.
 *
 * The public pricing page's one mode-B line: "Centralized Apollo access:
 * N Omnivyra credits = 1 Apollo credit". N is computed by the SAME pricing
 * function that charges (vendor cost x 1.5), at the platform's STANDARD credit
 * rate because a public visitor has no organisation. A vendor whose cost is
 * not set in Super Admin is reported unavailable. No tenant data.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const vendors = await quoteCentralVendorAccess(null);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ standardCreditRateUsd: STANDARD_CREDIT_RATE_USD, vendors });
  } catch {
    return res.status(500).json({ error: 'vendor_access_quote_failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/billing/vendor-access-quote' });
